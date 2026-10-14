# Arquitectura Edge en AWS (P4-0.4)

Este documento **decide la arquitectura** de la ingesta edge en AWS y deja
explícito qué se **reutiliza** y qué se debe **crear después**. Es un
entregable de decisiones: **no crea recursos, no despliega nada y no
demuestra M3**. La demostración de M3 (un `capture_id` seguido de extremo a
extremo) ocurre en tickets posteriores.

Base: contrato congelado en `docs/EDGE_CAPTURE_CONTRACT.md` (endpoint de
escritura `POST /api/edge-captures`, idempotencia por `capture_id`) e
inventario en `infra/README.md`.

## 1. Hechos verificados (us-east-1, cuenta 685538571046)

- Existe una instancia **RDS MariaDB privada** `dataset-quality-dev`
  disponible (en subredes privadas).
- Existe el **cluster ECS** `dataset-quality-dev`, pero **sin servicios ni
  tareas** en ejecución.
- No existen repositorios ECR ni balanceadores de carga reutilizables.
- Existen los buckets de **releases** y **DVC**. El de releases tiene
  **semántica distinta** (releases versionados + Object Lock/WORM); el de DVC
  es caché versionada. Ninguno se usa para capturas de edge.

## 2. Decisiones

| # | Decisión |
| --- | --- |
| D1 | **Reutilizar** la VPC, sus subredes privadas, el endpoint de S3 y la RDS MariaDB dev existentes. |
| D2 | **Crear después** un bucket privado nuevo `edge-captures-dev-685538571046` (versionado, sin Object Lock). |
| D3 | **Desplegar** una imagen consolidada del portal/backend en **AWS App Runner**, desde un repositorio ECR nuevo y con VPC Connector hacia RDS. App Runner entrega una URL pública HTTPS sin crear ALB ni certificado propios. |
| D4 | **Persistir** la metadata en una tabla `edge_captures` (RDS MariaDB) y la **imagen en S3**. |
| D5 | **No** usar DynamoDB. **No** usar IoT Core. **No** usar credenciales AWS en la Raspberry. |

> La creación del bucket, ECR, App Runner/VPC Connector y la tabla ocurre en tickets
> posteriores; aquí solo se decide y se documenta el diseño.

El cluster ECS queda fuera de esta entrega: como no tiene servicios, ECR ni
balanceador, reutilizarlo obligaría a crear más piezas que App Runner. AWS documenta
que App Runner ofrece un dominio de servicio y que un VPC Connector permite acceder
a recursos privados como RDS:

- <https://docs.aws.amazon.com/apprunner/latest/dg/manage-create.html>
- <https://docs.aws.amazon.com/apprunner/latest/dg/network-vpc.html>

## 3. Flujo de ingesta

1. La Raspberry genera la captura y calcula `image_sha256`; envía un
   `POST /api/edge-captures` multipart contra el backend.
2. El backend (servicio App Runner) valida la metadata contra el schema del
   contrato y valida la imagen (tipo, tamaño, hash).
3. Verifica idempotencia por `capture_id` en `edge_captures`.
4. Sube la imagen a S3 con una clave determinista que contiene el
   `capture_id` y el SHA-256 validado.
5. Persiste/actualiza la fila en `edge_captures` y responde `201`/`200`/`409`
   según el contrato.

## 4. Convención de claves S3

```
edge-captures/<capture_id>/<image_sha256>.<ext>
```

`capture_id` es el UUID del evento, `image_sha256` es el hash comprobado sobre
los bytes recibidos y `ext` ∈ `jpg`/`png` según el `Content-Type`
(`image/jpeg`/`image/png`). Un reintento idéntico apunta así al mismo objeto.

## 5. Tabla mínima `edge_captures`

| Columna | Tipo | Nota |
| --- | --- | --- |
| `capture_id` | CHAR(36) PK | Clave de idempotencia. |
| `device_id` | VARCHAR(128) | Del contrato. |
| `captured_at` | VARCHAR(40) | RFC 3339 conservado literalmente para no perder zona ni milisegundos. |
| `received_at` | TIMESTAMP | Asignado por el servidor. |
| `predicted_class` | ENUM('car','person') | Clases congeladas. |
| `confidence` | DOUBLE | `[0,1]`. |
| `model_version` | VARCHAR(256) | Del contrato. |
| `image_sha256` | VARCHAR(64) | Hex minúsculas. |
| `image_key` | VARCHAR(512) | Clave S3 persistida; el bucket se configura en el servicio. |
| `crop` | VARCHAR(512) NULL | JSON serializado opcional. |
| `mime_type` | VARCHAR(100) | `image/jpeg` o `image/png`. |
| `size_bytes` | BIGINT UNSIGNED | Tamaño de los bytes validados. |

## 6. Idempotencia y rollback

- **Idempotencia:** anclada en la PK `capture_id`. Si la fila ya existe, el
  backend compara hash y todos los metadatos antes de escribir. Primer envío
  → `201`; reintento idéntico → `200` sin duplicar; mismo ID con contenido
  distinto → `409`.
- **Escritura:** para un ID nuevo, sube primero a la clave determinista y luego
  inserta la fila. Si dos solicitudes compiten, la PK decide cuál gana y la
  segunda devuelve `200` o `409` según el contenido persistido.
- **Rollback:** si el insert falla y ninguna fila concurrente adoptó la misma
  clave, elimina el objeto recién subido. Nunca elimina el objeto de una
  solicitud concurrente válida.

## 7. Configuración sin secretos

- La Raspberry **no** lleva credenciales AWS: configura `EDGE_API_BASE_URL`,
  `EDGE_DEVICE_ID`, la ruta del modelo y un `EDGE_INGEST_TOKEN` entregado fuera
  de Git. Envía ese token como `Authorization: Bearer ...`.
- **Ingesta autenticada (P4-2.1):** el backend exige el token obligatorio
  `EDGE_INGEST_TOKEN` (mínimo 32 caracteres) en cada `POST` de capturas. La
  comparación es **en tiempo constante** y corre **antes** de Multer: sin token
  válido responde `401` y no persiste nada. El token no se registra ni se
  devuelve en ninguna respuesta. En App Runner llega desde Secrets Manager.
- El backend usa un **único cliente S3** (`@aws-sdk/client-s3`). En AWS (App
  Runner) se configura **sin** `OBJECT_STORE_ENDPOINT_URL` ni credenciales
  estáticas: el SDK resuelve región y credenciales por su **cadena por defecto**,
  es decir el **instance role** de App Runner (más variables de entorno o
  `~/.aws` si existieran). Nunca se incrustan claves en el código ni en la imagen.
- **En local** el mismo cliente apunta a **MinIO** mediante
  `OBJECT_STORE_ENDPOINT_URL` + `OBJECT_STORE_FORCE_PATH_STYLE=true` y las
  credenciales `OBJECT_STORE_ACCESS_KEY` / `OBJECT_STORE_SECRET_KEY` (ambas
  juntas o ninguna; un par incompleto hace fallar el arranque). La creación del
  bucket solo ocurre en local: en AWS el backend únicamente comprueba que el
  bucket exista, porque el instance role no incluye `s3:CreateBucket`.
- `OBJECT_STORE_REGION`, `OBJECT_STORE_BUCKET`, `EDGE_CAPTURE_MAX_BYTES` y la
  referencia al secreto de base de datos/token se configuran en el servicio; los
  valores secretos permanecen en Secrets Manager y nunca en Git ni en la imagen.
- `.env.example` solo debe contener nombres y valores de ejemplo no válidos.

## 7.1 Variables de runtime del contenedor consolidado (P4-2.1)

La imagen de App Runner (`Dockerfile.apprunner`, un solo contenedor con nginx al
frente en `:8080` y el backend interno en `:3100`) recibe estas variables:

| Variable | Origen | Uso |
| --- | --- | --- |
| `EDGE_INGEST_TOKEN` | Secrets Manager | Token obligatorio (>= 32 chars) de la ingesta edge. |
| `DATABASE_CREDENTIALS_JSON` | Secrets Manager | JSON `{username,password,host,port}` del secreto gestionado de RDS. |
| `DB_NAME` | Variable del servicio | Base sobre la que se construye `DATABASE_URL`. |
| `DATABASE_URL` | Derivada / opcional | Si no viene, el entrypoint la construye desde el JSON; si viene, se respeta. |
| `DB_HOST` / `DB_PORT` | Derivadas / opcionales | Para el `wait-for`; se derivan de la URL cuando faltan. |
| `RUN_DB_SEED` | Variable del servicio | `true` solo si se quiere sembrar datos (por defecto `false`). |
| `OBJECT_STORE_BUCKET` / `OBJECT_STORE_REGION` | Variable del servicio | S3 real; sin endpoint ni credenciales estáticas (instance role). |

El entrypoint (`docker/apprunner/entrypoint.sh`) **nunca imprime** la URL de
conexión ni el JSON del secreto: solo mensajes de progreso. Las migraciones
corren siempre; el seed solo con `RUN_DB_SEED=true`.

### 7.1.1 Ruta interna `/edge-captures`

nginx recibe `/api/…` y reenvía a `http://127.0.0.1:3100/` **quitando el
prefijo** (mismo criterio que el nginx local `frontend/docker/nginx.conf`). Por
eso el backend monta el alias interno `POST /edge-captures` **además** de la
ruta pública `POST /api/edge-captures`: ambas comparten la misma cadena
auth → multer → handler. Un cliente directo sigue usando `/api/edge-captures`.

### 7.1.2 Health externo

`GET /api/health` atraviesa nginx y llega al backend como `GET /health`. Es el
health check del servicio (también el `HEALTHCHECK` del contenedor).

## 8. IAM mínimo

- **Instance role de App Runner:** `s3:PutObject`, `s3:GetObject` y
  `s3:DeleteObject` solo sobre
  `arn:aws:s3:::edge-captures-dev-685538571046/edge-captures/*`, más
  `secretsmanager:GetSecretValue` únicamente sobre los secretos requeridos.
- **Access role de App Runner:** lectura de la imagen del repositorio ECR
  concreto; no administra repositorios ni otros servicios.
- Sin `s3:*`, sin IAM administrativo y sin credenciales estáticas en el
  contenedor. La conexión a RDS usa el secreto gestionado; aquí no se publica
  ninguna cadena de conexión.

## 9. Endpoints y responsables

- `POST /api/edge-captures`: **ya congelado** en
  `docs/EDGE_CAPTURE_CONTRACT.md`. Responsable: Santiago.
- `POST /edge-captures`: **alias interno** (P4-2.1), no forma parte del contrato
  público. Existe para que el nginx del contenedor consolidado quite `/api/`
  como lo hace el local; comparte auth, multer y handler con la ruta pública.
- `GET` (listado/detalle de capturas para el portal): **a cargo de
  Ignacio**. Aún no congelado.

## 10. Recursos: reutilizar vs. crear

| Acción | Recurso |
| --- | --- |
| Reutilizar | VPC/subredes, endpoint S3 y RDS `dataset-quality-dev` |
| Crear (después) | Bucket `edge-captures-dev-685538571046`, repositorio ECR, roles mínimos, VPC Connector, servicio App Runner y migración `edge_captures` |
| No usar para P4 | Cluster ECS vacío y buckets de releases/DVC |

## 11. Riesgos

- **Imagen consolidada:** resuelto en P4-2.1 con `Dockerfile.apprunner` (nginx
  al frente en `:8080`, backend interno en `:3100` y proxy `/api/` quitando el
  prefijo). Lo pendiente para el ticket de Terraform es publicar esa imagen a
  ECR y apuntar el servicio App Runner a ella.
- **Acceso privado:** el VPC Connector debe usar subredes y security group que
  alcancen RDS y el endpoint S3, sin abrir RDS a Internet.
- **Bucket y semántica:** no mezclar capturas con releases/DVC (distinta
  retención/Object Lock).
- **Idempotencia distribuida:** colisiones de `capture_id` con contenido
  distinto deben resolverse con `409`, sin sobreescribir.
- **Escritura parcial:** objeto S3 sin fila (o viceversa) exige limpieza por
  clave determinista.

## 12. Pruebas de aceptación (a ejecutar en tickets posteriores)

1. Primer `POST` válido → `201` y fila + objeto S3 creados.
2. Reintento idéntico → `200`, sin duplicar fila ni objeto.
3. Mismo `capture_id` con bytes distintos → `409`.
4. Clave S3 conforme a
   `edge-captures/<capture_id>/<image_sha256>.<ext>`.
5. El bucket de capturas no es el de releases ni el de DVC.
6. Sin credenciales AWS presentes en la Raspberry (revisión de entorno).
7. La consulta `GET`/read-only recupera registro e imagen coincidentes.
8. La URL de App Runner responde por HTTPS y un token de ingesta inválido se
   rechaza sin persistir datos.
9. La ingesta exige `Authorization: Bearer <EDGE_INGEST_TOKEN>`: token ausente,
   con otro esquema o incorrecto responde `401` (antes de leer el multipart) y
   no deja fila ni objeto. El token nunca aparece en la respuesta ni en logs.

## 13. Alcance

**P4-0.4 solo decide arquitectura.** No crea recursos, no despliega el
servicio y **no demuestra M3**. La compuerta M3 se demuestra cuando un
`capture_id` se sigue del dispositivo al registro/imagen en AWS y al portal.

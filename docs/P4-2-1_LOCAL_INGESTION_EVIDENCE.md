# P4-2.1 — Evidencia de ingesta idempotente

**Fecha:** 2026-10-14  
**Alcance:** backend, MariaDB y MinIO locales, más la verificación parcial contra AWS
descrita al final. La Raspberry, la lectura directa de RDS, el `GET` de capturas y la
compuerta M3 completa siguen pendientes.

## Objetivo

Comprobar antes del despliegue que `POST /api/edge-captures` conserva el contrato de
captura, persiste una sola fotografía lógica por `capture_id` y rechaza reutilizar ese
identificador con contenido diferente.

## Entorno usado

- Node.js 20.20.0;
- MariaDB 11 y MinIO levantados mediante Docker Compose;
- imagen de desarrollo `pipeline/reports/classifier/confusion_matrix.png`;
- `device_id` y `model_version`: `integration-test`.

La imagen anterior es solamente un fixture para probar el transporte. No sustituye las
fotografías nuevas que debe producir la cámara durante la entrega.

## Recorrido ejecutado

1. Se levantaron exclusivamente `mariadb` y `minio`.
2. Se aplicaron las seis migraciones; `edge_captures` quedó disponible.
3. Se inició temporalmente el backend en `127.0.0.1:3100`.
4. Se calculó el SHA-256 real de la imagen y se envió un multipart con `metadata` como
   campo de texto e `image` como archivo.
5. Se repitió el mismo evento y después se cambió únicamente `confidence` conservando
   el mismo `capture_id`.
6. Se consultaron MariaDB y MinIO directamente.
7. Se eliminaron solamente la fila y el objeto de la prueba y se detuvieron los servicios.

## Resultado observado

| Comprobación | Resultado |
| --- | --- |
| `capture_id` | `e3af2a54-6b8a-45b8-8451-d57b17c1963a` |
| SHA-256 de la imagen | `f243a3fae098445b6d940e9ef30c7d30bcb8fc8be42554c9e2b45442e690a800` |
| Primera ingesta | HTTP `201` |
| Reintento idéntico | HTTP `200` |
| Mismo ID con `confidence` diferente | HTTP `409` |
| Filas para el ID después de los tres envíos | `1` |
| Objeto indicado por `image_key` | Existente en MinIO, `image/png`, 10,994 bytes |
| Limpieza | `0` filas y objeto ausente |

La key resultante siguió la forma estable
`edge-captures/<capture_id>/<image_sha256>.png`. Los volúmenes se conservaron y no quedó
ningún proceso ni contenedor ejecutándose.

## Verificaciones automatizadas

~~~text
backend: npm test          162/162 pruebas aprobadas en 19 archivos
backend: npm run typecheck aprobado
backend: npm run lint      aprobado; 74 archivos sin cambios
~~~

## Contenedor consolidado candidato para App Runner

También se construyó y ejecutó `Dockerfile.apprunner` en Linux con nginx en
`:8080`, el backend interno en `:3100`, migraciones mediante `drizzle-orm` y
dependencias de producción solamente. La comprobación observó:

| Comprobación | Resultado |
| --- | --- |
| SPA `/` | HTTP `200`, `text/html` |
| Health `/api/health` | HTTP `200`, base conectada |
| Ingesta sin token | HTTP `401`, sin persistencia |
| Primera ingesta autenticada | HTTP `201` |
| Reintento idéntico | HTTP `200` |
| Mismo ID con metadata diferente | HTTP `409` |
| Persistencia final | Una fila y un objeto con MIME, tamaño y SHA-256 coincidentes |
| Limpieza | Fila, objeto, contenedor y archivos temporales retirados; volúmenes preservados |

Esta prueba valida la imagen candidata y el recorrido local, pero no sustituye
la evidencia de ECS, RDS y S3 reales que exige M3.

## Script de verificación contra un endpoint desplegado

`scripts/verify-p4-2-1-aws.mjs` es un verificador Node 20 que usa **solo módulos
integrados**. Reproduce contra un endpoint real los tres envíos del contrato
(`docs/EDGE_CAPTURE_CONTRACT.md`, secciones 4 y 6) y comprueba sus respuestas:

| Envío | Contenido | Status esperado |
| --- | --- | --- |
| 1 | `capture_id` nuevo y bytes reales de la imagen | `201` |
| 2 | Repetición idéntica (mismos bytes y metadata) | `200` |
| 3 | Mismo `capture_id` con otra `confidence` | `409` |

> Este bloque describe *cómo* ejecutar la comprobación. El script se ejecutó
> después contra un host real; su resumen está en la sección
> **Verificación contra AWS desplegado** y en `docs/p4-2-1-aws-smoke.json`.

### Requisitos

- Node.js 20 o superior.
- Un endpoint accesible que implemente `POST /api/edge-captures` con el
  contrato vigente.
- La imagen de prueba en disco (por ejemplo el fixture
  `pipeline/reports/classifier/confusion_matrix.png`), en `image/jpeg` o
  `image/png` y de máximo 10 MiB.

### Variables de entorno

| Variable | Obligatoria | Descripción |
| --- | --- | --- |
| `EDGE_API_BASE_URL` | sí | Raíz del servicio; el script agrega la ruta del contrato. |
| `EDGE_INGEST_TOKEN` | sí | Token compartido; se envía como `Authorization: Bearer …` y **nunca** se imprime ni se guarda en el resumen. |
| `EDGE_TEST_IMAGE` | sí | Ruta a la imagen real que se envía como parte `image`. |
| `EDGE_DEVICE_ID` | no | `device_id` de la metadata (por defecto `p4-2-1-verifier`). |
| `EDGE_MODEL_VERSION` | no | `model_version` de la metadata. |
| `EDGE_TIMEOUT_MS` | no | Tiempo de espera por petición en milisegundos (por defecto `15000`). |

### Uso

Bash:

```bash
EDGE_API_BASE_URL="https://<host>" \
EDGE_INGEST_TOKEN="<token fuera de Git>" \
EDGE_TEST_IMAGE="pipeline/reports/classifier/confusion_matrix.png" \
node scripts/verify-p4-2-1-aws.mjs
```

PowerShell:

```powershell
$env:EDGE_API_BASE_URL = "https://<host>"
$env:EDGE_INGEST_TOKEN = "<token fuera de Git>"
$env:EDGE_TEST_IMAGE = "pipeline/reports/classifier/confusion_matrix.png"
node scripts/verify-p4-2-1-aws.mjs
```

Para guardar el resumen (sin secretos) en un archivo:

```bash
node scripts/verify-p4-2-1-aws.mjs --report p4-2-1-aws.json
```

### Salida

El script escribe en `stdout` un único documento JSON con `capture_id`,
`image_sha256`, `image_key`, los `status_codes` de los tres envíos y la
`base_url`; los diagnósticos van a `stderr`. El resumen **no** contiene el token
y valida que `capture_id`, `image_sha256` e `image_key` de las respuestas
positivas coincidan con lo enviado.

### Códigos de salida

| Código | Significado |
| --- | --- |
| `0` | Las tres comprobaciones pasaron. |
| `1` | Falló una comprobación (status, `capture_id`, hash o `image_key`). |
| `2` | Uso inválido: falta una variable, la imagen no existe/está vacía/excede 10 MiB o no es JPEG/PNG. |
| `3` | Error de red o tiempo de espera agotado. |

## Verificación contra AWS desplegado

El **2026-10-14** se ejecutó `scripts/verify-p4-2-1-aws.mjs` contra el despliegue
real de P4-2.1 en la cuenta `685538571046` (`us-east-1`). El resumen sin secretos
queda en `docs/p4-2-1-aws-smoke.json` (`passed: true`, `generated_at`
`2026-10-14T19:16:55.618Z`).

| Comprobación | Resultado observado |
| --- | --- |
| `terraform apply` (módulo `edge-app`) | 9 recursos añadidos, 0 cambiados, 0 destruidos |
| Servicio ECS `edge-app-dev` | estable, `1/1` tareas en ejecución |
| `GET /api/health` vía CloudFront | HTTP `200` |
| Endpoint de ingesta | `https://d3mjwen8lb1kx3.cloudfront.net/api/edge-captures` |
| `capture_id` | `884f1f18-77f8-4db1-b0e3-db43bc347296` |
| Primera ingesta autenticada | HTTP `201` |
| Reintento idéntico | HTTP `200` |
| Mismo ID con `confidence` distinta | HTTP `409` |
| Objeto S3 (`head-object` en `edge-captures-dev-685538571046`) | key igual al `image_key` del JSON, `ContentLength` 10,994, `ContentType` `image/png` |
| Logs de ECS | confirman la conexión a RDS y la aplicación de las migraciones |

Interpretación precisa:

- Los códigos `201`/`200`/`409` provienen del endpoint **real** detrás de
  CloudFront, no del entorno local.
- El `200` del reintento demuestra **lectura indirecta** de la fila ya
  persistida: el backend devolvió el registro existente (mismo `capture_id`,
  `image_sha256` e `image_key`) sin crear una segunda fila. **No** hubo una
  consulta SQL directa contra RDS ni un endpoint `GET` de solo lectura; ambos
  siguen pendientes. La comprobación `head-object` confirma el objeto en S3, no
  la fila en RDS.
- La imagen enviada fue el fixture
  `pipeline/reports/classifier/confusion_matrix.png` (10,994 bytes, `image/png`),
  **no** una fotografía nueva capturada por la Raspberry.
- Los logs de ECS confirman que el contenedor se conectó a RDS y aplicó las
  migraciones, incluida `edge_captures`.

### Alcance y límites de esta verificación

- **M3 sigue PENDIENTE:** no hay un `capture_id` seguido de extremo a extremo
  (Raspberry → AWS → portal). El evento se originó con `device_id`
  `p4-2-1-verifier`, no en el dispositivo.
- La sección **Capturas Edge** del portal no está verificada; todavía no existe
  un endpoint `GET` que liste o recupere capturas.
- Al terminar, `terraform apply` con `deploy_edge_service=false` retiró los
  nueve recursos temporales del servicio (`0` añadidos, `0` cambiados,
  `9` destruidos). RDS `dataset-quality-dev` quedó en estado `stopped`.
  El bucket S3, sus datos, ECR y los secretos se conservaron para una
  integración posterior; la URL temporal de CloudFront ya no está activa.

## Lectura directa de la fila en RDS (tarea Fargate temporal)

El **2026-10-14**, después de arrancar de nuevo RDS `dataset-quality-dev`, se
ejecutó una **consulta SQL directa de solo lectura** contra la tabla
`edge_captures` desde una tarea Fargate temporal. Esto resuelve el hueco que la
verificación anterior dejaba abierto (allí el `200` del reintento era lectura
*indirecta*).

- **Cuenta / región:** `685538571046` / `us-east-1` (perfil `proyecto3-owner`).
- **Red:** `vpc-0981ba8a89e311a8e`, subnet pública `subnet-081b2fffe1dc768fa`
  (`us-east-1a`, `MapPublicIpOnLaunch=true`) y el SG `default` de esa VPC
  `sg-0afb90148be80864e`; `assignPublicIp=ENABLED`. **No** se usó la VPC default
  de AWS.
- **Task definition temporal:** `dbprobe-p4-2-1:1`, derivada de la imagen
  desplegada `edge-app-dev:0ec67c6def9dd022ab98d552d27e40c7703a58f6`
  (`networkMode=awsvpc`, `FARGATE`, `cpu/memory` `1024/2048`).
- **Secretos:** `DATABASE_CREDENTIALS_JSON` (secreto nativo de RDS) referenciado
  con el mismo `valueFrom` que usa `edge-app-dev`, consumido pero **nunca
  impreso**; `DB_HOST`/`DB_PORT`/`DB_NAME` llegaron como `environment` no
  secreto. Ningún valor de secreto quedó en la evidencia.
- **Logs:** se reutilizó el log group existente `/ecs/edge-app-dev` con el
  prefijo de stream `dbprobe` (no se creó ningún log group nuevo). El stream
  auditable es `dbprobe/dbprobe/b1f462c6a8884a148382bcf9c126ab22`.
- **Consulta:** `SELECT capture_id, captured_at, device_id, model_version,
  predicted_class, confidence, image_sha256, crop, image_key, mime_type,
  size_bytes, received_at FROM edge_captures WHERE capture_id = ? LIMIT 1`, con
  `capture_id = 884f1f18-77f8-4db1-b0e3-db43bc347296`, parametrizada y de solo
  lectura.

Resultado observado (fila real, columnas reales):

| Columna | Valor devuelto |
| --- | --- |
| `capture_id` | `884f1f18-77f8-4db1-b0e3-db43bc347296` |
| `captured_at` | `2026-10-14T19:16:55.597Z` |
| `device_id` | `p4-2-1-verifier` |
| `model_version` | `p4-2-1-verifier+sha256:unspecified` |
| `predicted_class` | `person` |
| `confidence` | `0.5` |
| `image_sha256` | `f243a3fae098445b6d940e9ef30c7d30bcb8fc8be42554c9e2b45442e690a800` |
| `crop` | `null` |
| `image_key` | `edge-captures/884f1f18-77f8-4db1-b0e3-db43bc347296/f243a3fae098445b6d940e9ef30c7d30bcb8fc8be42554c9e2b45442e690a800.png` |
| `mime_type` | `image/png` |
| `size_bytes` | `10994` |
| `received_at` | `2026-10-14T19:16:56.000Z` |

Estas columnas coinciden **exactamente** con el esquema real
(`backend/src/data/db/migrations/0005_confused_tag.sql`: `capture_id`,
`captured_at`, `device_id`, `model_version`, `predicted_class`, `confidence`,
`image_sha256`, `crop`, `image_key`, `mime_type`, `size_bytes`, `received_at`),
no con una proyección supuesta.

| Comprobación | Resultado observado |
| --- | --- |
| Tarea Fargate `b1f462c6a8884a148382bcf9c126ab22` | `STOPPED`, `EssentialContainerExited`, `exitCode` 0 |
| Fila `edge_captures` | existe, 1 fila, la del `capture_id` buscado |
| `image_key` de la fila vs `docs/p4-2-1-aws-smoke.json` | idénticos |
| `image_sha256` de la fila vs smoke | idénticos |
| `size_bytes`/`mime_type` de la fila vs smoke | `10994` / `image/png`, idénticos |
| Objeto S3 `head-object` (`edge-captures-dev-685538571046`) | key igual a la de la fila, `ContentLength` 10,994, `ContentType` `image/png` |
| Log group | `/ecs/edge-app-dev` reutilizado (misma `creationTime`, sin crear uno nuevo) |

Con esto quedan contrastados **los tres planos del mismo `capture_id`**: la fila
en RDS (consulta directa), el objeto en S3 (`head-object`) y el resumen sin
secretos en `docs/p4-2-1-aws-smoke.json`.

### Alcance y límites de la lectura directa

- **M3 sigue PENDIENTE:** el `capture_id` no se originó en la Raspberry. El
  evento se creó con `device_id` `p4-2-1-verifier`, por lo que todavía **no**
  hay un recorrido de extremo a extremo dispositivo → AWS → portal.
- La tarea de lectura era **temporal** y de solo lectura: la task definition
  `dbprobe-p4-2-1` se **desregistró** al terminar (`INACTIVE`); no quedó ningún
  servicio, tarea ni log group nuevo, y ningún valor de secreto se registró.
- RDS `dataset-quality-dev` se volvió a detener al terminar la comprobación.
- Sigue faltando un endpoint `GET` de solo lectura y la sección *Capturas Edge*
  del portal.

## Estado de P4-2.1 y pendientes de M3

La ingesta idempotente en AWS, la lectura directa de la fila en RDS y la
recuperación del objeto en S3 están verificadas. Con ello se completa el
entregable individual P4-2.1. La compuerta integrada M3 continúa pendiente de
las tareas del dispositivo y el portal.

- ~~desplegar el servicio y el almacenamiento en AWS~~ (hecho el 2026-10-14;
  ver la sección anterior);
- ~~identificar el recurso AWS y demostrar lectura del objeto de imagen~~
  (`head-object` en `edge-captures-dev-685538571046`);
- ~~leer **directamente** la fila en RDS~~ (hecho el 2026-10-14 con una tarea
  Fargate temporal de solo lectura; ver la sección anterior);
- publicar un endpoint `GET` de solo lectura para la API de consulta P4-2.3;
- provocar un fallo reversible de envío desde el entorno de evaluación y
  reintentar;
- sustituir el fixture por fotografías nuevas producidas por la Raspberry;
- comprobar que esas capturas aparecen en la sección *Capturas Edge* del portal.


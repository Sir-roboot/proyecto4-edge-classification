# Contrato de Capturas Edge (P4-0.1)

Este documento congela el **contrato del evento de captura edge** y el
**contrato de ingesta** que usan la Raspberry Pi, el backend de ingesta
(AWS) y la sección *Capturas Edge* del portal. Forma parte del entregable
de `P4-0.1` (ver `docs/PLAN_PROYECTO_4.md`, secciones 5 y 6) y debe quedar
estable **antes** de implementar el edge, AWS y el frontend.

Artefactos de este contrato:

- `contracts/edge-capture-event.schema.json` — JSON Schema **draft
  2020-12** de la metadata de entrada (la parte JSON del multipart).
- `contracts/examples/edge-capture-event.json` — ejemplo válido contra ese
  schema.

Rúbrica asociada: **6.1** (contrato de integración) y **6.3** (evidencia
y trazabilidad). Compuerta relacionada: **M3** (una captura nueva llega a
AWS y aparece en el portal).

## 1. Alcance y límites

- Un evento = **una** fotografía y **una** predicción (sin *bounding
  boxes*, sin múltiples objetos, sin video). Clases congeladas del
  Proyecto 3: `car` y `person`.
- La predicción (`predicted_class`, `confidence`) se calcula **en el
  dispositivo**, sin red. El servidor no re-clasifica.
- El contrato cubre **una sola** operación de escritura:
  `POST /api/edge-captures`.
- Este ticket **no** toca backend, frontend, Docker, dependencias ni
  infraestructura; solo publica el contrato y su documentación.

## 2. Campos del evento de entrada

El evento de entrada contiene **exactamente** los campos de la tabla. El
schema usa `additionalProperties: false`, así que cualquier campo extra
invalida el documento (`422`, ver sección 5).

| Campo | Tipo | Obligatorio | Regla |
| --- | --- | --- | --- |
| `capture_id` | string | sí | UUID (RFC 4122). Generado en el edge. **Nunca cambia** entre reintentos del mismo evento. Es la clave de idempotencia. |
| `captured_at` | string | sí | Fecha de captura en **RFC 3339 con zona horaria** (`Z` o `±hh:mm`). No se aceptan fechas sin desplazamiento. |
| `device_id` | string | sí | Identificador estable y configurable del dispositivo. **No vacío** (ni solo espacios). 1–128 caracteres. |
| `model_version` | string | sí | Versión y hash de la variante optimizada en ejecución (por ejemplo `onnx-int8-1.0.0+sha256:…`). **No vacío**. 1–256 caracteres. |
| `predicted_class` | string | sí | Una de las clases congeladas: `car` o `person`. |
| `confidence` | number | sí | Confianza calculada localmente, en `[0, 1]` (inclusivo). |
| `image_sha256` | string | sí | SHA-256 de los **mismos bytes** de la imagen enviada, en hexadecimal **minúsculas**, exactamente **64** caracteres (`^[0-9a-f]{64}$`). |
| `crop` | object | no | Región de recorte aplicada, en píxeles de la imagen enviada. Se omite cuando no hay recorte. |

### 2.1 Objeto `crop` (opcional)

| Campo | Tipo | Obligatorio | Regla |
| --- | --- | --- | --- |
| `x` | integer | sí (si hay `crop`) | Origen X, en píxeles, `>= 0`. |
| `y` | integer | sí (si hay `crop`) | Origen Y, en píxeles, `>= 0`. |
| `width` | integer | sí (si hay `crop`) | Ancho, en píxeles, `> 0`. |
| `height` | integer | sí (si hay `crop`) | Alto, en píxeles, `> 0`. |

`crop` también es `additionalProperties: false`: dentro de él solo se
aceptan `x`, `y`, `width` y `height`.

### 2.2 Por qué la entrada NO tiene `received_at` ni `image_key`

`received_at` (fecha asignada al persistir en AWS) e `image_key`
(referencia persistida por el backend/AWS) **los asigna el servidor**. No
son datos del dispositivo y por eso **no** forman parte del schema de
entrada ni de `required`: enviarlos en el multipart produce `422` (el
schema de entrada no los declara y prohíbe propiedades adicionales), así
que el evento enviado nunca mezcla esos campos. Solo aparecen en la
**respuesta** de ingesta (sección 4).

## 3. Ingesta: `POST /api/edge-captures`

La operación es **multipart/form-data** con exactamente dos partes:

| Parte | Nombre de campo | Tipo de contenido | Regla |
| --- | --- | --- | --- |
| Metadata | `metadata` | `application/json` (texto) | Un documento JSON que valida contra `edge-capture-event.schema.json`. |
| Imagen | `image` | `image/jpeg` o `image/png` | Bytes de la captura. Máximo **10 MiB** (10 × 1024 × 1024 = 10 485 760 bytes). |

Reglas adicionales:

- La parte `metadata` no debe exceder **4 KiB** de JSON (4096 bytes); una
  metadata más grande produce `400`.
- Ambos nombres de campo (`metadata`, `image`) son fijos; partes
  faltantes o con otro nombre producen `400`.
- El `Content-Type` declarado para `image` debe ser `image/jpeg` o
  `image/png`; cualquier otro produce `415`.
- El tamaño se evalúa sobre los bytes reales de `image`; más de 10 MiB
  produce `413`.
- El `image_sha256` de la metadata debe corresponder a los bytes enviados
  en `image`. El servidor recalcula el hash y lo coteja.

### 3.1 Ejemplo con `curl`

```bash
curl -i -X POST https://<host>/api/edge-captures \
  -F 'metadata={"capture_id":"6f5c1f7e-1b2a-4c3d-9e4f-0a1b2c3d4e5f","captured_at":"2026-10-13T14:05:37.482-06:00","device_id":"rpi-edge-01","model_version":"onnx-int8-1.0.0+sha256:9f2c4d1e7a8b0c3f5e6d9a2b4c8f1e0d7a3b5c9e2f4a6d8b0c1e3f5a7b9d2c4e","predicted_class":"person","confidence":0.9734,"image_sha256":"0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef","crop":{"x":120,"y":64,"width":320,"height":240}};type=application/json' \
  -F 'image=@captura.jpg;type=image/jpeg'
```

El hash anterior es solo un valor estructural válido. Antes de ejecutar
el comando se debe sustituir por el SHA-256 real de `captura.jpg`; de lo
contrario, el servidor responderá `422` por inconsistencia con la imagen.

## 4. Respuesta

La respuesta es JSON con los campos del evento **más** dos campos que
asigna el servidor:

| Campo | Origen | Descripción |
| --- | --- | --- |
| `capture_id` | edge | Eco del identificador recibido. |
| `received_at` | **servidor** | Fecha/hora en que el backend persistió el evento (RFC 3339 con zona horaria). |
| `image_key` | **servidor** | Referencia del objeto persistido en AWS (bucket/prefijo + clave). |

`received_at` e `image_key` **no** se aceptan en la entrada (sección 2.2):
solo se devuelven. El portal los usa para ordenar de reciente a antiguo y
para recuperar la imagen.

## 5. Códigos de estado

| Código | Situación | Efecto |
| --- | --- | --- |
| **201 Created** | **Primera ingesta** de un `capture_id` nuevo, metadata válida e imagen válida. | Se persiste el evento y la imagen; se devuelve la respuesta de la sección 4. |
| **200 OK** | **Reintento idempotente**: llega un `capture_id` ya persistido y el contenido es **idéntico** (mismo `image_sha256`, mismos metadatos). | **No** se duplica el registro ni la fotografía lógica; se devuelve el registro existente. |
| **409 Conflict** | Llega un `capture_id` ya persistido pero con **contenido diferente** (hash de imagen distinto o metadatos distintos). | Se rechaza: un mismo `capture_id` no puede describir dos capturas. El edge debe generar un `capture_id` nuevo para una captura nueva. |
| **400 Bad Request** | Petición mal formada: falta una parte, nombre de campo incorrecto, `metadata` no es JSON válido (error de sintaxis), `Content-Type` general no es multipart. | Se rechaza sin persistir. |
| **413 Payload Too Large** | La imagen excede **10 MiB**. | Se rechaza sin persistir. |
| **415 Unsupported Media Type** | La parte `image` no es `image/jpeg` ni `image/png`. | Se rechaza sin persistir. |
| **422 Unprocessable Entity** | El JSON de `metadata` es sintácticamente válido pero **no valida contra el schema**: UUID inválido, `captured_at` sin zona horaria, `device_id`/`model_version` vacíos, `predicted_class` fuera de `{car, person}`, `confidence` fuera de `[0, 1]`, `image_sha256` no es 64 hex minúsculas, `crop` con `width`/`height` `<= 0`, o campos extra. | Se rechaza sin persistir. |

### 5.1 Diferencia entre `400` y `422`

- `400` = el **cuerpo/transporte** está mal (no se pudo leer la petición o
  el JSON no es JSON).
- `422` = la petición está bien formada, pero el **significado** no cumple
  el contrato del evento.

## 6. Idempotencia

La idempotencia se ancla en `capture_id`:

- El edge **genera** el `capture_id` una sola vez por captura y lo
  **reutiliza** en todos los reintentos.
- Primer envío → `201`.
- Reintento con el mismo `capture_id` y el mismo contenido → `200`, sin
  crear un segundo registro ni una segunda fotografía lógica.
- Mismo `capture_id` con contenido distinto → `409`.

Esto cumple el requisito del Proyecto 4: «la persistencia debe ser
idempotente por `capture_id`» y «reintentar el mismo evento no crea dos
registros ni dos fotografías lógicas».

## 7. Verificación del contrato

Ambos archivos JSON pueden validarse localmente (por ejemplo con
`jsonschema` de Python) y el ejemplo debe pasar sin errores contra el
schema de entrada. Para comprobar que el ejemplo es la **forma** correcta
y no una salida de producción, se sigue el mismo criterio que el resto de
`contracts/` (ver `contracts/README.md`): el contenido es ilustrativo.

Puntos que conviene revisar en una prueba de mutación:

1. Quitar `capture_id` → debe fallar (campo obligatorio).
2. Cambiar `captured_at` a `2026-10-13T14:05:37` (sin zona) → debe fallar
   (patrón/format).
3. Poner `confidence: 1.5` → debe fallar (máximo 1).
4. Poner `image_sha256` en mayúsculas → debe fallar (patrón minúsculas).
5. Poner `predicted_class: "bicycle"` → debe fallar (enum).
6. Agregar una clave ajena o `received_at`/`image_key` a la entrada → debe
   fallar (`additionalProperties: false`).
7. `crop` con `height: 0` → debe fallar (`> 0`).

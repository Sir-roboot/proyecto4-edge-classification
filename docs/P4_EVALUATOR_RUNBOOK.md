# Recorrido reproducible de evaluación — Proyecto 4

Este recorrido usa el repositorio `Sir-roboot/proyecto4-edge-classification`, la Raspberry con webcam USB y el entorno AWS de desarrollo ya desplegado. No afirma una restauración desde un clon limpio: esa prueba es distinta. La evidencia histórica de 20 fotos y cinco IDs está en [P4-3.2](P4-3-2_E2E_CONTRAST.md); durante la evaluación debe hacerse **al menos una captura nueva dirigida** por el profesor.

## 1. Preparar dispositivo y artefacto

- Ficha de Raspberry Pi 4, cámara UGREEN, Debian 13, Python 3.13.5 y `/dev/video0`: [P4-0.3](P4-0-3_EDGE_DEVICE_FICHA.md).
- Instalación de `onnxruntime`, `numpy`, `pillow` y `fswebcam`: [edge/README.md](../edge/README.md).
- Recuperar `model.int8.onnx` del [release `p4-edge-model-v1.0.0-int8`](https://github.com/Sir-roboot/proyecto4-edge-classification/releases/tag/p4-edge-model-v1.0.0-int8). El SHA-256 esperado es `4607b57886a72d0e931fc18529361bbbb5b7afd3d5a66a44cf9e64457bdedfff` (11 515 721 bytes). El archivo no se versiona en Git.

```bash
# Desde la RAÍZ del repositorio en la Raspberry, con el venv activado:
curl -fL -o edge/model.int8.onnx \
  https://github.com/Sir-roboot/proyecto4-edge-classification/releases/download/p4-edge-model-v1.0.0-int8/model.int8.onnx
sha256sum edge/model.int8.onnx  # debe coincidir con el SHA-256 anterior
python edge/edge_infer_onnx.py --model edge/model.int8.onnx --image docs/evidence/p4-1-2/conocida-car.jpg
python edge/edge_infer_onnx.py --model edge/model.int8.onnx --image docs/evidence/p4-1-2/conocida-person.jpg
```

Las predicciones documentadas de esas entradas son `car` y `person`, respectivamente, en `docs/evidence/p4-1-2/known-inputs.txt`. Para M2, el evaluador puede cambiar los objetos frente a la cámara y desconectar la red **después de cargar el modelo**: la clasificación debe continuar localmente. No usar imágenes precargadas como sustituto de la prueba de cámara.

### Manifiesto y comparación verificables sin AWS

El paquete [validation-manifest.zip](evidence/p4-1-3/validation-manifest.zip)
contiene los bytes originales del manifiesto del Proyecto 3, no una versión
reconstruida. SHA-256 del JSON: `394743403f8a263b462687b733272e9993d7dddaea6a1229f8ee2896b82f3f7d`.
Los CSV y cuatro crops de ejemplo ya están en el repositorio.

```bash
# Desde la raíz; solo Python estándar, sin DVC, AWS ni dependencias ML:
python scripts/verify_p4_validation_evidence.py
```

Comprueba el hash, las 203 muestras/etiquetas/rutas, accuracy y F1, y reconstruye
la selección de calibración de 128 muestras de train sin solapamientos.
El resultado esperado es `passes: true`; no significa que se haya ejecutado
el modelo o una prueba física. El paquete evita depender del objeto DVC que
no se encontró en el remoto indicado durante la revisión.

### Opciones del runtime

En Raspberry se conserva `--ort-optimization default`: **no se han cambiado**
las opciones con las que se obtuvo el benchmark histórico. La carga informa
la versión/proveedor/nivel seleccionado. En Windows x64 con ORT 1.31.0 se
detectaron diferencias con las optimizaciones predeterminadas; para reproducir
las entradas conocidas en ese entorno usar explícitamente:

```bash
python edge/edge_infer_onnx.py --model edge/model.int8.onnx --image docs/evidence/p4-1-2/conocida-car.jpg --ort-optimization basic
python edge/edge_infer_onnx.py --model edge/model.int8.onnx --image docs/evidence/p4-1-2/conocida-person.jpg --ort-optimization basic
```

Confianzas de referencia: `0.844394` y `0.906460`. Esto no sustituye la prueba
en Raspberry ni autoriza a comparar su latencia con Windows. Antes de adoptar
otro nivel en el dispositivo, comprobar allí calidad y tiempos; no reutilizar
el benchmark anterior como si midiera la nueva configuración.

## 2. Capturar y enviar un evento nuevo

La plantilla [edge/.env.example](../edge/.env.example) contiene solo valores de ejemplo. Copiarla a `edge/.env`, recibir `EDGE_INGEST_TOKEN` por un canal privado y reemplazar el marcador. No publicar ni mostrar el token en capturas, logs o commits. El cliente lee variables de entorno; no carga el archivo automáticamente.

```bash
# Desde la raíz del repositorio; se conserva el mismo directorio en toda la guía:
set -a; . ./edge/.env; set +a
python edge/edge_client.py send --model edge/model.int8.onnx --camera
python edge/edge_client.py outbox
```

Anotar el `capture_id` nuevo, hora, clase, confianza, `image_sha256` y `device_id`. Un `201` significa creación; repetir **el mismo** ID desde el outbox devuelve `200` sin duplicado. Si falla la red, el registro queda pendiente y `python edge/edge_client.py retry --capture-id <uuid>` conserva el ID, la fecha y los bytes. La secuencia real observada `fallo → 201 → 200` está en [network-retry-sequence.txt](evidence/p4-4-3/network-retry-sequence.txt). No borrar filas, objetos ni secretos para generar la prueba.

`captured_at` se obtiene al terminar la adquisición de cámara, antes de inferir.
`inferred_at` es otro instante y solo se informa en la inferencia local. Para
enviar una imagen existente se necesita la **fecha original real** con zona:

```bash
# Sustituir por la fecha original verificada de ESA foto; no usar la hora actual:
python edge/edge_client.py send --model edge/model.int8.onnx --image /ruta/foto.jpg \
  --captured-at '2026-10-15T16:03:55.199247-06:00'
```

No se acepta `--captured-at` con `--camera`, ni una fecha sin zona. Si no se conoce
la fecha original, se puede inferir el archivo localmente (`captured_at: null`),
pero no enviarlo como una captura fechada. Los outboxes y registros históricos
se preservan; el arreglo no cambia retrospectivamente los datos en AWS.

## 3. Recuperar el evento en AWS y en el portal

Base HTTPS: `https://dmpbp69umccrl.cloudfront.net`. Abrir `/dashboard` y entrar a
**Capturas Edge** desde la navegación del portal anterior: en
`/annotation/edge-captures` los metadatos están en cada tarjeta, sin botón de
detalle. En la vista de Classifier Portal `/edge-captures`, pulsar **Consultar
detalle** para ver el ID, modelo y hash. Ambas tienen **Actualizar**. Contrastar
fotografía, clase, confianza, fecha original, ID, dispositivo y versión. El
listado se ordena por recepción, de reciente a antiguo.

```bash
BASE=https://dmpbp69umccrl.cloudfront.net
ID=<capture_id-nuevo>
curl -fsS "$BASE/api/health"
curl -fsS "$BASE/api/edge-captures?limit=100&offset=0"
curl -fsS "$BASE/api/edge-captures/$ID"
curl -fsS "$BASE/api/edge-captures/$ID/image" -o /tmp/p4-capture.jpg
sha256sum /tmp/p4-capture.jpg  # comparar con image_sha256 del detalle
```

El bucket privado es `edge-captures-dev-685538571046` en `us-east-1`. El prompt
permite que **el equipo ejecute la consulta de lectura** durante la demostración;
no hace falta entregar credenciales AWS al profesor. Alternativamente se puede
dar acceso temporal y limitado. Con un perfil autorizado del equipo (o ese perfil
limitado) y el `image_key` devuelto por el detalle:

```bash
aws s3api head-object --profile <perfil-de-lectura> --region us-east-1 \
  --bucket edge-captures-dev-685538571046 --key '<image_key-del-detalle>'
```

El comprobador de cinco IDs históricos lee la API, descarga imágenes, calcula SHA-256 y ejecuta `HeadObject` en S3, sin escribir en AWS:

```bash
# Desde la raíz del repo, con Node.js 20+ y AWS CLI configurado:
node scripts/verify-p4-3-2-readonly.mjs --profile <perfil-de-lectura>
```

El 2026-10-16 la versión anterior devolvió `count: 5`, `passes: true`, pero no
incluía la igualdad de fecha original entre sus comprobaciones. El DOM mostró
los cinco IDs y las fotos sí coincidieron. **Ese resultado histórico no prueba
que la fecha fuese correcta**: las fotos se reclasificaron y se les asignó una
fecha nueva al enviarlas.

El verificador actual informa `linkage_passes` y `capture_timestamp_passes` por
separado; `passes` requiere ambos. Para esos IDs históricos se espera
`linkage_passes: true`, `capture_timestamp_passes: false`, `passes: false` y
salida 1. Es una detección intencional del defecto antiguo, no un fallo de
lectura de S3 ni una autorización para reescribir la evidencia. La corrección
del cliente debe comprobarse con una captura nueva: fecha cámara = outbox = API.

## Estado y límites de la comprobación

- M1: conversión y comparación documentadas en `docs/evidence/p4-1-1/` y `pipeline/reports/classifier/p4/`.
- M2: evidencia previa de cámara, inferencia sin red, veinte capturas y reinicio en `docs/P4-1-2_EDGE_INFERENCE_EVIDENCE.md` y `docs/P4-2-4_DEVICE_OPERATION_EVIDENCE.md`.
- M3: cinco IDs históricos contrastados entre registro local, API, S3 y portal; la captura dirigida nueva requiere la Raspberry durante la demostración.
- Para observar AWS basta la consulta de lectura ejecutada por el equipo. Si se
  elige entregar acceso separado, confirmar que sea limitado y efectivo antes
  de compartirlo. No se incluye ninguna credencial ni se afirma haber probado
  el inicio de sesión del profesor.

# Recorrido reproducible de evaluación — Proyecto 4

Este recorrido usa el repositorio `Sir-roboot/proyecto4-edge-classification`, la Raspberry con webcam USB y el entorno AWS de desarrollo ya desplegado. No afirma una restauración desde un clon limpio: esa prueba es distinta. La evidencia histórica de 20 fotos y cinco IDs está en [P4-3.2](P4-3-2_E2E_CONTRAST.md); durante la evaluación debe hacerse **al menos una captura nueva dirigida** por el profesor.

## 1. Preparar dispositivo y artefacto

- Ficha de Raspberry Pi 4, cámara UGREEN, Debian 13, Python 3.13.5 y `/dev/video0`: [P4-0.3](P4-0-3_EDGE_DEVICE_FICHA.md).
- Instalación de `onnxruntime`, `numpy`, `pillow` y `fswebcam`: [edge/README.md](../edge/README.md).
- Recuperar `model.int8.onnx` del [release `p4-edge-model-v1.0.0-int8`](https://github.com/Sir-roboot/proyecto4-edge-classification/releases/tag/p4-edge-model-v1.0.0-int8). El SHA-256 esperado es `4607b57886a72d0e931fc18529361bbbb5b7afd3d5a66a44cf9e64457bdedfff` (11 515 721 bytes). El archivo no se versiona en Git.

```bash
# En la Raspberry, con el repositorio y su venv preparados:
curl -fL -o edge/model.int8.onnx \
  https://github.com/Sir-roboot/proyecto4-edge-classification/releases/download/p4-edge-model-v1.0.0-int8/model.int8.onnx
sha256sum edge/model.int8.onnx  # debe coincidir con el SHA-256 anterior
cd edge
python edge_infer_onnx.py --model model.int8.onnx --image ../docs/evidence/p4-1-2/conocida-car.jpg
python edge_infer_onnx.py --model model.int8.onnx --image ../docs/evidence/p4-1-2/conocida-person.jpg
```

Las predicciones documentadas de esas entradas son `car` y `person`, respectivamente, en `docs/evidence/p4-1-2/known-inputs.txt`. Para M2, el evaluador puede cambiar los objetos frente a la cámara y desconectar la red **después de cargar el modelo**: la clasificación debe continuar localmente. No usar imágenes precargadas como sustituto de la prueba de cámara.

## 2. Capturar y enviar un evento nuevo

La plantilla [edge/.env.example](../edge/.env.example) contiene solo valores de ejemplo. Copiarla a `edge/.env`, recibir `EDGE_INGEST_TOKEN` por un canal privado y reemplazar el marcador. No publicar ni mostrar el token en capturas, logs o commits. El cliente lee variables de entorno; no carga el archivo automáticamente.

```bash
cd edge
set -a; . ./.env; set +a
python edge_client.py send --model model.int8.onnx --camera
python edge_client.py outbox
```

Anotar el `capture_id` nuevo, hora, clase, confianza, `image_sha256` y `device_id`. Un `201` significa creación; repetir **el mismo** ID desde el outbox devuelve `200` sin duplicado. Si falla la red, el registro queda pendiente y `python edge_client.py retry --capture-id <uuid>` conserva el ID y los bytes. La secuencia real observada `fallo → 201 → 200` está en [network-retry-sequence.txt](evidence/p4-4-3/network-retry-sequence.txt). No borrar filas, objetos ni secretos para generar la prueba.

## 3. Recuperar el evento en AWS y en el portal

Base HTTPS: `https://dmpbp69umccrl.cloudfront.net`. Abrir `/dashboard` y entrar a **Capturas Edge** desde la navegación del portal anterior, o abrir `/edge-captures` desde Classifier Portal. Pulsar **Actualizar**, localizar el nuevo ID y **Consultar detalle**. Deben aparecer la fotografía, clase, confianza, fecha de evento, `capture_id`, dispositivo y versión del modelo. El listado se ordena por recepción, de reciente a antiguo.

```bash
BASE=https://dmpbp69umccrl.cloudfront.net
ID=<capture_id-nuevo>
curl -fsS "$BASE/api/health"
curl -fsS "$BASE/api/edge-captures?limit=100&offset=0"
curl -fsS "$BASE/api/edge-captures/$ID"
curl -fsS "$BASE/api/edge-captures/$ID/image" -o /tmp/p4-capture.jpg
sha256sum /tmp/p4-capture.jpg  # comparar con image_sha256 del detalle
```

El bucket privado es `edge-captures-dev-685538571046` en `us-east-1`. Con **un perfil AWS de lectura concedido por el responsable** y el `image_key` devuelto por el detalle:

```bash
aws s3api head-object --profile <perfil-de-lectura> --region us-east-1 \
  --bucket edge-captures-dev-685538571046 --key '<image_key-del-detalle>'
```

El comprobador de cinco IDs históricos lee la API, descarga imágenes, calcula SHA-256 y ejecuta `HeadObject` en S3, sin escribir en AWS:

```bash
# Desde la raíz del repo, con Node.js 20+ y AWS CLI configurado:
node scripts/verify-p4-3-2-readonly.mjs --profile <perfil-de-lectura>
```

El 2026-10-16 devolvió `count: 5`, `passes: true`; el DOM del portal desplegado mostró los cinco IDs. Las cinco fotos históricas se reclasificaron al enviarse, por lo que su hora de foto en el registro local es anterior a `captured_at` del nuevo evento. La fecha del portal debe compararse con la del **detalle AWS**, no con la hora original de esas fotos. Una captura nueva con `send --camera` evita esa ambigüedad.

## Estado y límites de la comprobación

- M1: conversión y comparación documentadas en `docs/evidence/p4-1-1/` y `pipeline/reports/classifier/p4/`.
- M2: evidencia previa de cámara, inferencia sin red, veinte capturas y reinicio en `docs/P4-1-2_EDGE_INFERENCE_EVIDENCE.md` y `docs/P4-2-4_DEVICE_OPERATION_EVIDENCE.md`.
- M3: cinco IDs históricos contrastados entre registro local, API, S3 y portal; la captura dirigida nueva requiere la Raspberry durante la demostración.
- La identidad/disponibilidad del perfil AWS de evaluación debe confirmarse con el profesor. Este documento no incluye credenciales ni afirma que se haya probado su inicio de sesión.

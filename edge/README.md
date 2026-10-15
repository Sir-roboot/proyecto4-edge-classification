# Edge — inferencia local en la Raspberry Pi (P4-1.2)

Código que corre **en el dispositivo edge** para clasificar imágenes con el
modelo del Proyecto 3 sin depender de la red. Ver la ficha del dispositivo en
`docs/P4-0-3_EDGE_DEVICE_FICHA.md` y la evidencia de la compuerta M2 en
`docs/P4-1-2_EDGE_INFERENCE_EVIDENCE.md`.

## Archivos

| Archivo | Qué hace |
| --- | --- |
| `edge_infer_onnx.py` | Inferencia con la variante optimizada **ONNX INT8** vía onnxruntime. Es el camino de producción del edge. |
| `edge_infer.py` | Camino alterno con el checkpoint **PyTorch `.pt`** original (torch). Útil para comparar original vs optimizado. |
| `offline_check.py` | Prueba de autonomía M2: bloquea la red a nivel de proceso y clasifica, probando que no hay llamadas de red. |
| `offline_demo.py` | Demo físico M2: bucle que sondea la red y clasifica; registra las predicciones hechas mientras la red está desconectada. |
| `edge_client.py` | Cliente de envío (P4-2.2): clasifica y manda la captura al backend con `POST /api/edge-captures`; conserva el `capture_id` en reintentos y usa un *outbox* local para reintentar a mano. |
| `collect_device_info.sh` | (en `scripts/edge/`) Genera la ficha técnica del dispositivo. |

## Preparación en la Raspberry

```bash
# Debian 13 exige venv (PEP 668)
python3 -m venv ~/edge-venv
source ~/edge-venv/bin/activate

# Camino ONNX (producción del edge)
pip install onnxruntime numpy pillow

# Camino alterno .pt (opcional, pesado)
pip install torch torchvision --index-url https://download.pytorch.org/whl/cpu

# Captura con webcam USB
sudo apt install -y fswebcam
```

## Uso

```bash
# Clasificar un archivo (entrada conocida)
python edge_infer_onnx.py --model model.int8.onnx --image conocida.jpg

# Capturar con la webcam y clasificar
python edge_infer_onnx.py --model model.int8.onnx --camera --save-dir ~/edge-capturas

# Operación continua (una captura cada N segundos)
python edge_infer_onnx.py --model model.int8.onnx --loop 5 --save-dir ~/edge-capturas

# Prueba de autonomía sin red (bloqueo de sockets)
python offline_check.py --model model.int8.onnx --image captura.jpg

# Demo físico sin red: arrancar, desconectar el cable/WiFi ~1 min, reconectar.
# Las líneas con "network_reachable": false prueban la autonomía.
nohup python offline_demo.py --model model.int8.onnx --interval 5 \
    > offline-demo.jsonl 2>&1 &

# Enviar la captura al backend (P4-2.2) — config por entorno:
export EDGE_API_BASE_URL=http://<host>:3100   # sin "/" final
export EDGE_INGEST_TOKEN=<token fuera de Git>  # Bearer, >= 32 chars
export EDGE_DEVICE_ID=rpi-edge-01
python edge_client.py send  --model model.int8.onnx --camera   # captura y envía
python edge_client.py retry --capture-id <uuid>                # reintento manual
python edge_client.py outbox                                   # listar pendientes
```

Cada inferencia emite una línea JSON con `predicted_class`, `confidence`,
`probabilities`, `image_sha256`, `model_version` e `inference_ms`. El
`image_sha256` y el `model_version` son exactamente los que consume el cliente
de envío (P4-2.2) contra `POST /api/edge-captures`.

## Notas

- Las clases están congeladas: `car`, `person` (orden `car`=0, `person`=1).
- El modelo **no** viaja en git (artefacto grande); se obtiene del release del
  Proyecto 3. Su hash queda registrado en el `model_version`.
- El preprocesamiento (RGB, 128×128, normalización ImageNet) debe conservarse
  idéntico al de validación; cambiarlo desvía las predicciones.

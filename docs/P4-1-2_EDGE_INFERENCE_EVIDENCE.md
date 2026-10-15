# P4-1.2 — Evidencia de inferencia local en el edge (compuerta M2)

**Fecha:** 2026-10-15
**Responsable:** Quiroz Valdovinos, Andrés
**Rúbrica asociada:** M2, 2.2 (parcial), 2.3
**Dispositivo:** ver `docs/P4-0-3_EDGE_DEVICE_FICHA.md`

## Objetivo

Demostrar el recorrido **cámara → preprocesamiento → inferencia** ejecutándose
de forma autónoma en la Raspberry Pi, con la variante optimizada del modelo y
**sin red**.

## Artefacto de modelo

| Campo | Valor |
| --- | --- |
| Archivo | `model.int8.onnx` (variante optimizada de P4-1.1, entregada por Luis Víctor) |
| Formato | ONNX, cuantización INT8 |
| Tamaño | 11 515 721 bytes (vs 45 304 323 del `.pt` fp32 original) |
| SHA-256 | `4607b57886a72d0e931fc18529361bbbb5b7afd3d5a66a44cf9e64457bdedfff` |
| `model_version` (para el contrato) | `onnx-int8-1.0.0+sha256:4607b578…dfff` |
| Grafo | entrada `image` `[1,3,128,128]` `float32` → salida `logits` `[1,2]` |

> **Pendiente de M1 (no es de este ticket):** el log de conversión que prueba
> que este `.onnx` deriva del `model.pt` `v1.0.0` lo entrega P4-1.1 (Luis
> Víctor). Aquí solo se consume el artefacto y se fija su hash.

## Preprocesamiento (idéntico a la validación del Proyecto 3)

- Color `RGB`, resize a `128×128`, escala a `[0,1]`.
- Normalización ImageNet: media `(0.485, 0.456, 0.406)`, desviación
  `(0.229, 0.224, 0.225)`.
- El grafo recibe `float32` NCHW; la salida son logits, a los que el cliente
  aplica softmax.

## Runtime en el dispositivo

```
host: raspberrypi  (Raspberry Pi 4 Model B, aarch64, Debian 13)
onnxruntime 1.31.0
torch 2.14.1+cpu        # usado solo por el camino alterno .pt
torchvision 0.29.1+cpu
numpy 2.5.2
python 3.13.5
```

El runtime vive en un venv (`~/edge-venv`), exigido por PEP 668 en Debian 13.

## Recorrido ejecutado y resultados

### 1. Carga del modelo e inferencia sobre archivo

`edge_infer_onnx.py` carga el `.onnx`, imprime el grafo y clasifica. Salida
real (una línea JSON por evento):

```json
{"loaded":"/home/pi/model.int8.onnx","classes":["car","person"],
 "model_version":"onnx-int8-1.0.0+sha256:4607b578…dfff",
 "graph":{"input_name":"image","input_shape":[1,3,128,128],
          "input_type":"tensor(float)","output_name":"logits","output_shape":[1,2]}}
```

### 2. Cámara → inferencia (recorrido físico completo)

Captura real con la webcam USB UGREEN (`fswebcam`, `/dev/video0`, 1280×720) y
clasificación en el dispositivo:

```json
{"captured_at":"2026-10-15T13:52:04.072687-06:00",
 "image":"/home/pi/edge-capturas/captura_20261015_135202_628419.jpg",
 "image_sha256":"44f19b8549299d29540fd3fddf1206653cd69608a866086a046197a142e78723",
 "model_version":"onnx-int8-1.0.0+sha256:4607b578…dfff",
 "predicted_class":"person","confidence":0.963943,
 "probabilities":{"car":0.036057,"person":0.963943},"inference_ms":37.39}
```

Imagen conservada como evidencia: `docs/evidence/p4-1-2/captura-webcam.jpg`.

### 3. Latencia (muestra preliminar, no es el benchmark formal)

Inferencia en caliente sobre la misma imagen, tres corridas:

```
inferencia 31.10 ms -> person 0.96
inferencia 30.44 ms -> person 0.96
inferencia 30.35 ms -> person 0.96
```

~30 ms por inferencia (la primera llamada es mayor por la inicialización). El
benchmark formal de 10 calentamientos + 100 tiempos y p50/p95 es P4-1.4.

### 4. Autonomía sin red (lo que define M2)

`offline_check.py` bloquea todos los sockets del proceso y luego clasifica. La
inferencia termina correctamente, probando que no hay ninguna llamada de red en
el camino de inferencia (`docs/evidence/p4-1-2/offline-proof.txt`):

```json
{"red":"bloqueada","sockets":"deshabilitados"}
{"imagen":"captura_20261015_135202_628419.jpg","predicted_class":"person",
 "confidence":0.9639,"clasifico_sin_red":true}
```

## Reproducción

```bash
# En la Raspberry, dentro del venv:
python edge_infer_onnx.py --model model.int8.onnx --image conocida.jpg   # archivo
python edge_infer_onnx.py --model model.int8.onnx --camera               # webcam
python offline_check.py  --model model.int8.onnx --image captura.jpg     # prueba sin red
```

## Pendiente para cerrar M2 y 2.x por completo

1. **Entradas conocidas (2.2):** clasificar una imagen clara de `car` y otra de
   `person` para confirmar el orden de clases (`car`=0, `person`=1) y que el
   modelo acierta en entradas controladas.
2. **Demostración física sin red:** `edge_infer_onnx.py --loop` corriendo
   mientras se desconecta el cable/WiFi (para el video/evidencia del grader).
3. **Benchmark formal (P4-1.4):** 10 calentamientos, 100 tiempos, p50/p95.
4. **M1 (Luis Víctor):** log de conversión `.pt v1.0.0 → .onnx int8`.

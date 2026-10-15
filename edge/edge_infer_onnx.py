"""Inferencia local ONNX en el dispositivo edge (P4-1.2, compuerta M2).

Corre la **variante optimizada ONNX INT8** del clasificador T3 con
onnxruntime, completamente sin red: no importa torch, no habla con el backend
ni hace llamadas HTTP. El preprocesamiento replica el de validación del
Proyecto 3 (RGB, resize 128x128, escala [0,1], normalización ImageNet), que es
el mismo que se bakeó en el entrenamiento; cambiarlo desvía las predicciones.

El grafo ONNX no transporta los nombres de clase (a diferencia del checkpoint
.pt), así que el orden se fija aquí: índice 0 = `car`, 1 = `person` (orden
alfabético del dataset congelado). Se puede sobreescribir con --classes.

Uso en la Raspberry (dentro del venv con onnxruntime):

    python edge_infer_onnx.py --model model.int8.onnx --image conocida.jpg
    python edge_infer_onnx.py --model model.int8.onnx --camera
    python edge_infer_onnx.py --model model.int8.onnx --loop 15 --save-dir ~/edge-capturas

Cada resultado es una línea JSON con clase, confianza, probabilidades,
latencia, el `image_sha256` y el `model_version` (derivado del hash del .onnx),
lista para alimentar al cliente de envío de P4-2.2.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import subprocess
import sys
import tempfile
import time
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import onnxruntime as ort
from PIL import Image

NORMALIZE_MEAN = np.array([0.485, 0.456, 0.406], dtype=np.float32).reshape(3, 1, 1)
NORMALIZE_STD = np.array([0.229, 0.224, 0.225], dtype=np.float32).reshape(3, 1, 1)
DEFAULT_CLASSES = ["car", "person"]
CAPTURE_RESOLUTION = "1280x720"


def model_version(model_path: Path) -> str:
    digest = hashlib.sha256(model_path.read_bytes()).hexdigest()
    return f"onnx-int8-1.0.0+sha256:{digest}"


def load_session(model_path: Path):
    if not model_path.is_file() or model_path.stat().st_size == 0:
        raise SystemExit(f"modelo {model_path} no existe o está vacío")
    session = ort.InferenceSession(str(model_path), providers=["CPUExecutionProvider"])
    inp = session.get_inputs()[0]
    out = session.get_outputs()[0]
    meta = {
        "input_name": inp.name,
        "input_shape": inp.shape,
        "input_type": inp.type,
        "output_name": out.name,
        "output_shape": out.shape,
    }
    # Deduce la resolución esperada del grafo cuando es estática (H, W fijas).
    size = 128
    if len(inp.shape) == 4 and isinstance(inp.shape[2], int) and inp.shape[2] > 0:
        size = int(inp.shape[2])
    return session, inp.name, size, meta


def preprocess(image: Image.Image, size: int) -> np.ndarray:
    rgb = image.convert("RGB").resize((size, size), Image.BILINEAR)
    array = np.asarray(rgb, dtype=np.float32) / 255.0  # HWC en [0,1]
    chw = np.transpose(array, (2, 0, 1))  # CHW
    normalized = (chw - NORMALIZE_MEAN) / NORMALIZE_STD
    return normalized[np.newaxis, ...].astype(np.float32)  # NCHW


def to_probabilities(row: np.ndarray) -> np.ndarray:
    # Si el grafo ya emite probabilidades (>=0 y suman 1) se respetan; si emite
    # logits se aplica softmax. Así el script sirve exporte Luis lo que exporte.
    if row.min() >= 0.0 and abs(float(row.sum()) - 1.0) < 1e-3:
        return row
    shifted = row - row.max()
    exp = np.exp(shifted)
    return exp / exp.sum()


def classify(session, input_name, size, classes, image_path: Path, version: str) -> dict:
    with Image.open(image_path) as image:
        batch = preprocess(image, size)
    started = time.perf_counter()
    raw = session.run(None, {input_name: batch})[0]
    latency_ms = (time.perf_counter() - started) * 1000
    probabilities = to_probabilities(np.asarray(raw, dtype=np.float32).reshape(-1))
    if len(probabilities) != len(classes):
        raise SystemExit(
            f"el modelo produjo {len(probabilities)} salidas pero hay "
            f"{len(classes)} clases {classes}; revisa --classes"
        )
    index = int(np.argmax(probabilities))
    return {
        "captured_at": datetime.now(timezone.utc).astimezone().isoformat(),
        "image": str(image_path),
        "image_sha256": hashlib.sha256(image_path.read_bytes()).hexdigest(),
        "model_version": version,
        "predicted_class": classes[index],
        "confidence": round(float(probabilities[index]), 6),
        "probabilities": {c: round(float(p), 6) for c, p in zip(classes, probabilities)},
        "inference_ms": round(latency_ms, 2),
    }


def capture(save_dir: Path | None) -> Path:
    if save_dir is not None:
        save_dir.mkdir(parents=True, exist_ok=True)
        stamp = datetime.now().strftime("%Y%m%d_%H%M%S_%f")
        target = save_dir / f"captura_{stamp}.jpg"
    else:
        handle = tempfile.NamedTemporaryFile(suffix=".jpg", delete=False)
        handle.close()
        target = Path(handle.name)
    result = subprocess.run(
        ["fswebcam", "-r", CAPTURE_RESOLUTION, "--no-banner", str(target)],
        capture_output=True,
        text=True,
    )
    if result.returncode != 0 or not target.exists() or target.stat().st_size == 0:
        raise SystemExit(f"fswebcam falló: {result.stderr.strip()}")
    return target


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--model", required=True, type=Path, help="ruta del .onnx")
    source = parser.add_mutually_exclusive_group(required=True)
    source.add_argument("--image", type=Path, help="clasificar un archivo existente")
    source.add_argument("--camera", action="store_true", help="capturar con la webcam y clasificar")
    source.add_argument("--loop", type=float, metavar="SEGUNDOS", help="captura continua cada N segundos")
    parser.add_argument("--classes", nargs="+", default=DEFAULT_CLASSES, help="orden de clases (def: car person)")
    parser.add_argument("--save-dir", type=Path, default=None, help="conservar las capturas aquí")
    args = parser.parse_args()

    session, input_name, size, meta = load_session(args.model)
    version = model_version(args.model)
    print(json.dumps({"loaded": str(args.model), "classes": args.classes,
                      "model_version": version, "graph": meta}), flush=True)

    if args.image:
        print(json.dumps(classify(session, input_name, size, args.classes, args.image, version)), flush=True)
        return
    if args.camera:
        path = capture(args.save_dir)
        print(json.dumps(classify(session, input_name, size, args.classes, path, version)), flush=True)
        return
    while True:
        try:
            path = capture(args.save_dir)
            print(json.dumps(classify(session, input_name, size, args.classes, path, version)), flush=True)
        except SystemExit as error:
            print(json.dumps({"error": str(error)}), file=sys.stderr, flush=True)
        time.sleep(args.loop)


if __name__ == "__main__":
    main()

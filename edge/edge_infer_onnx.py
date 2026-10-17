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
    python edge_infer_onnx.py --model model.int8.onnx --image vieja.jpg \\
        --captured-at 2024-05-01T12:00:00Z
    python edge_infer_onnx.py --model model.int8.onnx --camera
    python edge_infer_onnx.py --model model.int8.onnx --loop 15 --save-dir ~/edge-capturas
    python edge_infer_onnx.py --model model.int8.onnx --image x.jpg \\
        --ort-optimization disabled

Para `--image`, `--captured-at` es opcional pero debe ser ISO 8601 con zona
explícita. Si se omite, la captura original queda como desconocida
(`captured_at: null`) y solo se registra `inferred_at` (hora local de
inferencia); nunca se inventa una fecha de captura. En cámara y loop la fecha
se toma al terminar la adquisición, antes de preprocesar e inferir.

Cada resultado es una línea JSON con clase, confianza, probabilidades,
latencia, el `image_sha256` y el `model_version` (derivado del hash del .onnx),
lista para alimentar al cliente de envío de P4-2.2.

`--ort-optimization` elige el nivel de optimización del grafo de onnxruntime.
`default` conserva el comportamiento previo (SessionOptions por defecto).
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
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
ORT_OPTIMIZATION_LEVELS = ("default", "basic", "disabled", "extended", "all")
_ORT_GRAPH_LEVELS = {
    "basic": ort.GraphOptimizationLevel.ORT_ENABLE_BASIC,
    "disabled": ort.GraphOptimizationLevel.ORT_DISABLE_ALL,
    "extended": ort.GraphOptimizationLevel.ORT_ENABLE_EXTENDED,
    "all": ort.GraphOptimizationLevel.ORT_ENABLE_ALL,
}
_CAPTURE_TIME_PATTERN = re.compile(
    r"[0-9]{4}-[0-9]{2}-[0-9]{2}[Tt][0-9]{2}:[0-9]{2}:[0-9]{2}"
    r"(?:\.[0-9]+)?(?:[Zz]|[+-](?P<offset_hour>[0-9]{2}):(?P<offset_minute>[0-9]{2}))"
)


def _now_iso() -> str:
    """Hora local actual con zona explícita (la misma forma usada antes)."""
    return datetime.now(timezone.utc).astimezone().isoformat()


def validate_captured_at(value: str) -> str:
    """Valida ISO 8601 con zona explícita y conserva la cadena exacta.

    No normaliza ni reformatea: una captura antigua debe llegar al backend tal
    como fue registrada. Una fecha sin zona es ambigua y se rechaza.
    """
    if not isinstance(value, str) or not value:
        raise ValueError(
            "captured_at debe ser una cadena ISO 8601 con zona horaria explícita"
        )
    match = _CAPTURE_TIME_PATTERN.fullmatch(value)
    if not match or (
        match.group("offset_hour") is not None
        and (int(match.group("offset_hour")) > 23 or int(match.group("offset_minute")) > 59)
    ):
        raise ValueError(
            "captured_at debe cumplir RFC 3339 con segundos y zona Z o ±HH:MM; "
            "no se aceptan separadores de espacio, coma decimal ni offsets abreviados"
        )
    candidate = value
    if candidate.endswith(("Z", "z")):
        candidate = candidate[:-1] + "+00:00"
    try:
        parsed = datetime.fromisoformat(candidate)
    except ValueError:
        raise ValueError(
            f"captured_at no es ISO 8601 válido: {value!r} "
            "(ej. 2026-10-16T12:00:00Z)"
        ) from None
    if parsed.tzinfo is None or parsed.utcoffset() is None:
        raise ValueError(
            f"captured_at requiere zona horaria explícita (Z o ±HH:MM): {value!r}"
        )
    return value


def captured_at_arg(value: str) -> str:
    """Tipo de argparse: convierte ValueError en un error de CLI claro."""
    try:
        return validate_captured_at(value)
    except ValueError as error:
        raise argparse.ArgumentTypeError(str(error)) from None


def model_version(model_path: Path) -> str:
    digest = hashlib.sha256(model_path.read_bytes()).hexdigest()
    return f"onnx-int8-1.0.0+sha256:{digest}"


def build_session_options(ort_optimization: str):
    """Mapea el nivel elegido a SessionOptions; `default` no lo modifica."""
    if ort_optimization not in ORT_OPTIMIZATION_LEVELS:
        raise ValueError(
            f"nivel ORT desconocido {ort_optimization!r}; "
            f"usa uno de {ORT_OPTIMIZATION_LEVELS}"
        )
    if ort_optimization == "default":
        # None deja que onnxruntime use su SessionOptions por defecto, igual
        # que el comportamiento anterior a --ort-optimization.
        return None
    options = ort.SessionOptions()
    options.graph_optimization_level = _ORT_GRAPH_LEVELS[ort_optimization]
    return options


def load_session(model_path: Path, ort_optimization: str = "default"):
    if not model_path.is_file() or model_path.stat().st_size == 0:
        raise SystemExit(f"modelo {model_path} no existe o está vacío")
    options = build_session_options(ort_optimization)
    session = ort.InferenceSession(
        str(model_path),
        sess_options=options,
        providers=["CPUExecutionProvider"],
    )
    inp = session.get_inputs()[0]
    out = session.get_outputs()[0]
    meta = {
        "input_name": inp.name,
        "input_shape": inp.shape,
        "input_type": inp.type,
        "output_name": out.name,
        "output_shape": out.shape,
        "providers": list(session.get_providers()),
        "runtime": f"onnxruntime {ort.__version__}",
        "runtime_version": ort.__version__,
        "optimization": ort_optimization,
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


def classify(session, input_name, size, classes, image_path: Path, version: str, *,
             captured_at: str | None = None) -> dict:
    """Clasifica una imagen conservando la fecha real de captura.

    `captured_at` es la fecha original (ISO 8601 con zona) y se devuelve sin
    reformatear. Si es None, la captura original es desconocida: se emite
    `captured_at: null` y solo se agrega `inferred_at` como dato local de la
    inferencia; nunca se usa la hora actual ni el mtime como captura.
    """
    if captured_at is not None:
        validate_captured_at(captured_at)
    with Image.open(image_path) as image:
        batch = preprocess(image, size)
    inferred_at = _now_iso()
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
        "captured_at": captured_at,
        "image": str(image_path),
        "image_sha256": hashlib.sha256(image_path.read_bytes()).hexdigest(),
        "model_version": version,
        "predicted_class": classes[index],
        "confidence": round(float(probabilities[index]), 6),
        "probabilities": {c: round(float(p), 6) for c, p in zip(classes, probabilities)},
        "inference_ms": round(latency_ms, 2),
        "inferred_at": inferred_at,
    }


def capture(save_dir: Path | None) -> tuple[Path, str]:
    """Captura una imagen y devuelve (ruta, fecha real de captura).

    La fecha se toma inmediatamente después de que fswebcam termina bien, es
    decir antes de preprocesar o inferir, para no confundirla con la hora de
    clasificación.
    """
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
    captured_at = _now_iso()
    return target, captured_at


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--model", required=True, type=Path, help="ruta del .onnx")
    source = parser.add_mutually_exclusive_group(required=True)
    source.add_argument("--image", type=Path, help="clasificar un archivo existente")
    source.add_argument("--camera", action="store_true", help="capturar con la webcam y clasificar")
    source.add_argument("--loop", type=float, metavar="SEGUNDOS", help="captura continua cada N segundos")
    parser.add_argument(
        "--captured-at",
        type=captured_at_arg,
        metavar="ISO8601",
        default=None,
        help="fecha real de captura para --image (con zona; incompatible con cámara)",
    )
    parser.add_argument(
        "--ort-optimization",
        choices=ORT_OPTIMIZATION_LEVELS,
        default="default",
        help="nivel de optimización ORT (def: default = SessionOptions previo)",
    )
    parser.add_argument("--classes", nargs="+", default=DEFAULT_CLASSES, help="orden de clases (def: car person)")
    parser.add_argument("--save-dir", type=Path, default=None, help="conservar las capturas aquí")
    args = parser.parse_args()

    if args.captured_at is not None and (args.camera or args.loop is not None):
        parser.error("--captured-at solo aplica a --image; cámara y loop fechan al capturar")

    session, input_name, size, meta = load_session(
        args.model, ort_optimization=args.ort_optimization
    )
    version = model_version(args.model)
    print(json.dumps({"loaded": str(args.model), "classes": args.classes,
                      "model_version": version, "graph": meta}), flush=True)

    if args.image:
        print(json.dumps(classify(session, input_name, size, args.classes, args.image,
                                  version, captured_at=args.captured_at)), flush=True)
        return
    if args.camera:
        path, captured_at = capture(args.save_dir)
        print(json.dumps(classify(session, input_name, size, args.classes, path,
                                  version, captured_at=captured_at)), flush=True)
        return
    while True:
        try:
            path, captured_at = capture(args.save_dir)
            print(json.dumps(classify(session, input_name, size, args.classes, path,
                                      version, captured_at=captured_at)), flush=True)
        except SystemExit as error:
            print(json.dumps({"error": str(error)}), file=sys.stderr, flush=True)
        time.sleep(args.loop)


if __name__ == "__main__":
    main()

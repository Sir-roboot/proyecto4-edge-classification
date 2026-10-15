"""Inferencia local en el dispositivo edge (P4-1.2, compuerta M2).

Carga el checkpoint auto-descriptivo del clasificador T3 (formato
``t3-classifier-checkpoint/v1``) y clasifica imágenes de la webcam USB o de
archivo, completamente sin red: no importa nada del backend ni hace llamadas
HTTP. Replica el cargador oficial (``pipeline/.../predict.py``):
``weights_only=True``, arquitectura reconstruida desde la config del
checkpoint y ``load_state_dict(strict=True)``; el preprocesamiento es el
mismo de validación (resize 128x128, [0,1], normalización ImageNet).

La captura usa ``fswebcam`` (webcam USB UGREEN vía V4L2, ver
``docs/P4-0-3_EDGE_DEVICE_FICHA.md``).

Uso en la Raspberry (dentro del venv con torch/torchvision):

    python edge_infer.py --model model.pt --image conocida.jpg   # entrada conocida
    python edge_infer.py --model model.pt --camera               # una captura
    python edge_infer.py --model model.pt --loop 15              # continuo, cada 15 s

Cada resultado se emite como una línea JSON con clase, confianza,
probabilidades y latencia; con ``--save-dir`` las capturas se conservan para
usarse como evidencia o para el cliente de envío (P4-2.2).
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

import torch
from PIL import Image
from torch import nn
from torchvision import models, transforms

CHECKPOINT_FORMAT = "t3-classifier-checkpoint/v1"
NORMALIZE_MEAN = (0.485, 0.456, 0.406)
NORMALIZE_STD = (0.229, 0.224, 0.225)
CAPTURE_RESOLUTION = "1280x720"


def build_head(in_features: int, hidden_layers: list[int], dropout: float, n_classes: int):
    layers: list[nn.Module] = []
    width = in_features
    for hidden in hidden_layers:
        layers += [nn.Linear(width, hidden), nn.ReLU(inplace=True), nn.Dropout(dropout)]
        width = hidden
    if not hidden_layers:
        layers.append(nn.Dropout(dropout))
    layers.append(nn.Linear(width, n_classes))
    return nn.Sequential(*layers)


def build_model(config: dict, n_classes: int) -> nn.Module:
    hidden_layers = list(config["hidden_layers"])
    dropout = float(config["dropout"])
    if config["architecture"] == "simple_cnn":
        raise SystemExit("simple_cnn no es el modelo liberado; se esperaba resnet18")
    network = models.resnet18(weights=None)
    network.fc = build_head(network.fc.in_features, hidden_layers, dropout, n_classes)
    return network


def load_checkpoint(path: Path):
    if not path.is_file() or path.stat().st_size == 0:
        raise SystemExit(f"checkpoint {path} no existe o está vacío")
    checkpoint = torch.load(path, map_location="cpu", weights_only=True)
    if not isinstance(checkpoint, dict) or checkpoint.get("format") != CHECKPOINT_FORMAT:
        raise SystemExit(f"{path} no es un checkpoint {CHECKPOINT_FORMAT}")
    config = checkpoint["config"]
    class_names = list(checkpoint["class_names"])
    model = build_model(config, len(class_names))
    model.load_state_dict(checkpoint["state_dict"], strict=True)
    model.eval()
    image_size = int(config["image_size"])
    transform = transforms.Compose(
        [
            transforms.Resize((image_size, image_size)),
            transforms.ToTensor(),
            transforms.Normalize(NORMALIZE_MEAN, NORMALIZE_STD),
        ]
    )
    return model, class_names, transform


@torch.no_grad()
def classify(model, class_names, transform, image_path: Path) -> dict:
    with Image.open(image_path) as image:
        rgb = image.convert("RGB")
    batch = transform(rgb).unsqueeze(0)
    started = time.perf_counter()
    probabilities = torch.softmax(model(batch), dim=1)[0].tolist()
    latency_ms = (time.perf_counter() - started) * 1000
    index = max(range(len(probabilities)), key=probabilities.__getitem__)
    image_bytes = image_path.read_bytes()
    return {
        "captured_at": datetime.now(timezone.utc).astimezone().isoformat(),
        "image": str(image_path),
        "image_sha256": hashlib.sha256(image_bytes).hexdigest(),
        "predicted_class": class_names[index],
        "confidence": round(probabilities[index], 6),
        "probabilities": {
            name: round(p, 6) for name, p in zip(class_names, probabilities)
        },
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
    parser.add_argument("--model", required=True, type=Path, help="ruta del model.pt")
    source = parser.add_mutually_exclusive_group(required=True)
    source.add_argument("--image", type=Path, help="clasificar un archivo existente")
    source.add_argument("--camera", action="store_true", help="capturar con la webcam y clasificar")
    source.add_argument("--loop", type=float, metavar="SEGUNDOS", help="captura continua cada N segundos")
    parser.add_argument("--save-dir", type=Path, default=None, help="conservar las capturas aquí")
    args = parser.parse_args()

    model, class_names, transform = load_checkpoint(args.model)
    print(json.dumps({"loaded": str(args.model), "classes": class_names}), flush=True)

    if args.image:
        print(json.dumps(classify(model, class_names, transform, args.image)), flush=True)
        return
    if args.camera:
        print(json.dumps(classify(model, class_names, transform, capture(args.save_dir))), flush=True)
        return
    while True:
        try:
            print(json.dumps(classify(model, class_names, transform, capture(args.save_dir))), flush=True)
        except SystemExit as error:
            print(json.dumps({"error": str(error)}), file=sys.stderr, flush=True)
        time.sleep(args.loop)


if __name__ == "__main__":
    main()

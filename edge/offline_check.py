"""Prueba de autonomía sin red para la compuerta M2 (P4-1.2).

Bloquea TODA la red a nivel de proceso (cualquier intento de abrir un socket
o resolver un nombre lanza error) y luego carga el modelo ONNX y clasifica una
imagen. Si la inferencia termina, queda probado que el camino de inferencia no
hace ninguna llamada de red: el dispositivo clasifica de forma autónoma.

Esta prueba es complementaria a la demostración física (desconectar el cable o
el WiFi mientras corre `edge_infer_onnx.py --loop`): aquí se garantiza por
código que ni siquiera existe la posibilidad de usar la red.

Uso:
    python offline_check.py --model model.int8.onnx --image captura.jpg
"""

from __future__ import annotations

import argparse
import json
import socket
from pathlib import Path


def _blocked(*args, **kwargs):
    raise OSError("red deshabilitada por offline_check (prueba de autonomía M2)")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--model", required=True, type=Path)
    parser.add_argument("--image", required=True, type=Path)
    parser.add_argument("--classes", nargs="+", default=["car", "person"])
    args = parser.parse_args()

    # A partir de aquí ninguna librería puede tocar la red.
    socket.socket = _blocked
    socket.create_connection = _blocked
    socket.getaddrinfo = _blocked
    print(json.dumps({"red": "bloqueada", "sockets": "deshabilitados"}), flush=True)

    import numpy as np
    import onnxruntime as ort
    from PIL import Image

    session = ort.InferenceSession(str(args.model), providers=["CPUExecutionProvider"])
    mean = np.array([0.485, 0.456, 0.406], dtype=np.float32).reshape(3, 1, 1)
    std = np.array([0.229, 0.224, 0.225], dtype=np.float32).reshape(3, 1, 1)
    image = Image.open(args.image).convert("RGB").resize((128, 128), Image.BILINEAR)
    tensor = ((np.asarray(image, dtype=np.float32) / 255.0).transpose(2, 0, 1) - mean) / std
    logits = session.run(None, {"image": tensor[np.newaxis].astype(np.float32)})[0].reshape(-1)
    exp = np.exp(logits - logits.max())
    probabilities = exp / exp.sum()
    index = int(probabilities.argmax())
    print(
        json.dumps(
            {
                "imagen": args.image.name,
                "predicted_class": args.classes[index],
                "confidence": round(float(probabilities[index]), 4),
                "clasifico_sin_red": True,
            }
        ),
        flush=True,
    )


if __name__ == "__main__":
    main()

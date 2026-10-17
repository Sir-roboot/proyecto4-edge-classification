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
    python offline_check.py --model model.int8.onnx --image captura.jpg \\
        --ort-optimization disabled
"""

from __future__ import annotations

import argparse
import json
import socket
from pathlib import Path

import numpy as np
from PIL import Image

import edge_infer_onnx as eio


def _blocked(*args, **kwargs):
    raise OSError("red deshabilitada por offline_check (prueba de autonomía M2)")


def run_check(model_path: Path, image_path: Path, classes: list[str],
              ort_optimization: str = "default") -> dict:
    """Carga con el loader común y clasifica sin tocar la red."""
    session, input_name, size, meta = eio.load_session(
        model_path, ort_optimization=ort_optimization
    )
    with Image.open(image_path) as image:
        batch = eio.preprocess(image, size)
    raw = session.run(None, {input_name: batch})[0]
    probabilities = eio.to_probabilities(np.asarray(raw, dtype=np.float32).reshape(-1))
    if len(probabilities) != len(classes):
        raise SystemExit(
            f"el modelo produjo {len(probabilities)} salidas pero hay "
            f"{len(classes)} clases {classes}"
        )
    index = int(np.argmax(probabilities))
    return {
        "imagen": image_path.name,
        "predicted_class": classes[index],
        "confidence": round(float(probabilities[index]), 4),
        "clasifico_sin_red": True,
        "runtime": meta["runtime"],
        "providers": meta["providers"],
        "ort_optimization": meta["optimization"],
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--model", required=True, type=Path)
    parser.add_argument("--image", required=True, type=Path)
    parser.add_argument(
        "--ort-optimization",
        choices=eio.ORT_OPTIMIZATION_LEVELS,
        default="default",
        help="nivel de optimización ORT (def: default = SessionOptions previo)",
    )
    parser.add_argument("--classes", nargs="+", default=["car", "person"])
    args = parser.parse_args()

    # A partir de aquí ninguna librería puede tocar la red.
    socket.socket = _blocked
    socket.create_connection = _blocked
    socket.getaddrinfo = _blocked
    print(json.dumps({"red": "bloqueada", "sockets": "deshabilitados"}), flush=True)

    print(
        json.dumps(
            run_check(args.model, args.image, args.classes, args.ort_optimization)
        ),
        flush=True,
    )


if __name__ == "__main__":
    main()

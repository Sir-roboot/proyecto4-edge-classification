"""Demo físico de autonomía sin red para M2 (P4-1.2).

Corre en bucle: en cada iteración (1) sondea si hay Internet alcanzable,
(2) captura con la webcam y (3) clasifica con el modelo ONNX. Escribe una
línea JSONL con la hora, el estado de la red y la predicción.

Pensado para la demostración física: se arranca con `nohup` para que sobreviva
a la caída del SSH, se **desconecta el cable/WiFi** un minuto y se reconecta.
Las líneas con `"network_reachable": false` y `predicted_class` presente
registran inferencia mientras falla el sondeo de un destino. Deben acompañarse
de la observación del corte físico de red; ese sondeo no prueba por sí solo
que todas las interfaces o rutas estuvieran desconectadas.

El sondeo de red es independiente del camino de inferencia (el modelo ONNX no
abre sockets); solo sirve para fechar el corte en la misma bitácora.

Uso:
    nohup python offline_demo.py --model model.int8.onnx --interval 5 \
        > offline-demo.jsonl 2>&1 &
"""

from __future__ import annotations

import argparse
import json
import socket
import time
from datetime import datetime, timezone
from pathlib import Path

import edge_infer_onnx as eio


def network_reachable(host: str = "8.8.8.8", port: int = 53, timeout: float = 1.0) -> bool:
    try:
        with socket.create_connection((host, port), timeout=timeout):
            return True
    except OSError:
        return False


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--model", required=True, type=Path)
    parser.add_argument("--interval", type=float, default=5.0)
    parser.add_argument("--save-dir", type=Path, default=Path.home() / "edge-capturas")
    parser.add_argument(
        "--ort-optimization",
        choices=eio.ORT_OPTIMIZATION_LEVELS,
        default="default",
        help="nivel de optimización ORT (def: default = SessionOptions previo)",
    )
    parser.add_argument("--classes", nargs="+", default=["car", "person"])
    args = parser.parse_args()

    session, input_name, size, _ = eio.load_session(
        args.model, ort_optimization=args.ort_optimization
    )
    version = eio.model_version(args.model)

    while True:
        net = network_reachable()
        try:
            image_path, captured_at = eio.capture(args.save_dir)
            result = eio.classify(
                session, input_name, size, args.classes, image_path, version,
                captured_at=captured_at,
            )
            line = {
                "ts": result["captured_at"],
                "network_reachable": net,
                "predicted_class": result["predicted_class"],
                "confidence": result["confidence"],
                "inference_ms": result["inference_ms"],
            }
        except SystemExit as error:
            line = {
                "ts": datetime.now(timezone.utc).astimezone().isoformat(),
                "network_reachable": net,
                "error": str(error),
            }
        print(json.dumps(line), flush=True)
        time.sleep(args.interval)


if __name__ == "__main__":
    main()

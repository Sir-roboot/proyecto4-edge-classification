"""Utilidades compartidas por los tests del edge."""

from __future__ import annotations

import sys
from pathlib import Path

EDGE_DIR = Path(__file__).resolve().parents[1]
TESTS_DIR = Path(__file__).resolve().parent
for _path in (EDGE_DIR, TESTS_DIR):
    if str(_path) not in sys.path:
        sys.path.insert(0, str(_path))

import numpy as np  # noqa: E402
from PIL import Image  # noqa: E402

DEFAULT_PROBABILITIES = np.array([[0.2, 0.8]], dtype=np.float32)


class FakeInput:
    name = "input"
    shape = [1, 3, 16, 16]
    type = "tensor(float)"


class FakeOutput:
    name = "output"
    shape = [1, 2]


class FakeSession:
    """Sesión ORT mínima: no carga un modelo ni ejecuta inferencia real."""

    def __init__(self, output: np.ndarray | None = None):
        self.output = DEFAULT_PROBABILITIES if output is None else output
        self.feeds: list[dict] = []

    def run(self, output_names, feeds):
        self.feeds.append(feeds)
        return [self.output.copy()]

    def get_inputs(self):
        return [FakeInput()]

    def get_outputs(self):
        return [FakeOutput()]

    def get_providers(self):
        return ["CPUExecutionProvider"]


def make_image(directory: str | Path, name: str = "captura.png",
               size: tuple[int, int] = (16, 16), color=(200, 30, 30)) -> Path:
    path = Path(directory) / name
    Image.new("RGB", size, color).save(path)
    return path

import argparse
import hashlib
import json
import os
import platform
import subprocess
import time
from pathlib import Path

import numpy as np
import onnxruntime as ort
from PIL import Image

CLASSES = ["car", "person"]

NORMALIZE_MEAN = np.array(
    [0.485, 0.456, 0.406],
    dtype=np.float32,
).reshape(3, 1, 1)

NORMALIZE_STD = np.array(
    [0.229, 0.224, 0.225],
    dtype=np.float32,
).reshape(3, 1, 1)


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()

    with path.open("rb") as file:
        for chunk in iter(lambda: file.read(1024 * 1024), b""):
            digest.update(chunk)

    return digest.hexdigest()


def raspberry_temperature():
    try:
        result = subprocess.run(
            ["vcgencmd", "measure_temp"],
            capture_output=True,
            text=True,
            check=False,
        )

        value = result.stdout.strip()
        return value or None

    except FileNotFoundError:
        return None


def cpu_governor():
    path = Path("/sys/devices/system/cpu/cpu0/cpufreq/scaling_governor")

    if path.is_file():
        return path.read_text(encoding="utf-8").strip()

    return None


def preprocess(
    image_path: Path,
    size: int,
) -> np.ndarray:
    with Image.open(image_path) as image:
        rgb = image.convert("RGB").resize(
            (size, size),
            Image.BILINEAR,
        )

        array = (
            np.asarray(
                rgb,
                dtype=np.float32,
            )
            / 255.0
        )

    chw = np.transpose(
        array,
        (2, 0, 1),
    )

    normalized = (chw - NORMALIZE_MEAN) / NORMALIZE_STD

    return normalized[np.newaxis, ...].astype(np.float32)


def stats(values):
    array = np.asarray(
        values,
        dtype=np.float64,
    )

    return {
        "p50": float(np.percentile(array, 50)),
        "p95": float(np.percentile(array, 95)),
        "mean": float(np.mean(array)),
        "min": float(np.min(array)),
        "max": float(np.max(array)),
        "all": values,
    }


def benchmark_model(
    model_path: Path,
    image_path: Path,
    warmups: int,
    runs: int,
):
    session = ort.InferenceSession(
        str(model_path),
        providers=["CPUExecutionProvider"],
    )

    input_info = session.get_inputs()[0]
    output_info = session.get_outputs()[0]

    size = 128

    if len(input_info.shape) == 4 and isinstance(
        input_info.shape[2],
        int,
    ):
        size = int(input_info.shape[2])

    # Entrada conocida para comprobar
    batch = preprocess(
        image_path,
        size,
    )

    logits = session.run(
        [output_info.name],
        {input_info.name: batch},
    )[0]

    predicted_index = int(
        np.argmax(
            logits,
            axis=1,
        )[0]
    )

    # 10 calentamientos completos:
    # preprocesamiento + inferencia.
    for _ in range(warmups):
        warm_batch = preprocess(
            image_path,
            size,
        )

        session.run(
            [output_info.name],
            {input_info.name: warm_batch},
        )

    total_times = []
    preprocess_times = []
    inference_times = []

    # 100 mediciones válidas.
    for _ in range(runs):
        total_start = time.perf_counter_ns()

        preprocess_start = time.perf_counter_ns()

        run_batch = preprocess(
            image_path,
            size,
        )

        preprocess_end = time.perf_counter_ns()

        inference_start = time.perf_counter_ns()

        session.run(
            [output_info.name],
            {input_info.name: run_batch},
        )

        inference_end = time.perf_counter_ns()

        total_end = time.perf_counter_ns()

        preprocess_times.append((preprocess_end - preprocess_start) / 1_000_000)

        inference_times.append((inference_end - inference_start) / 1_000_000)

        total_times.append((total_end - total_start) / 1_000_000)

    return {
        "file": str(model_path),
        "size_bytes": model_path.stat().st_size,
        "sha256": sha256_file(model_path),
        "provider": session.get_providers(),
        "input": {
            "name": input_info.name,
            "shape": input_info.shape,
            "dtype": input_info.type,
        },
        "image": {
            "path": str(image_path),
            "sha256": sha256_file(image_path),
        },
        "known_prediction": {
            "index": predicted_index,
            "class": CLASSES[predicted_index],
            "logits": logits.tolist(),
        },
        "warmups": warmups,
        "valid_runs": runs,
        "latency_ms": {
            "preprocessing": stats(preprocess_times),
            "inference": stats(inference_times),
            "preprocess_plus_inference": stats(total_times),
        },
    }


def main():
    parser = argparse.ArgumentParser()

    parser.add_argument(
        "--fp32",
        required=True,
        type=Path,
    )

    parser.add_argument(
        "--int8",
        required=True,
        type=Path,
    )

    parser.add_argument(
        "--image",
        required=True,
        type=Path,
    )

    parser.add_argument(
        "--warmups",
        type=int,
        default=10,
    )

    parser.add_argument(
        "--runs",
        type=int,
        default=100,
    )

    parser.add_argument(
        "--output",
        type=Path,
        default=Path("p4_edge_benchmark_preprocess.json"),
    )

    args = parser.parse_args()

    if args.warmups != 10:
        raise ValueError("P4 requiere exactamente 10 warmups")

    if args.runs != 100:
        raise ValueError("P4 requiere exactamente 100 mediciones")

    for path in (
        args.fp32,
        args.int8,
        args.image,
    ):
        if not path.is_file():
            raise FileNotFoundError(path)

    report = {
        "environment": {
            "platform": platform.platform(),
            "machine": platform.machine(),
            "python": platform.python_version(),
            "onnxruntime": ort.__version__,
            "numpy": np.__version__,
            "logical_cpus": os.cpu_count(),
            "cpu_governor": cpu_governor(),
            "temperature_start": raspberry_temperature(),
        },
        "benchmark_conditions": {
            "image": str(args.image),
            "image_sha256": sha256_file(args.image),
            "provider": "CPUExecutionProvider",
            "warmups": args.warmups,
            "valid_runs": args.runs,
            "measurement_scope": (
                "JPEG open/decode + "
                "RGB conversion + "
                "resize 128x128 + "
                "float32 scaling [0,1] + "
                "ImageNet normalization + "
                "NCHW conversion + "
                "ONNX session.run"
            ),
            "excluded": (
                "camera capture, "
                "SHA/metadata generation, "
                "JSON serialization and "
                "AWS/network transmission"
            ),
        },
    }

    print("Benchmark FP32 preprocess + inference...")

    fp32 = benchmark_model(
        args.fp32,
        args.image,
        args.warmups,
        args.runs,
    )

    print("Benchmark INT8 preprocess + inference...")

    int8 = benchmark_model(
        args.int8,
        args.image,
        args.warmups,
        args.runs,
    )

    report["fp32"] = fp32
    report["int8"] = int8

    fp32_total = fp32["latency_ms"]["preprocess_plus_inference"]

    int8_total = int8["latency_ms"]["preprocess_plus_inference"]

    report["comparison"] = {
        "p50_speedup": (fp32_total["p50"] / int8_total["p50"]),
        "p95_speedup": (fp32_total["p95"] / int8_total["p95"]),
        "same_prediction": (
            fp32["known_prediction"]["class"] == int8["known_prediction"]["class"]
        ),
    }

    report["environment"]["temperature_end"] = raspberry_temperature()

    args.output.write_text(
        json.dumps(
            report,
            indent=2,
        ),
        encoding="utf-8",
    )

    print()
    print("Benchmark OK")

    print()
    print("Scope: preprocessing + inference")

    print()
    print("FP32")
    print(
        "p50:",
        fp32_total["p50"],
        "ms",
    )
    print(
        "p95:",
        fp32_total["p95"],
        "ms",
    )

    print()
    print("INT8")
    print(
        "p50:",
        int8_total["p50"],
        "ms",
    )
    print(
        "p95:",
        int8_total["p95"],
        "ms",
    )

    print()
    print(
        "p50 speedup:",
        report["comparison"]["p50_speedup"],
        "x",
    )

    print(
        "p95 speedup:",
        report["comparison"]["p95_speedup"],
        "x",
    )

    print()
    print(
        "Report:",
        args.output,
    )


if __name__ == "__main__":
    main()

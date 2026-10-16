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

CLASSES = ["car", "person"]
INPUT_SHAPE = (1, 3, 128, 128)


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


def benchmark_model(
    model_path: Path,
    warmups: int,
    runs: int,
):
    options = ort.SessionOptions()

    session = ort.InferenceSession(
        str(model_path),
        sess_options=options,
        providers=["CPUExecutionProvider"],
    )

    input_info = session.get_inputs()[0]
    output_info = session.get_outputs()[0]

    image = np.zeros(
        INPUT_SHAPE,
        dtype=np.float32,
    )

    # Entrada conocida
    logits = session.run(
        [output_info.name],
        {input_info.name: image},
    )[0]

    predicted_index = int(np.argmax(logits, axis=1)[0])

    # Warmup
    for _ in range(warmups):
        session.run(
            [output_info.name],
            {input_info.name: image},
        )

    timings_ms = []

    # Mediciones válidas
    for _ in range(runs):
        start = time.perf_counter_ns()

        session.run(
            [output_info.name],
            {input_info.name: image},
        )

        end = time.perf_counter_ns()

        timings_ms.append((end - start) / 1_000_000)

    values = np.array(
        timings_ms,
        dtype=np.float64,
    )

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
        "output": {
            "name": output_info.name,
        },
        "known_input": {
            "shape": list(INPUT_SHAPE),
            "predicted_index": predicted_index,
            "predicted_class": CLASSES[predicted_index],
            "logits": logits.tolist(),
        },
        "warmups": warmups,
        "valid_runs": runs,
        "latency_ms": {
            "p50": float(np.percentile(values, 50)),
            "p95": float(np.percentile(values, 95)),
            "mean": float(np.mean(values)),
            "min": float(np.min(values)),
            "max": float(np.max(values)),
            "all": timings_ms,
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
        default=Path("p4_edge_benchmark.json"),
    )

    args = parser.parse_args()

    if args.warmups != 10:
        raise ValueError("La evidencia P4 requiere exactamente 10 warmups")

    if args.runs != 100:
        raise ValueError("La evidencia P4 requiere exactamente 100 mediciones")

    for path in (args.fp32, args.int8):
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
            "input_shape": list(INPUT_SHAPE),
            "input_dtype": "float32",
            "input_value": "zeros",
            "provider": "CPUExecutionProvider",
            "measurement_scope": "model inference only; image capture and preprocessing excluded",
            "warmups": args.warmups,
            "valid_runs": args.runs,
        },
    }

    print("Benchmark FP32...")
    fp32 = benchmark_model(
        args.fp32,
        args.warmups,
        args.runs,
    )

    print("Benchmark INT8...")
    int8 = benchmark_model(
        args.int8,
        args.warmups,
        args.runs,
    )

    report["fp32"] = fp32
    report["int8"] = int8

    report["comparison"] = {
        "size_reduction_percent": (1 - int8["size_bytes"] / fp32["size_bytes"]) * 100,
        "p50_speedup": (fp32["latency_ms"]["p50"] / int8["latency_ms"]["p50"]),
        "p95_speedup": (fp32["latency_ms"]["p95"] / int8["latency_ms"]["p95"]),
        "same_known_prediction": (
            fp32["known_input"]["predicted_class"]
            == int8["known_input"]["predicted_class"]
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
    print("FP32")
    print(
        "p50:",
        fp32["latency_ms"]["p50"],
        "ms",
    )
    print(
        "p95:",
        fp32["latency_ms"]["p95"],
        "ms",
    )

    print()
    print("INT8")
    print(
        "p50:",
        int8["latency_ms"]["p50"],
        "ms",
    )
    print(
        "p95:",
        int8["latency_ms"]["p95"],
        "ms",
    )

    print()
    print(
        "Size reduction:",
        report["comparison"]["size_reduction_percent"],
        "%",
    )

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

    print(
        "Same known prediction:",
        report["comparison"]["same_known_prediction"],
    )

    print()
    print(
        "Report:",
        args.output,
    )


if __name__ == "__main__":
    main()

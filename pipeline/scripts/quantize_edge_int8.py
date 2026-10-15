from pathlib import Path
import hashlib
import json

import numpy as np
import onnxruntime as ort
from PIL import Image
from onnxruntime.quantization import (
    CalibrationDataReader,
    CalibrationMethod,
    QuantFormat,
    QuantType,
    quantize_static,
)
from onnxruntime.quantization.shape_inference import quant_pre_process

from dataset_quality.classifier.data import load_manifest, split_records
from dataset_quality.classifier.predict import load_checkpoint


CHECKPOINT = Path("artifacts/classifier/release/v1.0.0/model.pt")
FP32_MODEL = Path("artifacts/classifier/edge/v1.0.0/model.onnx")
MANIFEST = Path("data/processed/classifier_split_manifest.json")

OUTPUT_DIR = Path("artifacts/classifier/edge/v1.0.0")
PREPROCESSED_MODEL = OUTPUT_DIR / "model.preprocessed.onnx"
INT8_MODEL = OUTPUT_DIR / "model.int8.onnx"
REPORT = OUTPUT_DIR / "quantization.json"

EXPECTED_MANIFEST_SHA256 = (
    "394743403f8a263b462687b733272e9993d7dddaea6a1229f8ee2896b82f3f7d"
)

CALIBRATION_PER_CLASS = 64


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()

    with path.open("rb") as file:
        for chunk in iter(lambda: file.read(1024 * 1024), b""):
            digest.update(chunk)

    return digest.hexdigest()


class TrainCalibrationReader(CalibrationDataReader):
    def __init__(self, classifier):
        loaded = load_manifest(MANIFEST)

        if loaded.sha256 != EXPECTED_MANIFEST_SHA256:
            raise ValueError(
                f"Manifest SHA-256 incorrecto: {loaded.sha256}"
            )

        train_records = split_records(
            loaded.manifest,
            "train",
        )

        selected = []
        counts = {}

        for record in train_records:
            label = record.category_name
            current = counts.get(label, 0)

            if current < CALIBRATION_PER_CLASS:
                selected.append(record)
                counts[label] = current + 1

            if all(
                counts.get(name, 0) >= CALIBRATION_PER_CLASS
                for name in classifier.class_names
            ):
                break

        self.records = selected
        self.class_counts = counts
        self.classifier = classifier
        self.iterator = None

    def _samples(self):
        for record in self.records:
            image_path = Path(record.relative_path)

            with Image.open(image_path) as image:
                tensor = self.classifier.transform(
                    image.convert("RGB")
                )

            yield {
                "image": tensor.unsqueeze(0)
                .numpy()
                .astype(np.float32)
            }

    def get_next(self):
        if self.iterator is None:
            self.iterator = iter(self._samples())

        return next(self.iterator, None)

    def rewind(self):
        self.iterator = None


def main():
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    if not FP32_MODEL.is_file():
        raise FileNotFoundError(
            f"No existe el ONNX FP32: {FP32_MODEL}"
        )

    classifier = load_checkpoint(CHECKPOINT)

    manifest_hash = sha256_file(MANIFEST)

    if manifest_hash != EXPECTED_MANIFEST_SHA256:
        raise ValueError(
            f"Manifest incorrecto: {manifest_hash}"
        )

    # Preprocesamiento recomendado antes de cuantizar
    quant_pre_process(
        str(FP32_MODEL),
        str(PREPROCESSED_MODEL),
    )

    reader = TrainCalibrationReader(classifier)

    print("Calibracion:")
    print("  muestras:", len(reader.records))
    print("  por clase:", reader.class_counts)

    quantize_static(
        model_input=str(PREPROCESSED_MODEL),
        model_output=str(INT8_MODEL),
        calibration_data_reader=reader,
        quant_format=QuantFormat.QDQ,
        activation_type=QuantType.QInt8,
        weight_type=QuantType.QInt8,
        per_channel=True,
        calibrate_method=CalibrationMethod.MinMax,
    )

    # Entrada conocida usada también en la conversión FP32
    image_size = classifier.config.image_size

    known_input = np.zeros(
        (1, 3, image_size, image_size),
        dtype=np.float32,
    )

    fp32_session = ort.InferenceSession(
        str(FP32_MODEL),
        providers=["CPUExecutionProvider"],
    )

    int8_session = ort.InferenceSession(
        str(INT8_MODEL),
        providers=["CPUExecutionProvider"],
    )

    fp32_logits = fp32_session.run(
        ["logits"],
        {"image": known_input},
    )[0]

    int8_logits = int8_session.run(
        ["logits"],
        {"image": known_input},
    )[0]

    fp32_class = int(np.argmax(fp32_logits, axis=1)[0])
    int8_class = int(np.argmax(int8_logits, axis=1)[0])

    report = {
        "source_checkpoint": {
            "path": str(CHECKPOINT),
            "sha256": sha256_file(CHECKPOINT),
        },
        "source_onnx": {
            "path": str(FP32_MODEL),
            "sha256": sha256_file(FP32_MODEL),
            "size_bytes": FP32_MODEL.stat().st_size,
        },
        "manifest": {
            "path": str(MANIFEST),
            "sha256": manifest_hash,
            "split_used_for_calibration": "train",
        },
        "calibration": {
            "samples": len(reader.records),
            "per_class": reader.class_counts,
            "method": "MinMax",
        },
        "quantization": {
            "format": "QDQ",
            "activation_type": "QInt8",
            "weight_type": "QInt8",
            "per_channel": True,
        },
        "int8_model": {
            "path": str(INT8_MODEL),
            "sha256": sha256_file(INT8_MODEL),
            "size_bytes": INT8_MODEL.stat().st_size,
            "onnxruntime": ort.__version__,
        },
        "known_input_test": {
            "shape": list(known_input.shape),
            "fp32_logits": fp32_logits.tolist(),
            "int8_logits": int8_logits.tolist(),
            "fp32_class": classifier.class_names[fp32_class],
            "int8_class": classifier.class_names[int8_class],
            "same_prediction": fp32_class == int8_class,
            "max_abs_difference": float(
                np.max(np.abs(fp32_logits - int8_logits))
            ),
        },
    }

    REPORT.write_text(
        json.dumps(report, indent=2),
        encoding="utf-8",
    )

    print()
    print("Quantization OK")
    print("FP32 size:", FP32_MODEL.stat().st_size, "bytes")
    print("INT8 size:", INT8_MODEL.stat().st_size, "bytes")
    print("INT8 SHA256:", report["int8_model"]["sha256"])
    print("FP32 logits:", fp32_logits.tolist())
    print("INT8 logits:", int8_logits.tolist())
    print(
        "Prediction:",
        classifier.class_names[int8_class],
    )
    print(
        "Same prediction:",
        fp32_class == int8_class,
    )
    print(
        "Max abs difference:",
        report["known_input_test"]["max_abs_difference"],
    )


if __name__ == "__main__":
    main()

from pathlib import Path
import csv
import hashlib
import json

import numpy as np
import onnxruntime as ort
import torch
from PIL import Image

from dataset_quality.classifier.data import load_manifest, split_records
from dataset_quality.classifier.metrics import (
    classification_metrics,
    confusion_matrix,
    metrics_from_predictions_csv,
)
from dataset_quality.classifier.predict import load_checkpoint


CHECKPOINT = Path(
    "artifacts/classifier/release/v1.0.0/model.pt"
)

INT8_MODEL = Path(
    "artifacts/classifier/edge/v1.0.0/model.int8.onnx"
)

MANIFEST = Path(
    "data/processed/classifier_split_manifest.json"
)

REPORT_DIR = Path(
    "reports/classifier/p4"
)

ORIGINAL_CSV = REPORT_DIR / "validation_original_predictions.csv"
INT8_CSV = REPORT_DIR / "validation_int8_predictions.csv"
COMPARISON_JSON = REPORT_DIR / "validation_comparison.json"

EXPECTED_MANIFEST_SHA256 = (
    "394743403f8a263b462687b733272e9993d7dddaea6a1229f8ee2896b82f3f7d"
)


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()

    with path.open("rb") as file:
        for chunk in iter(lambda: file.read(1024 * 1024), b""):
            digest.update(chunk)

    return digest.hexdigest()


def softmax(values):
    values = values - np.max(values)
    exp = np.exp(values)
    return exp / np.sum(exp)


def save_predictions(path, rows, class_names):
    fieldnames = [
        "annotation_id",
        "source_image_id",
        "relative_path",
        "true_label",
        "predicted_label",
        "correct",
        "confidence",
    ]

    for name in class_names:
        fieldnames.append(f"prob_{name}")

    with path.open(
        "w",
        newline="",
        encoding="utf-8",
    ) as file:
        writer = csv.DictWriter(
            file,
            fieldnames=fieldnames,
        )

        writer.writeheader()
        writer.writerows(rows)


def main():
    REPORT_DIR.mkdir(
        parents=True,
        exist_ok=True,
    )

    loaded = load_manifest(MANIFEST)

    if loaded.sha256 != EXPECTED_MANIFEST_SHA256:
        raise ValueError(
            f"Manifest incorrecto: {loaded.sha256}"
        )

    classifier = load_checkpoint(CHECKPOINT)
    class_names = classifier.class_names
    class_to_index = {
        name: index
        for index, name in enumerate(class_names)
    }

    validation = split_records(
        loaded.manifest,
        "val",
    )

    session = ort.InferenceSession(
        str(INT8_MODEL),
        providers=["CPUExecutionProvider"],
    )

    original_rows = []
    int8_rows = []

    y_true = []
    original_pred = []
    int8_pred = []

    changed_predictions = 0

    for number, record in enumerate(validation, start=1):
        image_path = Path(record.relative_path)

        with Image.open(image_path) as image:
            tensor = classifier.transform(
                image.convert("RGB")
            )

        batch = tensor.unsqueeze(0)

        # Modelo original PyTorch
        with torch.no_grad():
            original_logits = classifier.model(batch)

        original_probs = torch.softmax(
            original_logits,
            dim=1,
        ).numpy()[0]

        original_index = int(
            np.argmax(original_probs)
        )

        # Modelo optimizado INT8
        int8_logits = session.run(
            ["logits"],
            {
                "image": batch.numpy().astype(
                    np.float32
                )
            },
        )[0][0]

        int8_probs = softmax(int8_logits)

        int8_index = int(
            np.argmax(int8_probs)
        )

        true_index = class_to_index[
            record.category_name
        ]

        y_true.append(true_index)
        original_pred.append(original_index)
        int8_pred.append(int8_index)

        if original_index != int8_index:
            changed_predictions += 1

        original_row = {
            "annotation_id": record.annotation_id,
            "source_image_id": record.source_image_id,
            "relative_path": record.relative_path,
            "true_label": record.category_name,
            "predicted_label": class_names[
                original_index
            ],
            "correct": (
                original_index == true_index
            ),
            "confidence": float(
                original_probs[original_index]
            ),
        }

        int8_row = {
            "annotation_id": record.annotation_id,
            "source_image_id": record.source_image_id,
            "relative_path": record.relative_path,
            "true_label": record.category_name,
            "predicted_label": class_names[
                int8_index
            ],
            "correct": (
                int8_index == true_index
            ),
            "confidence": float(
                int8_probs[int8_index]
            ),
        }

        for index, name in enumerate(class_names):
            original_row[f"prob_{name}"] = float(
                original_probs[index]
            )

            int8_row[f"prob_{name}"] = float(
                int8_probs[index]
            )

        original_rows.append(original_row)
        int8_rows.append(int8_row)

        if number % 25 == 0:
            print(
                f"Procesadas {number}/{len(validation)}"
            )

    original_metrics = classification_metrics(
        confusion_matrix(
            y_true,
            original_pred,
            len(class_names),
        ),
        class_names,
    )

    int8_metrics = classification_metrics(
        confusion_matrix(
            y_true,
            int8_pred,
            len(class_names),
        ),
        class_names,
    )

    save_predictions(
        ORIGINAL_CSV,
        original_rows,
        class_names,
    )

    save_predictions(
        INT8_CSV,
        int8_rows,
        class_names,
    )

    # Recalcular desde CSV para demostrar
    # que las métricas son auditables.
    original_recomputed = (
        metrics_from_predictions_csv(
            ORIGINAL_CSV
        )
    )

    int8_recomputed = (
        metrics_from_predictions_csv(
            INT8_CSV
        )
    )

    report = {
        "manifest": {
            "path": str(MANIFEST),
            "sha256": loaded.sha256,
            "split": "val",
            "samples": len(validation),
        },
        "classes": class_names,
        "original": {
            "model": str(CHECKPOINT),
            "sha256": sha256_file(CHECKPOINT),
            "size_bytes": CHECKPOINT.stat().st_size,
            "metrics": original_metrics,
        },
        "optimized": {
            "model": str(INT8_MODEL),
            "sha256": sha256_file(INT8_MODEL),
            "size_bytes": INT8_MODEL.stat().st_size,
            "metrics": int8_metrics,
        },
        "comparison": {
            "changed_predictions": changed_predictions,
            "accuracy_difference": (
                int8_metrics["accuracy"]
                - original_metrics["accuracy"]
            ),
            "macro_f1_difference": (
                int8_metrics["macro_f1"]
                - original_metrics["macro_f1"]
            ),
        },
        "audit": {
            "original_csv_recomputed":
                original_recomputed,
            "int8_csv_recomputed":
                int8_recomputed,
        },
    }

    COMPARISON_JSON.write_text(
        json.dumps(
            report,
            indent=2,
        ),
        encoding="utf-8",
    )

    print()
    print("Comparison OK")
    print("Validation samples:", len(validation))

    print()
    print("ORIGINAL")
    print(
        "Accuracy:",
        original_metrics["accuracy"],
    )
    print(
        "Macro F1:",
        original_metrics["macro_f1"],
    )
    print(
        "Per class:",
        original_metrics["per_class"],
    )

    print()
    print("INT8")
    print(
        "Accuracy:",
        int8_metrics["accuracy"],
    )
    print(
        "Macro F1:",
        int8_metrics["macro_f1"],
    )
    print(
        "Per class:",
        int8_metrics["per_class"],
    )

    print()
    print(
        "Changed predictions:",
        changed_predictions,
    )
    print(
        "Accuracy difference:",
        report["comparison"][
            "accuracy_difference"
        ],
    )
    print(
        "Macro F1 difference:",
        report["comparison"][
            "macro_f1_difference"
        ],
    )


if __name__ == "__main__":
    main()
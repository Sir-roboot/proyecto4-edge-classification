from pathlib import Path
import hashlib
import json

import numpy as np
import onnx
import onnxruntime as ort
import torch

from dataset_quality.classifier.predict import load_checkpoint


CHECKPOINT = Path("artifacts/classifier/release/v1.0.0/model.pt")
OUTPUT_DIR = Path("artifacts/classifier/edge/v1.0.0")
OUTPUT_MODEL = OUTPUT_DIR / "model.onnx"
OUTPUT_REPORT = OUTPUT_DIR / "conversion.json"

EXPECTED_SHA256 = (
    "fe1c2370cb9d811d32cccc27edf0beeb"
    "3c440fe758c467a9e3fb91a73e6047cb"
)


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()

    with path.open("rb") as file:
        for chunk in iter(lambda: file.read(1024 * 1024), b""):
            digest.update(chunk)

    return digest.hexdigest()


def main():
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    # 1. Verificar que estamos usando el modelo original correcto
    checkpoint_hash = sha256_file(CHECKPOINT)

    if checkpoint_hash != EXPECTED_SHA256:
        raise ValueError(
            f"SHA-256 incorrecto: {checkpoint_hash}"
        )

    # 2. Cargar checkpoint original
    classifier = load_checkpoint(CHECKPOINT)
    model = classifier.model
    model.eval()

    image_size = classifier.config.image_size

    # Entrada conocida y reproducible
    example_input = torch.zeros(
        1,
        3,
        image_size,
        image_size,
        dtype=torch.float32,
    )

    # 3. Predicción original PyTorch
    with torch.no_grad():
        pytorch_logits = model(example_input)

    # 4. Exportar ONNX
    onnx_program = torch.onnx.export(
        model,
        (example_input,),
        input_names=["image"],
        output_names=["logits"],
        dynamo=True,
        external_data=False,
        optimize=True,
    )

    onnx_program.save(OUTPUT_MODEL)

    # 5. Validar estructura ONNX
    onnx_model = onnx.load(OUTPUT_MODEL)
    onnx.checker.check_model(onnx_model)

    # 6. Ejecutar la misma entrada con ONNX Runtime
    session = ort.InferenceSession(
        str(OUTPUT_MODEL),
        providers=["CPUExecutionProvider"],
    )

    onnx_logits = session.run(
        ["logits"],
        {"image": example_input.numpy()},
    )[0]

    pytorch_array = pytorch_logits.numpy()

    # Diferencia numérica entre ambos runtimes
    max_abs_diff = float(
        np.max(np.abs(pytorch_array - onnx_logits))
    )

    pytorch_class = int(np.argmax(pytorch_array, axis=1)[0])
    onnx_class = int(np.argmax(onnx_logits, axis=1)[0])

    if pytorch_class != onnx_class:
        raise RuntimeError(
            "La predicción ONNX no coincide con PyTorch"
        )

    # 7. Crear evidencia de conversión
    report = {
        "source": {
            "file": str(CHECKPOINT),
            "sha256": checkpoint_hash,
            "run_id": classifier.checkpoint["run_id"],
            "architecture": classifier.config.architecture,
            "classes": classifier.class_names,
        },
        "input": {
            "shape": list(example_input.shape),
            "dtype": str(example_input.dtype),
            "image_size": image_size,
            "preprocessing": classifier.checkpoint["preprocessing"],
        },
        "onnx": {
            "file": str(OUTPUT_MODEL),
            "sha256": sha256_file(OUTPUT_MODEL),
            "size_bytes": OUTPUT_MODEL.stat().st_size,
            "runtime": ort.__version__,
        },
        "known_input_test": {
            "pytorch_logits": pytorch_array.tolist(),
            "onnx_logits": onnx_logits.tolist(),
            "max_abs_difference": max_abs_diff,
            "pytorch_class": classifier.class_names[pytorch_class],
            "onnx_class": classifier.class_names[onnx_class],
            "same_prediction": pytorch_class == onnx_class,
        },
    }

    OUTPUT_REPORT.write_text(
        json.dumps(report, indent=2),
        encoding="utf-8",
    )

    print("Conversion OK")
    print("Original SHA256:", checkpoint_hash)
    print("ONNX:", OUTPUT_MODEL)
    print("ONNX SHA256:", report["onnx"]["sha256"])
    print("ONNX size:", report["onnx"]["size_bytes"], "bytes")
    print("PyTorch logits:", pytorch_array.tolist())
    print("ONNX logits:", onnx_logits.tolist())
    print("Max abs difference:", max_abs_diff)
    print(
        "Prediction:",
        classifier.class_names[onnx_class],
    )


if __name__ == "__main__":
    main()
"""Verify the delivered P4 validation manifest and predictions, without AWS/ML deps.

Default is read-only. --package-from creates a reproducible ZIP from the exact
original manifest; it refuses a different hash or replacement of an existing ZIP.
The ZIP contains metadata, not training images, weights or credentials.
"""
from __future__ import annotations

import argparse
import csv
import hashlib
import json
from pathlib import Path
import zipfile

ROOT = Path(__file__).resolve().parents[1]
PACK = ROOT / "docs/evidence/p4-1-3/validation-manifest.zip"
MEMBER = "classifier_split_manifest.json"
MANIFEST_SHA256 = "394743403f8a263b462687b733272e9993d7dddaea6a1229f8ee2896b82f3f7d"
CLASSES = ("car", "person")


def require(condition: bool, message: str) -> None:
    if not condition:
        raise ValueError(message)


def manifest_bytes(pack: Path) -> bytes:
    with zipfile.ZipFile(pack) as archive:
        require(archive.namelist() == [MEMBER], "ZIP must contain only the manifest")
        require(archive.getinfo(MEMBER).file_size == 198050, "Unexpected manifest size")
        data = archive.read(MEMBER)  # Never extract paths supplied by an archive.
    require(hashlib.sha256(data).hexdigest() == MANIFEST_SHA256, "Manifest SHA-256 mismatch")
    return data


def package_manifest(source: Path, target: Path) -> None:
    data = source.read_bytes()
    require(hashlib.sha256(data).hexdigest() == MANIFEST_SHA256, "Source is not the original P3 manifest")
    if target.exists():
        require(manifest_bytes(target) == data, "Refusing to overwrite existing evidence")
        return
    target.parent.mkdir(parents=True, exist_ok=True)
    info = zipfile.ZipInfo(MEMBER, date_time=(2026, 10, 16, 0, 0, 0))
    info.compress_type = zipfile.ZIP_DEFLATED
    info.external_attr = 0o644 << 16
    with zipfile.ZipFile(target, "x") as archive:
        archive.writestr(info, data)


def verify_predictions(rows: list[dict], validation: list[dict]) -> dict:
    expected = {str(row["annotation_id"]): row for row in validation}
    ids = [row["annotation_id"] for row in rows]
    require(len(ids) == len(set(ids)), "Duplicate prediction IDs")
    require(set(ids) == set(expected), "Missing or extra validation predictions")
    matrix = [[0, 0], [0, 0]]
    for row in rows:
        reference = expected[row["annotation_id"]]
        require(row["true_label"] == reference["category_name"], "Ground-truth label mismatch")
        require(row["source_image_id"] == str(reference["source_image_id"]), "Source image mismatch")
        require(row["relative_path"] == reference["relative_path"], "Crop path mismatch")
        require(row["true_label"] in CLASSES and row["predicted_label"] in CLASSES, "Unknown class")
        matrix[CLASSES.index(row["true_label"])][CLASSES.index(row["predicted_label"])] += 1
    per_class = {}
    for i, name in enumerate(CLASSES):
        tp = matrix[i][i]
        fn = sum(matrix[i]) - tp
        fp = sum(row[i] for row in matrix) - tp
        require(sum(matrix[i]) > 0, f"No validation samples for {name}")
        per_class[name] = {"support": sum(matrix[i]), "f1": 2 * tp / (2 * tp + fp + fn) if 2 * tp + fp + fn else 0}
    correct = sum(matrix[i][i] for i in range(2))
    return {"samples": len(rows), "correct": correct, "accuracy": correct / len(rows),
            "f1_macro": sum(row["f1"] for row in per_class.values()) / 2,
            "per_class": per_class, "confusion_matrix": matrix}


def verify(pack: Path, original: Path, optimized: Path) -> dict:
    data = manifest_bytes(pack)
    manifest = json.loads(data)
    splits = {row["name"]: row["crops"] for row in manifest["splits"]}
    require(set(splits) == {"train", "val", "test"}, "Unexpected splits")
    for name, crops in splits.items():
        require(len({r["annotation_id"] for r in crops}) == len(crops), f"Duplicate {name} IDs")
    for left, right in (("train", "val"), ("train", "test"), ("val", "test")):
        for key in ("annotation_id", "source_image_id"):
            require(not ({r[key] for r in splits[left]} & {r[key] for r in splits[right]}), f"Leakage: {left}/{right}/{key}")
    counts = dict.fromkeys(CLASSES, 0)
    calibration = []
    for crop in sorted(splits["train"], key=lambda r: r["annotation_id"]):
        name = crop["category_name"]
        require(name in CLASSES, "Unknown train class")
        if counts[name] < 64:
            counts[name] += 1
            calibration.append(crop["annotation_id"])
        if all(n == 64 for n in counts.values()):
            break
    require(counts == {"car": 64, "person": 64}, "Incomplete train calibration")
    metrics = []
    for source in (original, optimized):
        with source.open(encoding="utf-8", newline="") as handle:
            metrics.append(verify_predictions(list(csv.DictReader(handle)), splits["val"]))
    drop = 100 * (metrics[0]["accuracy"] - metrics[1]["accuracy"])
    return {"passes": drop <= 2, "manifest_sha256": MANIFEST_SHA256,
            "manifest_bytes": len(data), "original": metrics[0], "optimized": metrics[1],
            "accuracy_drop_pp": drop, "calibration": {"samples": len(calibration), "per_class": counts,
            "annotation_ids": calibration, "split": "train", "overlap_with_val_test": 0},
            "scope": "Manifest, sample provenance and arithmetic verified; no inference or quantization executed."}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--pack", type=Path, default=PACK)
    parser.add_argument("--package-from", type=Path)
    reports = ROOT / "pipeline/reports/classifier/p4"
    parser.add_argument("--original", type=Path, default=reports / "validation_original_predictions.csv")
    parser.add_argument("--optimized", type=Path, default=reports / "validation_int8_predictions.csv")
    args = parser.parse_args()
    try:
        if args.package_from:
            package_manifest(args.package_from, args.pack)
        result = verify(args.pack, args.original, args.optimized)
    except (OSError, ValueError, KeyError, zipfile.BadZipFile) as error:
        print(json.dumps({"passes": False, "error": str(error)}))
        raise SystemExit(1)
    print(json.dumps(result, indent=2))
    raise SystemExit(0 if result["passes"] else 1)


if __name__ == "__main__":
    main()

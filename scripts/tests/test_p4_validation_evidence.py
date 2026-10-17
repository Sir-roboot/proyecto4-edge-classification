"""Small, offline regression tests for the delivered P4 evidence verifier."""
import csv
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location("validation", ROOT / "scripts/verify_p4_validation_evidence.py")
validation = importlib.util.module_from_spec(spec)
spec.loader.exec_module(validation)


class EvidenceTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.data = validation.manifest_bytes(validation.PACK)
        cls.val = next(s["crops"] for s in json.loads(cls.data)["splits"] if s["name"] == "val")
        with (ROOT / "pipeline/reports/classifier/p4/validation_int8_predictions.csv").open(encoding="utf-8", newline="") as handle:
            cls.rows = list(csv.DictReader(handle))

    def test_exact_manifest_and_203_predictions(self):
        result = validation.verify_predictions(self.rows, self.val)
        self.assertEqual(result["samples"], 203)
        self.assertEqual(result["correct"], 200)

    def test_duplicate_or_missing_sample_rejected(self):
        for bad in (self.rows[:-1], self.rows + [self.rows[0]]):
            with self.assertRaises(ValueError):
                validation.verify_predictions(bad, self.val)

    def test_altered_label_or_source_rejected(self):
        for key, value in (("true_label", "person"), ("source_image_id", "999999"), ("relative_path", "other.png")):
            bad = [dict(r) for r in self.rows]
            bad[0][key] = value
            with self.assertRaises(ValueError):
                validation.verify_predictions(bad, self.val)

    def test_pack_does_not_accept_another_manifest(self):
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / "wrong.json"
            target = Path(directory) / "evidence.zip"
            source.write_text("{}", encoding="utf-8")
            with self.assertRaises(ValueError):
                validation.package_manifest(source, target)
            self.assertFalse(target.exists())


if __name__ == "__main__":
    unittest.main()

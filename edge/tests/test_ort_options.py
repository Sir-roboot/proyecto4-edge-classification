"""Mapeo de opciones ORT y uso del loader común (sin modelo real)."""

from __future__ import annotations

import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

TESTS_DIR = Path(__file__).resolve().parent
if str(TESTS_DIR) not in sys.path:
    sys.path.insert(0, str(TESTS_DIR))

from support import FakeSession, make_image  # noqa: E402

import edge_infer_onnx as eio  # noqa: E402
import offline_check  # noqa: E402


class BuildSessionOptionsTests(unittest.TestCase):
    def test_default_preserves_previous_behavior(self):
        # None => onnxruntime crea su SessionOptions por defecto, como antes.
        self.assertIsNone(eio.build_session_options("default"))

    def test_levels_map_to_expected_graph_optimization(self):
        expected = {
            "basic": eio.ort.GraphOptimizationLevel.ORT_ENABLE_BASIC,
            "disabled": eio.ort.GraphOptimizationLevel.ORT_DISABLE_ALL,
            "extended": eio.ort.GraphOptimizationLevel.ORT_ENABLE_EXTENDED,
            "all": eio.ort.GraphOptimizationLevel.ORT_ENABLE_ALL,
        }
        for level, graph_level in expected.items():
            with self.subTest(level=level):
                options = eio.build_session_options(level)
                self.assertIsNotNone(options)
                self.assertEqual(options.graph_optimization_level, graph_level)

    def test_unknown_level_is_rejected(self):
        with self.assertRaises(ValueError):
            eio.build_session_options("turbo")


class LoadSessionMetadataTests(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.model = Path(self._tmp.name) / "model.onnx"
        self.model.write_bytes(b"fake-onnx")

    def _load(self, level: str):
        seen: dict = {}

        def factory(model_path, sess_options=None, providers=None):
            seen.update(
                model_path=model_path,
                sess_options=sess_options,
                providers=providers,
            )
            return FakeSession()

        with mock.patch.object(eio.ort, "InferenceSession", side_effect=factory):
            loaded = eio.load_session(self.model, ort_optimization=level)
        return seen, loaded

    def test_default_passes_no_options_and_records_runtime(self):
        seen, (session, input_name, size, meta) = self._load("default")
        self.assertIsNone(seen["sess_options"])
        self.assertEqual(seen["providers"], ["CPUExecutionProvider"])
        self.assertEqual(input_name, "input")
        self.assertEqual(size, 16)
        self.assertEqual(meta["optimization"], "default")
        self.assertEqual(meta["providers"], ["CPUExecutionProvider"])
        self.assertEqual(meta["runtime_version"], eio.ort.__version__)
        self.assertIn("onnxruntime", meta["runtime"])

    def test_basic_passes_selected_options(self):
        seen, (_, _, _, meta) = self._load("basic")
        self.assertIsNotNone(seen["sess_options"])
        self.assertEqual(
            seen["sess_options"].graph_optimization_level,
            eio.ort.GraphOptimizationLevel.ORT_ENABLE_BASIC,
        )
        self.assertEqual(meta["optimization"], "basic")


class OfflineCheckLoaderTests(unittest.TestCase):
    def test_offline_check_uses_the_common_loader(self):
        self.assertIs(offline_check.eio.load_session, eio.load_session)

    def test_run_check_requests_selected_optimization_from_common_loader(self):
        with tempfile.TemporaryDirectory() as tmp:
            image = make_image(tmp)
            calls: dict = {}

            def fake_load(model_path, ort_optimization="default"):
                calls["model_path"] = model_path
                calls["ort_optimization"] = ort_optimization
                return FakeSession(), "input", 16, {
                    "runtime": "onnxruntime test",
                    "providers": ["CPUExecutionProvider"],
                    "optimization": ort_optimization,
                }

            with mock.patch.object(offline_check.eio, "load_session",
                                   side_effect=fake_load):
                result = offline_check.run_check(
                    Path("model.onnx"), image, ["car", "person"], "basic"
                )

        self.assertEqual(calls["ort_optimization"], "basic")
        self.assertEqual(result["predicted_class"], "person")
        self.assertTrue(result["clasifico_sin_red"])
        self.assertEqual(result["ort_optimization"], "basic")
        self.assertEqual(result["providers"], ["CPUExecutionProvider"])
        self.assertEqual(result["runtime"], "onnxruntime test")


if __name__ == "__main__":
    unittest.main()

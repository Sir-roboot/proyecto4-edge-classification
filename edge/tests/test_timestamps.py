"""Timestamps de captura vs. inferencia y validación de fecha."""

from __future__ import annotations

import contextlib
import io
import json
import sys
import tempfile
import unittest
from datetime import datetime
from pathlib import Path
from unittest import mock

TESTS_DIR = Path(__file__).resolve().parent
if str(TESTS_DIR) not in sys.path:
    sys.path.insert(0, str(TESTS_DIR))

from support import FakeSession, make_image  # noqa: E402

import edge_infer_onnx as eio  # noqa: E402


class CapturedAtValidationTests(unittest.TestCase):
    def test_explicit_old_timestamp_is_preserved_exactly(self):
        old = "2019-12-31T23:59:58.123456+05:30"
        self.assertEqual(eio.validate_captured_at(old), old)

    def test_z_and_offset_are_accepted_without_rewriting(self):
        for value in (
            "2024-01-02T03:04:05Z",
            "2024-01-02T03:04:05.000+02:00",
            "2024-07-08T09:10:11-07:00",
        ):
            with self.subTest(value=value):
                self.assertEqual(eio.validate_captured_at(value), value)

    def test_naive_and_malformed_are_rejected(self):
        for value in (
            "2024-01-02T03:04:05",
            "2024-01-02",
            "no-es-fecha",
            "",
        ):
            with self.subTest(value=value):
                with self.assertRaises(ValueError):
                    eio.validate_captured_at(value)

    def test_python_iso_extensions_not_in_backend_contract_are_rejected(self):
        for value in (
            "2024-01-02 03:04:05Z", "20240102T030405Z",
            "2024-01-02T03:04:05+0200", "2024-01-02T03:04:05+02",
            "2024-01-02T03:04Z", "2024-01-02T03:04:05,123Z",
            "2024-01-02T03:04:05+02:00:30", "2024-01-02T03:04:05+00:99",
            "2024-02-30T03:04:05Z", "2024-01-02T03:04:05Z\n",
        ):
            with self.subTest(value=value), self.assertRaises(ValueError):
                eio.validate_captured_at(value)

    def test_contract_lowercase_markers_are_preserved(self):
        value = "2024-01-02t03:04:05z"
        self.assertEqual(eio.validate_captured_at(value), value)


class ClassifyTimestampTests(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.image = make_image(self._tmp.name)
        self.session = FakeSession()

    def _classify(self, **kwargs):
        return eio.classify(
            self.session, "input", 16, ["car", "person"], self.image, "model-v",
            **kwargs,
        )

    def test_explicit_capture_is_kept_and_inferred_at_is_separate(self):
        old = "2018-06-07T08:09:10+00:00"
        result = self._classify(captured_at=old)
        self.assertEqual(result["captured_at"], old)
        self.assertIn("inferred_at", result)
        self.assertNotEqual(result["inferred_at"], old)
        inferred = datetime.fromisoformat(result["inferred_at"])
        self.assertIsNotNone(inferred.tzinfo)
        self.assertIsNotNone(inferred.utcoffset())

    def test_z_capture_is_kept_byte_for_byte(self):
        value = "2024-01-02T03:04:05Z"
        result = self._classify(captured_at=value)
        self.assertEqual(result["captured_at"], value)

    def test_file_without_date_has_null_capture_and_real_inferred_at(self):
        result = self._classify()
        self.assertIsNone(result["captured_at"])
        self.assertIn("inferred_at", result)
        self.assertIsNotNone(result["inferred_at"])
        inferred = datetime.fromisoformat(result["inferred_at"])
        self.assertIsNotNone(inferred.utcoffset())


class CaptureTimestampTests(unittest.TestCase):
    def test_timestamp_is_taken_after_successful_acquisition(self):
        events: list[str] = []

        class Completed:
            returncode = 0
            stderr = ""

        def fake_run(command, **kwargs):
            Path(command[-1]).write_bytes(b"fake-jpeg")
            events.append("acquisition")
            return Completed()

        def fake_now():
            events.append("timestamp")
            return "2025-01-02T03:04:05-06:00"

        with tempfile.TemporaryDirectory() as tmp:
            with mock.patch.object(eio.subprocess, "run", side_effect=fake_run), \
                    mock.patch.object(eio, "_now_iso", side_effect=fake_now):
                path, captured_at = eio.capture(Path(tmp))
            self.assertTrue(path.is_file())

        self.assertEqual(events, ["acquisition", "timestamp"])
        self.assertEqual(captured_at, "2025-01-02T03:04:05-06:00")

    def test_failed_acquisition_does_not_produce_timestamp(self):
        class Failed:
            returncode = 1
            stderr = "sin cámara"

        with tempfile.TemporaryDirectory() as tmp:
            with mock.patch.object(eio.subprocess, "run", return_value=Failed()), \
                    mock.patch.object(eio, "_now_iso",
                                      side_effect=AssertionError("no debe fechar")):
                with self.assertRaises(SystemExit):
                    eio.capture(Path(tmp))


class InferenceCliTimestampTests(unittest.TestCase):
    def test_malformed_captured_at_is_rejected_before_loading_model(self):
        argv = ["edge_infer_onnx.py", "--model", "m.onnx", "--image", "x.png",
                "--captured-at", "2024-01-02T03:04:05"]
        with mock.patch.object(sys, "argv", argv), \
                mock.patch.object(eio, "load_session",
                                  side_effect=AssertionError("no debe cargar")):
            with contextlib.redirect_stderr(io.StringIO()):
                with self.assertRaises(SystemExit) as raised:
                    eio.main()
        self.assertEqual(raised.exception.code, 2)

    def test_captured_at_is_incompatible_with_camera(self):
        argv = ["edge_infer_onnx.py", "--model", "m.onnx", "--camera",
                "--captured-at", "2024-01-02T03:04:05Z"]
        with mock.patch.object(sys, "argv", argv), \
                mock.patch.object(eio, "load_session",
                                  side_effect=AssertionError("no debe cargar")):
            with contextlib.redirect_stderr(io.StringIO()):
                with self.assertRaises(SystemExit) as raised:
                    eio.main()
        self.assertEqual(raised.exception.code, 2)

    def test_image_without_date_still_infers_with_null_capture(self):
        seen = {}

        def fake_classify(session, input_name, size, classes, image_path,
                          version, *, captured_at=None):
            seen["captured_at"] = captured_at
            return {
                "captured_at": captured_at,
                "inferred_at": "2026-01-01T00:00:00+00:00",
            }

        argv = ["edge_infer_onnx.py", "--model", "m.onnx", "--image", "x.png"]
        with tempfile.TemporaryDirectory() as tmp:
            model = Path(tmp) / "m.onnx"
            model.write_bytes(b"model")
            argv[2] = str(model)
            with mock.patch.object(sys, "argv", argv), \
                    mock.patch.object(eio, "load_session",
                                      return_value=(FakeSession(), "input", 16, {})), \
                    mock.patch.object(eio, "model_version", return_value="v"), \
                    mock.patch.object(eio, "classify", side_effect=fake_classify), \
                    contextlib.redirect_stdout(io.StringIO()):
                eio.main()

        self.assertIn("captured_at", seen)
        self.assertIsNone(seen["captured_at"])
        json.dumps(seen)  # el resultado debe ser serializable


if __name__ == "__main__":
    unittest.main()

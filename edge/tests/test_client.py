"""Validación de send y preservación exacta en reintentos (HTTP simulado)."""

from __future__ import annotations

import contextlib
import hashlib
import io
import json
import sys
import tempfile
import unittest
from argparse import Namespace
from pathlib import Path
from unittest import mock

TESTS_DIR = Path(__file__).resolve().parent
if str(TESTS_DIR) not in sys.path:
    sys.path.insert(0, str(TESTS_DIR))

from support import FakeSession, make_image  # noqa: E402

import edge_client as ec  # noqa: E402
import edge_infer_onnx as eio  # noqa: E402


def send_args(outbox: Path, *, image: Path | None = None, camera: bool = False,
              captured_at: str | None = None) -> Namespace:
    return Namespace(
        outbox=str(outbox),
        model=Path("model.onnx"),
        image=image,
        camera=camera,
        captured_at=captured_at,
        classes=["car", "person"],
        ort_optimization="default",
    )


def fake_result(image_path: Path, captured_at: str | None) -> dict:
    data = Path(image_path).read_bytes()
    return {
        "captured_at": captured_at,
        "image": str(image_path),
        "image_sha256": hashlib.sha256(data).hexdigest(),
        "model_version": "test-version",
        "predicted_class": "person",
        "confidence": 0.9,
        "probabilities": {"car": 0.1, "person": 0.9},
        "inference_ms": 1.0,
        "inferred_at": "2026-10-16T10:00:00-06:00",
    }


class SendValidationTests(unittest.TestCase):
    def _assert_rejected_before_side_effects(self, args: Namespace, message: str):
        with mock.patch.object(ec, "_config",
                               side_effect=AssertionError("no config")), \
                mock.patch.object(ec.eio, "load_session",
                                  side_effect=AssertionError("no modelo")), \
                mock.patch.object(ec, "_save_record",
                                  side_effect=AssertionError("no outbox")), \
                mock.patch.object(ec, "post_capture",
                                  side_effect=AssertionError("no HTTP")):
            with self.assertRaises(SystemExit) as raised:
                ec.cmd_send(args)
        self.assertIn(message, str(raised.exception))

    def test_image_without_captured_at_is_rejected_early(self):
        with tempfile.TemporaryDirectory() as tmp:
            args = send_args(Path(tmp) / "outbox", image=Path("foto.jpg"))
            self._assert_rejected_before_side_effects(args, "--captured-at")

    def test_camera_with_manual_captured_at_is_rejected_early(self):
        with tempfile.TemporaryDirectory() as tmp:
            args = send_args(Path(tmp) / "outbox", camera=True,
                             captured_at="2024-01-02T03:04:05Z")
            self._assert_rejected_before_side_effects(
                args, "no acepta --captured-at"
            )

    def test_naive_or_malformed_captured_at_is_rejected_early(self):
        for value in ("2024-01-02T03:04:05", "no-es-fecha"):
            with self.subTest(value=value), tempfile.TemporaryDirectory() as tmp:
                args = send_args(Path(tmp) / "outbox", image=Path("foto.jpg"),
                                 captured_at=value)
                self._assert_rejected_before_side_effects(
                    args, "--captured-at inválido"
                )


class CameraSendTimestampTests(unittest.TestCase):
    def test_camera_timestamp_comes_from_acquisition_and_is_not_regenerated(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            image = make_image(root)
            outbox = root / "outbox"
            captured = "2021-03-04T05:06:07-06:00"
            events: list[str] = []
            classify_dates: list[str | None] = []
            posted: dict = {}

            def fake_capture(save_dir):
                events.append("capture")
                return image, captured

            def fake_classify(session, input_name, size, classes, image_path,
                              version, *, captured_at=None):
                events.append("classify")
                classify_dates.append(captured_at)
                return fake_result(image_path, captured_at)

            def fake_post(base_url, token, metadata_json, image_bytes,
                          image_name, mime):
                posted.update(json.loads(metadata_json))
                return 201, "{}"

            args = send_args(outbox, camera=True, captured_at=None)
            with mock.patch.object(ec, "_config",
                                   return_value=("http://x", "t" * 32, "dev")), \
                    mock.patch.object(ec.eio, "load_session",
                                      return_value=(FakeSession(), "input", 16, {})), \
                    mock.patch.object(ec.eio, "model_version", return_value="v"), \
                    mock.patch.object(ec.eio, "capture", side_effect=fake_capture), \
                    mock.patch.object(ec.eio, "classify", side_effect=fake_classify), \
                    mock.patch.object(ec, "post_capture", side_effect=fake_post), \
                    contextlib.redirect_stdout(io.StringIO()), \
                    contextlib.redirect_stderr(io.StringIO()):
                code = ec.cmd_send(args)

            self.assertEqual(code, 0)
            self.assertEqual(events[:2], ["capture", "classify"])
            self.assertEqual(classify_dates, [captured])
            self.assertEqual(posted["captured_at"], captured)
            self.assertNotIn("inferred_at", posted)
            record = json.loads(
                (outbox / f"{posted['capture_id']}.json").read_text(encoding="utf-8")
            )
            self.assertEqual(record["metadata"]["captured_at"], captured)


class RetryPreservationTests(unittest.TestCase):
    def test_failure_then_retry_201_and_200_preserve_id_timestamp_bytes(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            image = make_image(root, name="captura.png")
            original_bytes = image.read_bytes()
            outbox = root / "outbox"
            captured = "2018-02-03T04:05:06Z"
            statuses = iter([None, 201, 200])
            posted: list[tuple[dict, bytes, str]] = []
            classify_dates: list[str | None] = []
            load_calls: list[dict] = []

            def fake_load(*args, **kwargs):
                load_calls.append(kwargs)
                return FakeSession(), "input", 16, {}

            def fake_classify(session, input_name, size, classes, image_path,
                              version, *, captured_at=None):
                classify_dates.append(captured_at)
                return fake_result(image_path, captured_at)

            def fake_post(base_url, token, metadata_json, image_bytes,
                          image_name, mime):
                posted.append((json.loads(metadata_json), image_bytes, image_name))
                return next(statuses), "{}"

            args = send_args(outbox, image=image, captured_at=captured)
            with mock.patch.object(ec, "_config",
                                   return_value=("http://x", "t" * 32, "dev")), \
                    mock.patch.object(ec.eio, "load_session", side_effect=fake_load), \
                    mock.patch.object(ec.eio, "model_version", return_value="v"), \
                    mock.patch.object(ec.eio, "classify", side_effect=fake_classify), \
                    mock.patch.object(ec, "post_capture", side_effect=fake_post), \
                    contextlib.redirect_stdout(io.StringIO()), \
                    contextlib.redirect_stderr(io.StringIO()):
                self.assertEqual(ec.cmd_send(args), 3)  # fallo de red simulado

                record_path = next(outbox.glob("*.json"))
                record = json.loads(record_path.read_text(encoding="utf-8"))
                capture_id = record["capture_id"]
                metadata_before = json.loads(json.dumps(record["metadata"]))
                self.assertEqual(record["status"], "pending")
                self.assertEqual(metadata_before["captured_at"], captured)

                retry_args = Namespace(capture_id=capture_id, outbox=str(outbox))
                self.assertEqual(ec.cmd_retry(retry_args), 0)  # 201
                self.assertEqual(ec.cmd_retry(retry_args), 0)  # 200

            self.assertEqual(classify_dates, [captured])  # no reclasifica
            self.assertEqual(len(load_calls), 1)
            self.assertEqual(len(posted), 3)
            for metadata, image_bytes, _ in posted:
                self.assertEqual(metadata["capture_id"], capture_id)
                self.assertEqual(metadata["captured_at"], captured)
                self.assertEqual(image_bytes, original_bytes)
                self.assertNotIn("inferred_at", metadata)

            record_after = json.loads(record_path.read_text(encoding="utf-8"))
            self.assertEqual(record_after["capture_id"], capture_id)
            self.assertEqual(record_after["metadata"], metadata_before)
            self.assertEqual(record_after["last_status"], 200)
            self.assertEqual(record_after["status"], "sent")


if __name__ == "__main__":
    unittest.main()

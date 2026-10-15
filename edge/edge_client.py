"""Cliente de envío de capturas edge (P4-2.2).

Toma una captura clasificada en el dispositivo y la envía al backend con
`POST /api/edge-captures` (multipart). Genera el `capture_id` **una sola vez**
por captura y lo conserva —junto con los bytes exactos de la imagen y la
metadata— en un *outbox* local, de modo que un reintento manual reutiliza el
**mismo** `capture_id` y los **mismos** bytes: la clave de idempotencia del
contrato (`docs/EDGE_CAPTURE_CONTRACT.md`).

Comportamiento:
- Primer envío válido -> `201`.
- Reintento idéntico   -> `200` (sin duplicar).
- Mismo id, contenido distinto -> `409`.
- Fallo de red/servidor (sin respuesta o 5xx) -> la captura queda en el outbox
  para reintentar a mano; nunca se cambia su `capture_id`.

Config por entorno (sin credenciales AWS en el dispositivo):
  EDGE_API_BASE_URL   p. ej. http://192.168.1.50:3100  (sin «/» final)
  EDGE_INGEST_TOKEN   token Bearer (>= 32 caracteres)
  EDGE_DEVICE_ID      identificador del dispositivo (def: rpi-edge-01)

Uso:
  python edge_client.py send  --model model.int8.onnx --camera
  python edge_client.py send  --model model.int8.onnx --image foto.jpg
  python edge_client.py retry --capture-id <uuid>
  python edge_client.py outbox
"""

from __future__ import annotations

import argparse
import json
import mimetypes
import os
import sys
import urllib.error
import urllib.request
import uuid
from pathlib import Path

import edge_infer_onnx as eio

DEFAULT_OUTBOX = Path(os.environ.get("EDGE_OUTBOX", str(Path.home() / "edge-outbox")))
INGEST_PATH = "/api/edge-captures"
REQUEST_TIMEOUT = 15.0


def _mime_for(path: Path) -> str:
    guessed, _ = mimetypes.guess_type(str(path))
    if guessed in ("image/jpeg", "image/png"):
        return guessed
    # fswebcam guarda .jpg; por defecto asumimos JPEG.
    return "image/jpeg"


def build_multipart(metadata_json: str, image_bytes: bytes, image_name: str, mime: str) -> tuple[bytes, str]:
    """Arma el cuerpo multipart tal como lo espera el backend.

    `metadata` va como campo de texto (sin filename -> req.body.metadata) e
    `image` como archivo (con filename -> parte de archivo para multer).
    """
    boundary = f"----edgeclient{uuid.uuid4().hex}"
    crlf = b"\r\n"
    parts: list[bytes] = []
    parts.append(f"--{boundary}".encode())
    parts.append(b'Content-Disposition: form-data; name="metadata"')
    parts.append(b"Content-Type: application/json")
    parts.append(b"")
    parts.append(metadata_json.encode("utf-8"))
    parts.append(f"--{boundary}".encode())
    parts.append(f'Content-Disposition: form-data; name="image"; filename="{image_name}"'.encode())
    parts.append(f"Content-Type: {mime}".encode())
    parts.append(b"")
    body = crlf.join(parts) + crlf + image_bytes + crlf + f"--{boundary}--".encode() + crlf
    return body, boundary


def post_capture(base_url: str, token: str, metadata_json: str, image_bytes: bytes,
                 image_name: str, mime: str) -> tuple[int | None, str]:
    """Envía la captura. Devuelve (status, cuerpo). status=None si no hubo respuesta."""
    body, boundary = build_multipart(metadata_json, image_bytes, image_name, mime)
    request = urllib.request.Request(
        base_url.rstrip("/") + INGEST_PATH,
        data=body,
        method="POST",
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": f"multipart/form-data; boundary={boundary}",
            "Content-Length": str(len(body)),
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=REQUEST_TIMEOUT) as response:
            return response.status, response.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as error:  # 4xx / 5xx: hay respuesta
        return error.code, error.read().decode("utf-8", "replace")
    except (urllib.error.URLError, OSError) as error:  # sin respuesta (red caída, timeout)
        return None, f"{type(error).__name__}: {error}"


def _config() -> tuple[str, str, str]:
    base_url = os.environ.get("EDGE_API_BASE_URL", "").strip()
    token = os.environ.get("EDGE_INGEST_TOKEN", "").strip()
    device_id = os.environ.get("EDGE_DEVICE_ID", "rpi-edge-01").strip()
    if not base_url:
        raise SystemExit("Falta EDGE_API_BASE_URL (p. ej. http://192.168.1.50:3100).")
    if len(token) < 32:
        raise SystemExit("Falta EDGE_INGEST_TOKEN o es menor a 32 caracteres.")
    return base_url, token, device_id


def _save_record(outbox: Path, capture_id: str, metadata: dict, image_src: Path) -> Path:
    """Persiste metadata + bytes de imagen en el outbox antes de enviar."""
    outbox.mkdir(parents=True, exist_ok=True)
    ext = ".png" if image_src.suffix.lower() == ".png" else ".jpg"
    stored_image = outbox / f"{capture_id}{ext}"
    stored_image.write_bytes(image_src.read_bytes())
    record = {
        "capture_id": capture_id,
        "metadata": metadata,
        "image_file": stored_image.name,
        "status": "pending",
    }
    (outbox / f"{capture_id}.json").write_text(json.dumps(record, indent=2), encoding="utf-8")
    return outbox / f"{capture_id}.json"


def _report(capture_id: str, status: int | None, body: str) -> int:
    """Imprime un mensaje claro por estado y devuelve el código de salida."""
    try:
        parsed = json.dumps(json.loads(body), ensure_ascii=False)
    except (json.JSONDecodeError, ValueError):
        parsed = body
    if status == 201:
        print(f"[201 CREADO] capture_id={capture_id} -> {parsed}")
        return 0
    if status == 200:
        print(f"[200 IDEMPOTENTE] capture_id={capture_id} ya estaba persistido; no se duplicó. {parsed}")
        return 0
    if status == 409:
        print(f"[409 CONFLICTO] capture_id={capture_id} ya existe con contenido distinto. "
              f"Una captura nueva necesita un capture_id nuevo. {parsed}", file=sys.stderr)
        return 2
    if status is None:
        print(f"[FALLO DE RED] capture_id={capture_id} no obtuvo respuesta: {body}\n"
              f"  Reintenta sin cambiar el id:  python edge_client.py retry --capture-id {capture_id}",
              file=sys.stderr)
        return 3
    print(f"[{status} ERROR] capture_id={capture_id} -> {parsed}", file=sys.stderr)
    return 4


def cmd_send(args: argparse.Namespace) -> int:
    base_url, token, device_id = _config()
    outbox = Path(args.outbox)

    session, input_name, size, _ = eio.load_session(args.model)
    version = eio.model_version(args.model)
    if args.camera:
        image_path = eio.capture(outbox / "capturas")
    else:
        image_path = args.image
    result = eio.classify(session, input_name, size, args.classes, image_path, version)

    capture_id = str(uuid.uuid4())
    metadata = {
        "capture_id": capture_id,
        "captured_at": result["captured_at"],
        "device_id": device_id,
        "model_version": result["model_version"],
        "predicted_class": result["predicted_class"],
        "confidence": result["confidence"],
        "image_sha256": result["image_sha256"],
    }
    _save_record(outbox, capture_id, metadata, Path(result["image"]))
    print(f"captura clasificada: {result['predicted_class']} "
          f"({result['confidence']}) · guardada en outbox")

    status, body = post_capture(
        base_url, token, json.dumps(metadata),
        Path(result["image"]).read_bytes(),
        f"{capture_id}{Path(result['image']).suffix or '.jpg'}",
        _mime_for(Path(result["image"])),
    )
    _update_status(outbox, capture_id, status)
    return _report(capture_id, status, body)


def cmd_retry(args: argparse.Namespace) -> int:
    base_url, token, _ = _config()
    outbox = Path(args.outbox)
    record_path = outbox / f"{args.capture_id}.json"
    if not record_path.is_file():
        raise SystemExit(f"No hay registro en el outbox para capture_id={args.capture_id}.")
    record = json.loads(record_path.read_text(encoding="utf-8"))
    image_path = outbox / record["image_file"]
    metadata = record["metadata"]
    print(f"reintentando capture_id={args.capture_id} (mismo id, mismos bytes)")
    status, body = post_capture(
        base_url, token, json.dumps(metadata),
        image_path.read_bytes(),
        f"{args.capture_id}{image_path.suffix}",
        _mime_for(image_path),
    )
    _update_status(outbox, args.capture_id, status)
    return _report(args.capture_id, status, body)


def cmd_outbox(args: argparse.Namespace) -> int:
    outbox = Path(args.outbox)
    records = sorted(outbox.glob("*.json")) if outbox.is_dir() else []
    if not records:
        print("outbox vacío.")
        return 0
    for record_path in records:
        record = json.loads(record_path.read_text(encoding="utf-8"))
        meta = record["metadata"]
        print(f"{record['capture_id']}  [{record.get('status', '?')}]  "
              f"{meta['predicted_class']} ({meta['confidence']})  {meta['captured_at']}")
    return 0


def _update_status(outbox: Path, capture_id: str, status: int | None) -> None:
    record_path = outbox / f"{capture_id}.json"
    if not record_path.is_file():
        return
    record = json.loads(record_path.read_text(encoding="utf-8"))
    record["status"] = {201: "sent", 200: "sent", 409: "conflict"}.get(status, "pending")
    record["last_status"] = status
    record_path.write_text(json.dumps(record, indent=2), encoding="utf-8")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--outbox", default=str(DEFAULT_OUTBOX), help="directorio del outbox")
    sub = parser.add_subparsers(dest="command", required=True)

    send = sub.add_parser("send", help="clasificar y enviar una captura nueva")
    send.add_argument("--model", required=True, type=Path)
    source = send.add_mutually_exclusive_group(required=True)
    source.add_argument("--image", type=Path, help="enviar un archivo existente")
    source.add_argument("--camera", action="store_true", help="capturar con la webcam y enviar")
    send.add_argument("--classes", nargs="+", default=["car", "person"])
    send.set_defaults(func=cmd_send)

    retry = sub.add_parser("retry", help="reenviar una captura del outbox con el mismo id")
    retry.add_argument("--capture-id", required=True)
    retry.set_defaults(func=cmd_retry)

    outbox = sub.add_parser("outbox", help="listar capturas en el outbox")
    outbox.set_defaults(func=cmd_outbox)

    args = parser.parse_args()
    raise SystemExit(args.func(args))


if __name__ == "__main__":
    main()

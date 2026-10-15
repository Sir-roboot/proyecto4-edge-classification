# P4-2.2 — Evidencia del cliente de envío edge

**Fecha:** 2026-10-15
**Responsable:** Quiroz Valdovinos, Andrés
**Rúbrica asociada:** 4.1, 4.3
**Depende de:** P4-1.2 (inferencia en el edge), P4-2.1 (ingesta en el backend)

## Objetivo

Enviar una captura clasificada en la Raspberry al backend con
`POST /api/edge-captures`, conservando el `capture_id` en los reintentos,
mostrando el error cuando lo hay y permitiendo reintentar a mano sin duplicar.

## Cliente

`edge/edge_client.py` corre en la Raspberry. Genera el `capture_id` **una sola
vez** por captura y lo conserva —con los bytes exactos de la imagen y la
metadata— en un *outbox* local, de modo que un reintento manual reutiliza el
**mismo** id y los **mismos** bytes. Config por entorno (sin credenciales AWS en
el dispositivo): `EDGE_API_BASE_URL`, `EDGE_INGEST_TOKEN`, `EDGE_DEVICE_ID`.

La metadata que produce valida contra el contrato
(`contracts/edge-capture-event.schema.json`, verificado con `jsonschema`).

## Entorno de la prueba

- **Dispositivo:** Raspberry Pi 4 (`rpi-edge-01`), modelo ONNX INT8.
- **Backend:** el backend real del repositorio corriendo en la laptop
  (`docker compose`: MariaDB + MinIO + backend) y alcanzado por la Raspberry por
  IP de la LAN (`http://192.168.1.72:3100`). El contrato y el handler son los
  mismos que en AWS; solo cambia la URL base.
- **Token:** `EDGE_INGEST_TOKEN` ficticio de desarrollo del `docker-compose`.

> Nota: la prueba contra el **AWS real** (`https://d3mjwen8lb1kx3.cloudfront.net`,
> ya desplegado y verificado en P4-2.1) está **bloqueada desde esta Raspberry por
> DNS**: su red usa un resolver con filtrado (OpenDNS FamilyShield,
> `208.67.222.123`) que no resuelve el host de CloudFront, aunque la Raspberry sí
> tiene ruta a Internet. Se resuelve cambiando el DNS de la Raspberry/red antes de
> P4-3.1/M3. El cliente es el mismo; solo cambia `EDGE_API_BASE_URL`.

## Resultados (corrida de aceptación)

Bitácora completa: `docs/evidence/p4-2-2/client-acceptance-run.txt`.

| # | Caso | Esperado | Obtenido |
| --- | --- | --- | --- |
| 1 | Primer envío de un `capture_id` nuevo | `201` | `201 CREADO` con `image_key` y `received_at` del servidor |
| 2 | Reintento idéntico (mismo id, mismos bytes) | `200` | `200 IDEMPOTENTE`, no se duplica |
| 3 | Token inválido | `401` | `401 No autorizado` |
| 4 | Mismo `capture_id`, contenido distinto | `409` | `409 CONFLICTO` |
| 5 | Fallo de red (servidor inalcanzable) | reintentable | queda en el outbox con instrucción de reintento; no cambia el id |

### No-duplicación

Tras los envíos del mismo `capture_id` (`docs/evidence/p4-2-2/persistence-check.txt`):

- `edge_captures`: **1 fila** para el `capture_id`.
- MinIO: **1 objeto** en `edge-captures/<capture_id>/<image_sha256>.jpg`
  (SHA-256 idéntico al enviado).

## Reproducción

```bash
# En la Raspberry, con el backend alcanzable en EDGE_API_BASE_URL:
export EDGE_API_BASE_URL=http://<host>:3100
export EDGE_INGEST_TOKEN=<token fuera de Git>
export EDGE_DEVICE_ID=rpi-edge-01

python edge_client.py send  --model model.int8.onnx --camera   # captura y envía
python edge_client.py retry --capture-id <uuid>                # reintento manual
python edge_client.py outbox                                   # pendientes
```

## Estado de rúbrica

- **4.1 (edge):** el evento real de la Raspberry queda enlazado a la fotografía
  por `capture_id` + `image_sha256` contra el backend. Falta repetirlo contra el
  AWS real (bloqueo de DNS arriba).
- **4.3 (edge):** fallo reversible con mensaje visible, reintento del mismo id y
  no-duplicación verificados desde el dispositivo.

## Pendiente (otros tickets)

- **P4-3.1 / M3:** 20 capturas reales de la Raspberry al AWS real (requiere
  arreglar el DNS de la Raspberry) y contraste en el portal.

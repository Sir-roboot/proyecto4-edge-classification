# P4-3.1 — Envío de capturas reales de la Raspberry a AWS (M3, leg dispositivo→AWS)

**Fecha:** 2026-10-15
**Responsable:** Quiroz Valdovinos, Andrés (dispositivo) + Santiago (AWS)
**Rúbrica asociada:** M3 (parcial), 4.1, 4.3, 6.2

## Objetivo

Enviar capturas reales clasificadas en la Raspberry al **AWS real** y
comprobar la idempotencia (sin duplicados), cerrando el tramo
**dispositivo → AWS** de la compuerta M3. La visualización en el portal
*Capturas Edge* es el tramo de Ignacio.

## Entorno

- **Dispositivo:** Raspberry Pi 4 (`rpi-edge-01`), variante ONNX INT8, cliente
  `edge/edge_client.py`.
- **AWS:** `https://dmpbp69umccrl.cloudfront.net` (CloudFront → ALB → ECS
  Fargate → RDS/S3), desplegado por Santiago.
- **Auth:** `Authorization: Bearer <EDGE_INGEST_TOKEN>` (el token vive fuera de
  Git, en Secrets Manager; **no** aparece en esta evidencia ni en los commits).
- **DNS:** la red del dispositivo tenía un resolver con filtrado que no resolvía
  CloudFront; se cambió a `8.8.8.8`/`1.1.1.1` y el host resuelve y responde
  `GET /api/health` → `200`.

## Resultados

| Prueba | Resultado |
| --- | --- |
| Captura en vivo → AWS | **201** (imagen en S3 + `received_at` del servidor) |
| Reintento del mismo `capture_id` | **200** idempotente, sin duplicar |
| Token inválido | **401** (rechazado, sin persistir) |
| **Envío de las 20 capturas del recorrido** | **20/20 → 201**, 11 `person` + 9 `car` |
| Reenvío de una de las 20 | **200** idempotente |

Las 20 capturas quedaron en AWS con `capture_id` único y objeto en S3 con clave
determinista `edge-captures/<capture_id>/<image_sha256>.jpg`. Lista completa de
los 20 `capture_id` e `image_key`: `docs/evidence/p4-3-1/aws-sends-summary.txt`.

## Trazabilidad (ejemplo de un `capture_id` seguido extremo a extremo)

```
capture_id : 5956ffc8-6641-453c-9c88-4c79ed1a8abf
clase      : person
image_sha256: 58e61655d251a6827e3478250ef647605e6a2f32358e30106e0987071e202643
image_key  : edge-captures/5956ffc8-.../58e61655....jpg   (S3, asignado por el server)
received_at: 2026-10-15T22:13:31Z                         (asignado por el server)
estado     : 201 primer envío, 200 reintento idéntico
```

## Reproducción

```bash
# En la Raspberry (token fuera de Git):
export EDGE_API_BASE_URL=https://dmpbp69umccrl.cloudfront.net
export EDGE_INGEST_TOKEN=<token de Secrets Manager>
export EDGE_DEVICE_ID=rpi-edge-01
python edge_client.py send --model model.int8.onnx --camera   # 201
python edge_client.py retry --capture-id <uuid>               # 200 (no duplica)
```

## Pendiente para cerrar M3 por completo

- **Portal (Ignacio):** mostrar estos `capture_id`/imágenes en la sección
  *Capturas Edge*, ordenados de reciente a antiguo (rúbrica 5.x).
- **Contraste de cinco IDs (6.2):** elegir ≥5 de los 20 `capture_id` y
  verificarlos en dispositivo, AWS y portal.
- Avisar a Santiago para apagar los recursos **solo después** de que Ignacio
  verifique el portal.

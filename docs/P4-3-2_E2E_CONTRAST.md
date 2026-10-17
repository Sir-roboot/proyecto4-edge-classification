# P4-3.2 — cinco capturas contrastadas entre Raspberry, AWS y portal

**Verificación:** 2026-10-16 (America/Mexico_City). **Código desplegado:** merge `8633184bbb84635e434292ac9ef3b9d530781e6f`, imagen ECR con ese tag, tarea ECS `edge-app-dev:5`. **URL:** https://dmpbp69umccrl.cloudfront.net/edge-captures.

El despliegue cambió únicamente la revisión de tarea ECS y el servicio `edge-app-dev`; no modificó RDS, el bucket S3 ni CloudFront. El servicio quedó estable y `GET /api/health` devolvió `200`. Antes del despliegue, `GET /api/edge-captures` devolvía `404`; después devolvió `200` con 24 filas, ordenadas por `received_at` descendente.

## Contraste de cinco IDs

Origen local: `docs/evidence/p4-2-4/operation-log.jsonl` (foto, clase, confianza y SHA-256) y `docs/evidence/p4-3-1/aws-sends-summary.txt` (mapeo del SHA-256 al `capture_id` e `image_key` enviados). Origen AWS: `GET /api/edge-captures`, `GET /api/edge-captures/:id`, `GET /api/edge-captures/:id/image` y `S3 HeadObject` del bucket privado `edge-captures-dev-685538571046`.

| `capture_id` | Clase | Confianza | Bytes API = S3 | Diferencia foto → evento |
| --- | --- | ---: | ---: | ---: |
| `06f73767-d72c-4552-9205-d46d06d49d47` | person | 0.994072 | 291897 | 436 s |
| `1567eff4-4e97-4b40-8a40-eb12e17fa4c9` | car | 0.837938 | 332917 | 421 s |
| `7a3c8ec2-00d1-449f-8fef-37312a8be1bc` | car | 0.989464 | 372688 | 567 s |
| `de22fa19-2685-4ef1-8b3b-aeeeffc0491e` | person | 0.914339 | 288594 | 377 s |
| `f2e6765a-260f-4dd7-ab72-ea82ffe96ad3` | car | 0.743282 | 377912 | 494 s |

En **los cinco** coincidieron el ID del listado y detalle, clase, confianza, versión del modelo, `image_key`, SHA-256 calculado de los bytes recuperados por la API y longitud del objeto confirmada por S3. El dispositivo declarado por el evento es `rpi-edge-01`. El verificador de solo lectura terminó con `"count": 5` y `"passes": true`:

```bash
# Desde la raíz del repo; AWS CLI con permiso de lectura S3, sin credenciales en el comando:
node scripts/verify-p4-3-2-readonly.mjs --profile <perfil-de-lectura>
```

El portal se abrió con Edge headless en `/edge-captures`: el DOM renderizado mostró **los cinco IDs**, tarjetas de capturas y la navegación de Classifier Portal. La página `/dashboard` del portal anterior mostró el enlace a Capturas Edge. El detalle y la imagen se comprobaron además por sus rutas HTTP. El evaluador puede abrir cualquiera de las cinco tarjetas y pulsar **Consultar detalle** para ver fecha, dispositivo, versión y SHA-256; la prueba automatizada del frontend cubre ese control y los estados carga/vacío/error/actualizar.

**Distinción de fechas:** las fotos de `operation-log.jsonl` fueron tomadas antes del envío. `edge_client.py send --image` volvió a clasificar esos archivos y generó un **nuevo evento** con un `captured_at` posterior; por eso los cinco instantes de foto original y evento AWS difieren 377–567 segundos. El listado, detalle y portal sí usan el mismo `captured_at` del evento AWS. No se presenta la hora de la foto original como idéntica a la del evento. Para la demostración final conviene usar `send --camera`, que crea el evento al capturar una foto nueva.

Esta prueba reutilizó capturas históricas: **no** reemplaza la captura dirigida nueva con la Raspberry ante el evaluador. La secuencia de fallo de red → reintento `201` → repetición `200` de otra captura real está en `docs/evidence/p4-4-3/network-retry-sequence.txt` y fue contrastada por consulta de solo lectura.

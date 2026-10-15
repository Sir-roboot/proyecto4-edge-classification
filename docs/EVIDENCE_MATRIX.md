# Matriz de evidencias — Proyecto 4

Esta matriz sigue el prompt oficial de evaluación. Una afirmación solo cambia a
`LISTA` cuando existe el archivo, URL, registro o paso observable indicado. `PENDIENTE`
no significa que el criterio falle: identifica trabajo que todavía debe entregarse.

## Compuertas obligatorias

| Compuerta | Evidencia verificable | Responsable | Estado |
| --- | --- | --- | --- |
| M1 — variante del modelo propio | Referencia del modelo de Proyecto 3, mapa de clases, registro de conversión, artefactos original/optimizado y sus SHA-256 | Luis Víctor | PENDIENTE |
| M2 — cámara e inferencia local | Raspberry y cámara identificadas; captura nueva; modelo cargado; clasificación de ambas clases con la red desconectada | Andrés | LISTA — dispositivo/cámara identificados, variante ONNX INT8 cargada, captura con webcam → inferencia (~30 ms), ambas clases correctas y clasificación sin red (desconexión física de 1 min + bloqueo de sockets) (`docs/P4-1-2_EDGE_INFERENCE_EVIDENCE.md`, `docs/evidence/p4-1-2/`) |
| M3 — AWS y portal | Un mismo `capture_id` seguido desde el dispositivo hasta el registro/imagen en AWS y Capturas Edge | Santiago + Ignacio | EN PROGRESO — tramo dispositivo→AWS demostrado: 20 capturas reales de la Raspberry (`rpi-edge-01`) persistidas en AWS con `201` (reintento `200` sin duplicar, token inválido `401`) y objeto en S3 por `capture_id` (`docs/P4-3-1_EDGE_TO_AWS_EVIDENCE.md`, `docs/evidence/p4-3-1/`); falta mostrarlas en el portal Capturas Edge (Ignacio) |

Si alguna compuerta queda sin demostración, el prompt limita la calificación definitiva a 60 puntos.

## Rúbrica base

| Criterio | Evidencia que debe quedar enlazada | Responsable principal | Estado |
| --- | --- | --- | --- |
| 1.1 | Manifiesto del modelo original: versión, run, clases, preprocesamiento y hash | Luis Víctor | PENDIENTE |
| 1.2 | Script/configuración reproducible, log de conversión y variante cargable en la Raspberry | Luis Víctor | PENDIENTE |
| 1.3 | Mismo manifiesto de validación, predicciones por muestra, accuracy/F1 por clase y explicación de errores | Luis Víctor | PENDIENTE |
| 2.1 | Identificación de Raspberry/cámara y capturas nuevas observables | Andrés | LISTA — ficha de hardware (`docs/P4-0-3_EDGE_DEVICE_FICHA.md`) y captura real verificada por SHA-256 (`docs/evidence/p4-0-3/captura.jpg`, colecta reproducible con `scripts/edge/collect_device_info.sh`) |
| 2.2 | Resolución, canales, normalización, cuantización/recorte y entradas conocidas | Andrés + Luis Víctor | LISTA — resolución, canales, normalización ImageNet y cuantización INT8 documentadas; entradas conocidas de ambas clases clasificadas correctamente (`docs/evidence/p4-1-2/known-inputs.txt`) |
| 2.3 | Inferencia con la variante en el dispositivo y prueba con red desconectada | Andrés | LISTA — inferencia con la variante ONNX INT8 en la Raspberry; prueba sin red por desconexión física (`docs/evidence/p4-1-2/offline-demo.jsonl`) y por bloqueo de sockets (`docs/evidence/p4-1-2/offline-both-classes.txt`) |
| 2.4 | Registro de 20 capturas, cinco minutos de operación y captura posterior a reinicio | Andrés | LISTA — 20 capturas (ambas clases: 11 person, 9 car) en 5 min 5 s y una captura tras reinicio (uptime 1 min) en la Raspberry (`docs/P4-2-4_DEVICE_OPERATION_EVIDENCE.md`, `docs/evidence/p4-2-4/`) |
| 3.1 | Hardware, runtime, precisión, entrada y condiciones equivalentes documentadas | Luis Víctor + Andrés | PENDIENTE |
| 3.2 | Tamaños, 10 calentamientos, 100 tiempos válidos y cálculo reproducible de p50/p95 | Luis Víctor + Andrés | PENDIENTE |
| 3.3 | Comparación cuantitativa y decisión sobre intercambio recursos/calidad | Luis Víctor | PENDIENTE |
| 4.1 | Evento completo enlazado a la fotografía mediante ID y SHA-256 | Santiago + Andrés | LISTA — ingesta y persistencia verificadas en P4-2.1 (`docs/P4-2-1_LOCAL_INGESTION_EVIDENCE.md`); 20 capturas reales de `rpi-edge-01` enviadas a AWS y enlazadas a objetos S3 por `capture_id` + `image_sha256` + `image_key` (`docs/P4-3-1_EDGE_TO_AWS_EVIDENCE.md`, `docs/evidence/p4-3-1/aws-sends-summary.txt`) |
| 4.2 | Recurso AWS identificado y consulta de solo lectura que recupere registro e imagen | Santiago | EN PROGRESO — bucket S3 `edge-captures-dev-685538571046` identificado y lectura del objeto confirmada con `head-object` (key, 10,994 bytes, `image/png`); **lectura directa de la fila en RDS** ya ejecutada (tarea Fargate temporal `dbprobe-p4-2-1:1`, `SELECT ... WHERE capture_id=884f1f18-77f8-4db1-b0e3-db43bc347296`, 1 fila con columnas reales y valores idénticos al smoke); falta un endpoint `GET` de solo lectura |
| 4.3 | Fallo reversible, mensaje visible, reintento del mismo ID y comprobación de no duplicado | Santiago + Andrés | EN PROGRESO — `201`/`200`/`409` verificados en AWS; el cliente edge conserva el ID ante fallo de red y permite reintento manual (`docs/P4-2-2_EDGE_CLIENT_EVIDENCE.md`), y una captura real se reenvió a AWS con `200` (`docs/P4-3-1_EDGE_TO_AWS_EVIDENCE.md`). Falta registrar explícitamente la secuencia fallo de red → reintento exitoso del mismo ID → comprobación de no duplicado para cerrar el criterio |
| 5.1 | Capturas Edge accesible desde el portal previo y desplegado en AWS | Ignacio | PENDIENTE |
| 5.2 | Imagen y metadatos reales coincidentes, ordenados de reciente a antiguo | Ignacio | PENDIENTE |
| 5.3 | Actualización, carga, vacío y error verificables | Ignacio | PENDIENTE |
| 6.1 | README/ficha con instalación, arranque, recuperación de artefactos y recorrido | Santiago + todos | PENDIENTE |
| 6.2 | Pasos repetibles para conversión, inferencia conocida y evento enviado/recuperado; cinco IDs contrastados | Santiago + todos | EN PROGRESO — recorrido local de un evento y un `capture_id` contrastado contra AWS documentados; faltan conversión, inferencia física y el contraste en el portal de cinco IDs |
| 6.3 | Configuración de ejemplo sin secretos, identidad del dispositivo, artefacto y destino AWS documentados | Santiago | EN PROGRESO — contrato publicado (`docs/EDGE_CAPTURE_CONTRACT.md`) y arquitectura decidida (`docs/AWS_EDGE_ARCHITECTURE.md`) |

## Evidencia ya disponible

| Elemento | Ubicación | Qué demuestra |
| --- | --- | --- |
| Contrato normativo del evento | `contracts/edge-capture-event.schema.json` | Forma y restricciones de la metadata enviada por el edge |
| Fixture compartido | `contracts/examples/edge-capture-event.json` | Entrada válida para edge, backend y portal |
| Contrato HTTP e idempotencia | `docs/EDGE_CAPTURE_CONTRACT.md` | Multipart, límites, respuestas, hash y reintentos |
| Verificador de ingesta contra un host desplegado | `scripts/verify-p4-2-1-aws.mjs` | Reproduce `201`/`200`/`409` contra un endpoint real y descarta el token del resumen |
| Smoke de AWS | `docs/p4-2-1-aws-smoke.json` | `capture_id`, `image_sha256`, `image_key` y status codes de la ejecución contra CloudFront (`passed: true`); sin secretos |
| Lectura directa de la fila en RDS | `docs/P4-2-1_LOCAL_INGESTION_EVIDENCE.md` (sección *Lectura directa de la fila en RDS*) | Tarea Fargate temporal `dbprobe-p4-2-1:1` con `SELECT ... WHERE capture_id=884f1f18-77f8-4db1-b0e3-db43bc347296`; devuelve la fila real de `edge_captures` con `image_key`, `image_sha256`, `size_bytes` y `mime_type` idénticos al objeto S3 y al smoke; secretos usados por `valueFrom`, nunca impresos |
| Línea base y reparto | `docs/PLAN_PROYECTO_4.md` | Modelo previo, responsables, prioridades, fechas y compuertas |

## Control de cierre

Antes de la entrega, cada fila marcada `LISTA` debe apuntar a una ruta, una URL o un
paso de demostración concreto. Para M3 se contrastarán al menos cinco `capture_id` en
dispositivo, AWS y portal. El video es opcional y no sustituye los 100 puntos base.

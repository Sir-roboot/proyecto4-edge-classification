# Matriz de evidencias — Proyecto 4

Esta matriz sigue el prompt oficial de evaluación. Una afirmación solo cambia a
`LISTA` cuando existe el archivo, URL, registro o paso observable indicado. `PENDIENTE`
no significa que el criterio falle: identifica trabajo que todavía debe entregarse.

## Compuertas obligatorias

| Compuerta | Evidencia verificable | Responsable | Estado |
| --- | --- | --- | --- |
| M1 — variante del modelo propio | Referencia del modelo de Proyecto 3, mapa de clases, registro de conversión, artefactos original/optimizado y sus SHA-256 | Luis Víctor | LISTA — modelo original documentado en `docs/P4-0-2_MODEL_BASELINE_EVIDENCE.md`; conversión y cuantización reproducibles en `pipeline/scripts/`; variante INT8 recuperable en GitHub Release `p4-edge-model-v1.0.0-int8` y verificada en Raspberry |
| M2 — cámara e inferencia local | Raspberry y cámara identificadas; captura nueva; modelo cargado; clasificación de ambas clases con la red desconectada | Andrés | PENDIENTE |
| M3 — AWS y portal | Un mismo `capture_id` seguido desde el dispositivo hasta el registro/imagen en AWS y Capturas Edge | Santiago + Ignacio | PENDIENTE |

Si alguna compuerta queda sin demostración, el prompt limita la calificación definitiva a 60 puntos.

## Rúbrica base

| Criterio | Evidencia que debe quedar enlazada | Responsable principal | Estado |
| --- | --- | --- | --- |
| 1.1 | Manifiesto del modelo original: versión, run, clases, preprocesamiento y hash | Luis Víctor | LISTA — `docs/P4-0-2_MODEL_BASELINE_EVIDENCE.md` |
| 1.2 | Script/configuración reproducible, log de conversión y variante cargable en la Raspberry | Luis Víctor | LISTA — scripts reproducibles en `pipeline/scripts/export_edge_onnx.py` y `pipeline/scripts/quantize_edge_int8.py`; logs en `docs/evidence/p4-1-1/conversion.json` y `docs/evidence/p4-1-1/quantization.json`; variante INT8 verificada en Raspberry mediante `docs/evidence/p4-1-4/p4_edge_benchmark.json` |
| 1.3 | Mismo manifiesto de validación, predicciones por muestra, accuracy/F1 por clase y explicación de errores | Luis Víctor | LISTA — `pipeline/reports/classifier/p4/validation_comparison.json` y CSVs de predicciones original/INT8 |
| 2.1 | Identificación de Raspberry/cámara y capturas nuevas observables | Andrés | LISTA — ficha de hardware (`docs/P4-0-3_EDGE_DEVICE_FICHA.md`) y captura real verificada por SHA-256 (`docs/evidence/p4-0-3/captura.jpg`, colecta reproducible con `scripts/edge/collect_device_info.sh`) |
| 2.2 | Resolución, canales, normalización, cuantización/recorte y entradas conocidas | Andrés + Luis Víctor | PENDIENTE |
| 2.3 | Inferencia con la variante en el dispositivo y prueba con red desconectada | Andrés | PENDIENTE |
| 2.4 | Registro de 20 capturas, cinco minutos de operación y captura posterior a reinicio | Andrés | PENDIENTE |
| 3.1 | Hardware, runtime, precisión, entrada y condiciones equivalentes documentadas | Luis Víctor + Andrés | LISTA — Raspberry aarch64, Python 3.13.5, ONNX Runtime 1.31.0, CPUExecutionProvider, entrada `[1,3,128,128]`; `docs/evidence/p4-1-4/p4_edge_benchmark.json` |
| 3.2 | Tamaños, 10 calentamientos, 100 tiempos válidos y cálculo reproducible de p50/p95 | Luis Víctor + Andrés | LISTA — FP32 p50 60.21 ms / p95 65.43 ms; INT8 p50 28.59 ms / p95 34.67 ms; `docs/evidence/p4-1-4/p4_edge_benchmark.json` |
| 3.3 | Comparación cuantitativa y decisión sobre intercambio recursos/calidad | Luis Víctor | LISTA — INT8 reduce tamaño 74.62%, acelera p50 2.11x y p95 1.89x en Raspberry, manteniendo la calidad de validación según `pipeline/reports/classifier/p4/validation_comparison.json`; se selecciona INT8 para edge |
| 4.1 | Evento completo enlazado a la fotografía mediante ID y SHA-256 | Santiago + Andrés | EN PROGRESO — contrato y persistencia local verificados, más ingesta `201`/`200`/`409` contra el AWS real, `head-object` del objeto S3 y **consulta SQL directa a `edge_captures`** para el mismo `capture_id` (`docs/P4-2-1_LOCAL_INGESTION_EVIDENCE.md`, `docs/p4-2-1-aws-smoke.json`); el evento de prueba usó el fixture `confusion_matrix.png` con `device_id` `p4-2-1-verifier`, no la Raspberry |
| 4.2 | Recurso AWS identificado y consulta de solo lectura que recupere registro e imagen | Santiago | EN PROGRESO — bucket S3 `edge-captures-dev-685538571046` identificado y lectura del objeto confirmada con `head-object` (key, 10,994 bytes, `image/png`); **lectura directa de la fila en RDS** ya ejecutada (tarea Fargate temporal `dbprobe-p4-2-1:1`, `SELECT ... WHERE capture_id=884f1f18-77f8-4db1-b0e3-db43bc347296`, 1 fila con columnas reales y valores idénticos al smoke); falta un endpoint `GET` de solo lectura |
| 4.3 | Fallo reversible, mensaje visible, reintento del mismo ID y comprobación de no duplicado | Santiago + Andrés | EN PROGRESO — `201`, reintento `200` y conflicto `409` verificados localmente y contra el AWS real (el `200` demuestra lectura indirecta de la fila ya persistida); falta el fallo de envío reversible desde el edge |
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

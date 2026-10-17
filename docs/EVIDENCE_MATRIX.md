# Matriz de evidencias — Proyecto 4

Esta matriz sigue el prompt oficial de evaluación. Una afirmación solo cambia a
`LISTA` cuando existe el archivo, URL, registro o paso observable indicado. `PENDIENTE`
no significa que el criterio falle: identifica trabajo que todavía debe entregarse.

## Compuertas obligatorias

| Compuerta | Evidencia verificable | Responsable | Estado |
| --- | --- | --- | --- |
| M1 — variante del modelo propio | Referencia del modelo de Proyecto 3, mapa de clases, registro de conversión, artefactos original/optimizado y sus SHA-256 | Luis Víctor | LISTA — modelo original documentado en `docs/P4-0-2_MODEL_BASELINE_EVIDENCE.md`; conversión y cuantización reproducibles en `pipeline/scripts/`; variante INT8 recuperable en GitHub Release `p4-edge-model-v1.0.0-int8` y verificada en Raspberry |
| M2 — cámara e inferencia local | Raspberry y cámara identificadas; captura nueva; modelo cargado; clasificación de ambas clases con la red desconectada | Andrés | EVIDENCIA HISTÓRICA LISTA — dispositivo, webcam, variante y clasificación sin red registrados (`docs/P4-1-2_EDGE_INFERENCE_EVIDENCE.md`, `docs/evidence/p4-1-2/`). La observación dirigida actual sigue pendiente si el evaluador no tiene acceso al dispositivo; no equivale a `NO CUMPLE`. |
| M3 — AWS y portal | Un mismo `capture_id` seguido desde el dispositivo hasta el registro/imagen en AWS y Capturas Edge | Santiago + Ignacio | EN PROGRESO — cinco IDs reales contrastados en imagen y metadatos entre edge, API/S3 y portal; se identificó una discrepancia en fecha original (`docs/P4-3-2_E2E_CONTRAST.md`). Aún falta seguir una captura nueva dirigida con el cliente corregido. |

Solo una compuerta **NO CUMPLE** limita la nota definitiva (incluido video) a 60.
**PENDIENTE POR LIMITACIÓN DEL EVALUADOR** impide emitir la nota definitiva, pero
no activa ese tope. La evidencia histórica no sustituye una captura nueva dirigida.

### Correcciones posteriores a la revisión local

- El cliente conserva la fecha original; su verificación física con una captura
  nueva sigue pendiente. Los eventos antiguos de AWS **no se modificaron** y
  contienen el desfase ya identificado. Por ello no debe interpretarse la fila
  histórica 4.1 como cierre de la semántica de `captured_at`.
- El manifiesto exacto se entrega en
  `docs/evidence/p4-1-3/validation-manifest.zip`. Ejecutar
  `python scripts/verify_p4_validation_evidence.py` para verificar hash, 203
  predicciones y procedencia de calibración sin depender de otra copia local.
- Las instrucciones de directorio, release, vistas del portal y opciones ORT
  se precisan en `docs/P4_EVALUATOR_RUNBOOK.md`. No se cambió el runtime de Raspberry.
- En 6.3, el prompt permite consultas de lectura realizadas por el equipo;
  no es obligatorio entregar un usuario AWS al profesor. Si se entrega uno,
  debe comprobarse que su acceso sea limitado y funcione, sin publicar secretos.

## Rúbrica base

| Criterio | Evidencia que debe quedar enlazada | Responsable principal | Estado |
| --- | --- | --- | --- |
| 1.1 | Manifiesto del modelo original: versión, run, clases, preprocesamiento y hash | Luis Víctor | LISTA — `docs/P4-0-2_MODEL_BASELINE_EVIDENCE.md` |
| 1.2 | Script/configuración reproducible, log de conversión y variante cargable en la Raspberry | Luis Víctor | LISTA — scripts reproducibles en `pipeline/scripts/export_edge_onnx.py` y `pipeline/scripts/quantize_edge_int8.py`; logs en `docs/evidence/p4-1-1/conversion.json` y `docs/evidence/p4-1-1/quantization.json`; variante INT8 verificada en Raspberry mediante `docs/evidence/p4-1-4/p4_edge_benchmark.json` |
| 1.3 | Mismo manifiesto de validación, predicciones por muestra, accuracy/F1 por clase y explicación de errores | Luis Víctor | LISTA — comparación/CSV en `pipeline/reports/classifier/p4/`; manifiesto original recuperable en `docs/evidence/p4-1-3/validation-manifest.zip`, comprobable con `scripts/verify_p4_validation_evidence.py`; cuatro crops y análisis en `docs/evidence/p4-1-3/`. |
| 2.1 | Identificación de Raspberry/cámara y capturas nuevas observables | Andrés | LISTA — ficha de hardware (`docs/P4-0-3_EDGE_DEVICE_FICHA.md`) y captura real verificada por SHA-256 (`docs/evidence/p4-0-3/captura.jpg`, colecta reproducible con `scripts/edge/collect_device_info.sh`) |
| 2.2 | Resolución, canales, normalización, cuantización/recorte y entradas conocidas | Andrés + Luis Víctor | LISTA — resolución, canales, normalización ImageNet y cuantización INT8 documentadas; entradas conocidas de ambas clases clasificadas correctamente (`docs/evidence/p4-1-2/known-inputs.txt`) |
| 2.3 | Inferencia con la variante en el dispositivo y prueba con red desconectada | Andrés | LISTA — inferencia con la variante ONNX INT8 en la Raspberry; prueba sin red por desconexión física (`docs/evidence/p4-1-2/offline-demo.jsonl`) y por bloqueo de sockets (`docs/evidence/p4-1-2/offline-both-classes.txt`) |
| 2.4 | Registro de 20 capturas, cinco minutos de operación y captura posterior a reinicio | Andrés | LISTA — 20 capturas (ambas clases: 11 person, 9 car) en 5 min 5 s y una captura tras reinicio (uptime 1 min) en la Raspberry (`docs/P4-2-4_DEVICE_OPERATION_EVIDENCE.md`, `docs/evidence/p4-2-4/`) |
| 3.1 | Hardware, runtime, precisión, entrada y condiciones equivalentes documentadas | Luis Víctor + Andrés | LISTA — Raspberry aarch64, Python 3.13.5, ONNX Runtime 1.31.0, CPUExecutionProvider, entrada `[1,3,128,128]`; `docs/evidence/p4-1-4/p4_edge_benchmark.json` |
| 3.2 | Tamaños, 10 calentamientos, 100 tiempos válidos y cálculo reproducible de p50/p95 | Luis Víctor + Andrés | LISTA — benchmark completo en Raspberry con imagen real y el mismo preprocesamiento del cliente edge; 10 calentamientos y 100 mediciones: FP32 p50 90.71 ms / p95 135.61 ms, INT8 p50 60.35 ms / p95 113.68 ms; `docs/evidence/p4-1-4/p4_edge_benchmark_preprocess.json` |
| 3.3 | Comparación cuantitativa y decisión sobre intercambio recursos/calidad | Luis Víctor | LISTA — INT8 reduce el tamaño 74.62%; en Raspberry, incluyendo preprocesamiento + inferencia, acelera p50 1.50x y p95 1.19x; mantiene la calidad de validación documentada en `pipeline/reports/classifier/p4/validation_comparison.json`; se selecciona INT8 para edge |
| 4.1 | Evento completo enlazado a la fotografía mediante ID y SHA-256 | Santiago + Andrés | CORREGIDO EN CÓDIGO LOCAL — se preserva `captured_at` al enviar/reintentar; tests sin AWS verifican fecha/ID/bytes. Los eventos antiguos siguen teniendo la fecha regenerada y no se reescribieron. Falta captura nueva con cliente actualizado para cierre físico. |
| 4.2 | Recurso AWS identificado y consulta de solo lectura que recupere registro e imagen | Santiago | PERSISTENCIA HISTÓRICA LISTA — API/imagen/S3 contrastados en cinco IDs (`docs/P4-3-2_E2E_CONTRAST.md`). Pendiente seguir una captura nueva dirigida hasta AWS y portal; la lectura histórica no la sustituye. |
| 4.3 | Fallo reversible, mensaje visible, reintento del mismo ID y comprobación de no duplicado | Santiago + Andrés | LISTA — secuencia real `fallo de red → pendiente → 201 → 200` con el mismo `capture_id`, una sola fila en API y SHA-256/bytes iguales en S3; `409` probado en `docs/p4-2-1-aws-smoke.json` (`docs/evidence/p4-4-3/network-retry-sequence.txt`). |
| 5.1 | Capturas Edge accesible desde el portal previo y desplegado en AWS | Ignacio | LISTA — navegación `/dashboard → /annotation/edge-captures` y vista Classifier Portal `/edge-captures` comprobadas en el despliegue HTTPS (`docs/P4-3-2_E2E_CONTRAST.md`). |
| 5.2 | Imagen y metadatos reales coincidentes, ordenados de reciente a antiguo | Ignacio | LISTA — cinco IDs, clases, confianza, hora de evento, modelo y hash contrastados con API/S3; API listada por `received_at` descendente y tarjetas renderizadas en portal (`docs/P4-3-2_E2E_CONTRAST.md`). |
| 5.3 | Actualización, carga, vacío y error verificables | Ignacio | EN PROGRESO — estados carga/vacío/error y botón Actualizar implementados y cubiertos por `frontend/tests/edge-captures.test.tsx`; listado real comprobado en AWS (`docs/P4-3-2_E2E_CONTRAST.md`). Falta demostrar que una captura nueva aparece al actualizar. |
| 6.1 | README/ficha con instalación, arranque, recuperación de artefactos y recorrido | Santiago + todos | EN PROGRESO — guía en `README.md`, `docs/P4_EVALUATOR_RUNBOOK.md`, `edge/README.md` y release público del modelo; falta comprobar el recorrido con otro integrante o en la demostración. No se afirma reproducción desde clon limpio. |
| 6.2 | Pasos repetibles para conversión, inferencia conocida y evento enviado/recuperado; cinco IDs contrastados | Santiago + todos | LISTA para evidencia histórica — conversión en `pipeline/scripts/`, inferencia conocida y ruta de envío en `docs/P4_EVALUATOR_RUNBOOK.md`; cinco IDs verificados por script y portal (`docs/P4-3-2_E2E_CONTRAST.md`). La demostración física nueva sigue pendiente. |
| 6.3 | Configuración de ejemplo sin secretos, identidad del dispositivo, artefacto y destino AWS documentados | Santiago | CONFIGURACIÓN LISTA — `edge/.env.example`, `docs/P4_EVALUATOR_RUNBOOK.md` y contrato; el equipo puede demostrar AWS mediante consultas de lectura sin entregar credenciales. Acceso separado al profesor es opcional y debe verificarse si se elige esa modalidad. |

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
| Contraste final de cinco IDs | `docs/P4-3-2_E2E_CONTRAST.md` y `scripts/verify-p4-3-2-readonly.mjs` | Evidencia reproducible de edge, API, S3 y portal sin modificar datos |
| Reintento real | `docs/evidence/p4-4-3/network-retry-sequence.txt` | Fallo, outbox, 201, 200 y un solo registro para el mismo ID |
| Recorrido del evaluador | `docs/P4_EVALUATOR_RUNBOOK.md` y `edge/.env.example` | Artefacto público, configuración sin secreto, cámara, AWS y portal |

## Control de cierre

Antes de la entrega, cada fila marcada `LISTA` debe apuntar a una ruta, una URL o un
paso de demostración concreto. Para M3 ya se contrastaron cinco `capture_id` históricos en
dispositivo, AWS y portal; falta ejecutar una captura nueva dirigida ante el evaluador. El
video es opcional y no sustituye los 100 puntos base.

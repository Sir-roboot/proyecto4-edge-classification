# P4-2.4 — Operación sostenida del dispositivo edge

**Fecha:** 2026-10-15
**Responsable:** Quiroz Valdovinos, Andrés
**Rúbrica asociada:** 2.4 (y parte de dispositivo de P4-3.1)

## Objetivo

Registrar **20 capturas**, **cinco minutos de operación** continua del
dispositivo y **una captura posterior a un reinicio**, clasificando localmente
con la variante ONNX INT8. Esta ficha cubre la operación del dispositivo; **no**
incluye el envío a AWS (ver nota al final).

## Recorrido ejecutado

El dispositivo capturó y clasificó en bucle (cada ~15 s) con la cámara USB,
mostrando ambas clases congeladas frente a la cámara. Bitácora completa:
`docs/evidence/p4-2-4/operation-log.jsonl` (una línea JSON por captura).

| Métrica | Resultado |
| --- | --- |
| Capturas registradas | **20** |
| Clases observadas | **ambas**: 11 `person`, 9 `car` |
| Ventana de operación | 16:03:55 → 16:09:00 (hora CDMX) = **5 min 5 s** |
| Imágenes conservadas | 20 (en el dispositivo), ninguna oscura/negra |
| Muestras | `docs/evidence/p4-2-4/sample-car.jpg`, `docs/evidence/p4-2-4/sample-person.jpg` |

> Un primer intento salió con 11 cuadros en negro porque la webcam tenía la tapa
> puesta; se repitió el recorrido con la cámara destapada (los 20 cuadros de esta
> evidencia tienen brillo normal, verificado sobre los bytes).

## Captura posterior a reinicio

Tras reiniciar la Raspberry (`uptime` = 1 min, confirma arranque limpio), el
dispositivo volvió a capturar y clasificar sin intervención:

```json
{"captured_at":"2026-10-15T15:57:48.838800-06:00",
 "predicted_class":"person","confidence":0.985285,"inference_ms":57.65}
```

Imagen: `docs/evidence/p4-2-4/post-reboot.jpg`. Esto demuestra que el flujo
cámara → preprocesamiento → inferencia queda operativo después de un reinicio,
sin pasos manuales.

## Reproducción

```bash
# En la Raspberry (recorrido de 20 capturas, una cada 15 s):
python edge_infer_onnx.py --model model.int8.onnx --loop 15 --save-dir edge-2-4
# ...detener al llegar a 20 capturas; reiniciar; y una captura más:
python edge_infer_onnx.py --model model.int8.onnx --camera --save-dir edge-2-4-postreboot
```

## Nota sobre P4-3.1 / M3 (envío a AWS)

P4-3.1 añade a lo anterior el **envío de las 20 capturas al AWS real** y el
contraste en el portal (M3), **sin duplicados**. Esa parte está **bloqueada**
porque el endpoint de AWS del smoke test de P4-2.1
(`d3mjwen8lb1kx3.cloudfront.net`) **ya no resuelve en DNS** (la infraestructura
dev se bajó tras ese smoke). Requiere que Santiago vuelva a desplegar el
servicio (o entregue la URL vigente) y el `EDGE_INGEST_TOKEN`. El cliente de
envío ya está probado contra el backend real (`docs/P4-2-2_EDGE_CLIENT_EVIDENCE.md`);
al reactivarse AWS, solo cambia `EDGE_API_BASE_URL`.

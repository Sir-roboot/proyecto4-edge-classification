# Operación sostenida del dispositivo edge — criterio 2.4, ticket P4-3.1

**Fecha:** 2026-10-15
**Responsable:** Quiroz Valdovinos, Andrés
**Rúbrica asociada:** 2.4 (y parte de dispositivo de P4-3.1)

> `2.4` es el **criterio de evaluación**, no el ticket P4-2.4 del plan.
> Ese ticket corresponde al portal Capturas Edge de Ignacio.

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

Tras reiniciar la Raspberry (`uptime` reportado: 1 min), se volvió a ejecutar
el programa y el dispositivo capturó y clasificó:

```json
{"captured_at":"2026-10-15T15:57:48.838800-06:00",
 "predicted_class":"person","confidence":0.985285,"inference_ms":57.65}
```

Imagen: `docs/evidence/p4-2-4/post-reboot.jpg`. Esta captura se obtuvo antes
del recorrido sostenido de 20 imágenes; demuestra que el flujo cámara →
preprocesamiento → inferencia puede volver a ejecutarse después de un reinicio.
No se afirma arranque automático del programa.

## Reproducción

```bash
# En la Raspberry (recorrido de 20 capturas, una cada 15 s):
python edge_infer_onnx.py --model model.int8.onnx --loop 15 --save-dir edge-2-4
# ...detener al llegar a 20 capturas; reiniciar; y una captura más:
python edge_infer_onnx.py --model model.int8.onnx --camera --save-dir edge-2-4-postreboot
```

## Nota sobre P4-3.1 / M3 (envío a AWS)

Las 20 capturas de este recorrido ya se enviaron al AWS real. El resumen de
IDs y objetos S3 está en `docs/P4-3-1_EDGE_TO_AWS_EVIDENCE.md` y
`docs/evidence/p4-3-1/aws-sends-summary.txt`. El tramo pendiente de M3 es su
visualización en el portal Capturas Edge, a cargo de Ignacio; el contraste de
cinco IDs entre dispositivo, AWS y portal corresponde a P4-3.2.

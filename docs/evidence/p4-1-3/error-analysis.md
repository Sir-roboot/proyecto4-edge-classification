\# P4-1.3 — Análisis de errores de validación



La comparación usa las mismas 203 muestras de validación para el modelo

original FP32 y la variante INT8.



\## annotation\_id 553



\- Etiqueta real: `person`

\- FP32: `car` (0.9365)

\- INT8: `car` (0.9545)



En el recorte aparece una persona, pero una parte importante de la imagen

está ocupada por un vehículo policial detrás. Las características visuales

del automóvil son muy prominentes y ambos modelos clasifican la muestra

como `car`.



\## annotation\_id 623



\- Etiqueta real: `person`

\- FP32: `car` (0.5908)

\- INT8: `car` (0.6737)



La persona aparece parcialmente y desenfocada en primer plano, mientras que

un automóvil al fondo se observa con mayor definición. Esta composición

hace plausible que las características del vehículo dominen la predicción

de ambos modelos.



\## annotation\_id 573



\- Etiqueta real: `car`

\- FP32: `person` (0.6444)

\- INT8: `person` (0.6410)



El recorte es muy estrecho y muestra solamente una parte del automóvil,

además de existir oclusión. La forma global del vehículo casi no está

disponible, por lo que la muestra resulta visualmente ambigua. No se puede

atribuir el error a una característica específica con certeza.



\## annotation\_id 571



\- Etiqueta real: `car`

\- FP32: `person` (0.5202)

\- INT8: `car` (0.5000)



El recorte contiene una porción pequeña del automóvil y ofrece poco contexto.

El modelo FP32 ya estaba muy cerca del límite de decisión. En INT8 las

probabilidades quedaron exactamente 0.5 para `car` y 0.5 para `person`;

`argmax` selecciona `car` porque corresponde al índice 0. Por lo tanto, esta

corrección debe interpretarse como un caso límite y no como una mejora fuerte

de confianza causada por la cuantización.



\## Conclusión



La cuantización INT8 no introdujo una degradación observable en el conjunto

de validación: los tres errores restantes corresponden a recortes con fuerte

presencia de la clase opuesta, desenfoque, oclusión o contexto visual limitado.

El único cambio de decisión, annotation\_id 571, ocurre exactamente en el

límite 0.5/0.5.


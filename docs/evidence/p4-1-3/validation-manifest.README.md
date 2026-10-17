# Manifiesto original recuperable

`validation-manifest.zip` contiene únicamente `classifier_split_manifest.json`:
198 050 bytes, SHA-256
`394743403f8a263b462687b733272e9993d7dddaea6a1229f8ee2896b82f3f7d`.

Son los bytes originales del Proyecto 3 utilizados por la conversión,
calibración y comparación P4, sin cambiar etiquetas, splits ni serialización.
El hash coincide con `docs/evidence/p4-1-1/quantization.json`. El ZIP conserva
los bytes exactos, independientemente de la conversión CRLF de Git en Windows.
No contiene fotografías, pesos, tokens ni credenciales. Sus rutas de crops son
referencias relativas al pipeline; las cuatro muestras para reproducción están
en esta misma carpeta (553, 571, 573 y 623.png).

Desde la raíz del repo, verificar sin instalar dependencias:

```bash
python scripts/verify_p4_validation_evidence.py
python -m unittest discover -s scripts/tests -p test_p4_validation_evidence.py -v
```

El verificador lee el ZIP en memoria (sin extraer rutas), verifica su SHA,
contrasta las 203 predicciones de ambos CSV con muestras/etiquetas/fuentes,
recalcula accuracy/F1 y comprueba la procedencia de calibración: 128 train,
64 por clase, sin solapamiento con validación/test. No ejecuta inferencia ni
cuantización y no afirma sustituir la demostración física.

El paquete se incorporó porque el objeto DVC del manifiesto no se recuperó
en el remoto documentado. No supone que se haya reparado/publicado ese remoto.
Para regenerar el paquete, únicamente con el manifiesto exacto ya recuperado:

```bash
python scripts/verify_p4_validation_evidence.py --package-from /ruta/classifier_split_manifest.json
```

Se rechaza otro SHA y no se sobrescribe un paquete diferente. No hace falta
regenerarlo para evaluar: el paquete entregado se verifica directamente.

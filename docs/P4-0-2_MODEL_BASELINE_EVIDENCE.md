\# P4-0.2 — Evidencia del modelo base del Proyecto 3



Fecha de verificación: 2026-10-14  

Responsable: Luis Víctor Leal González  

Issue: #7  

Rama de trabajo: `feat/p4-1-1-model-optimization`



\## Objetivo



Identificar de forma verificable el modelo original heredado del Proyecto 3 que será utilizado como base para la optimización del Proyecto 4.



La información se obtuvo de los registros versionados del repositorio, principalmente:



\- `pipeline/reports/classifier/releases/v1.0.0.json`

\- `pipeline/reports/classifier/selection.json`

\- `docs/t3-3-6-model-release.md`



\## Modelo original



| Campo | Valor |

| --- | --- |

| Versión del modelo | `v1.0.0` |

| Arquitectura | `ResNet-18` |

| MLflow run ID | `44725ac6b1704fed8b06bc4f846651d8` |

| Run name | `r03-adamw-lr1e-4` |

| Clases | `car`, `person` |

| Número de clases | 2 |

| Checkpoint | `t3-classifier/v1.0.0/model.pt` |

| Tamaño registrado | `45,304,323 bytes` |

| SHA-256 del checkpoint | `fe1c2370cb9d811d32cccc27edf0beeb3c440fe758c467a9e3fb91a73e6047cb` |

| Dataset de origen | `v1.0.0` |

| Manifest SHA-256 | `394743403f8a263b462687b733272e9993d7dddaea6a1229f8ee2896b82f3f7d` |



\## Preprocesamiento de entrada



El modelo utiliza el mismo preprocesamiento utilizado durante validación e inferencia en el Proyecto 3:



\- Modo de color: `RGB`

\- Resolución de entrada: `128 x 128`

\- Conversión a tensor: escala de valores a `\[0, 1]`

\- Media de normalización:

&#x20; - `0.485`

&#x20; - `0.456`

&#x20; - `0.406`

\- Desviación estándar:

&#x20; - `0.229`

&#x20; - `0.224`

&#x20; - `0.225`



Este preprocesamiento deberá conservarse en la variante optimizada para que la comparación entre el modelo original y el optimizado sea válida.



\## Selección del modelo



El checkpoint corresponde al candidato seleccionado en el Proyecto 3 mediante métricas de validación.



\- Métrica de selección: `best\_val\_accuracy`

\- Mejor accuracy de validación registrada: `0.9802955665`

\- Mejor época: `7`

\- Optimizador: `adamw`

\- Learning rate: `0.0001`

\- Batch size: `32`

\- Image size: `128`

\- Dropout: `0.3`

\- Hidden layers: `\[256]`



La evaluación de test registrada posteriormente obtuvo:



\- Accuracy: `0.9894736842` (94/95)

\- F1 macro: `0.9892400045`



Estas métricas se conservan únicamente como trazabilidad del Proyecto 3. El test no se utilizará para seleccionar ni ajustar la técnica de optimización del Proyecto 4.



\## Verificación realizada



Desde el clon actualizado del repositorio se consultó directamente el registro del release:



```powershell

$r = Get-Content .\\pipeline\\reports\\classifier\\releases\\v1.0.0.json -Raw | ConvertFrom-Json



$r.version

$r.run\_id

$r.run\_name

$r.checkpoint\_sha256

$r.objects.'model.pt'.size

$r.s3\_uri


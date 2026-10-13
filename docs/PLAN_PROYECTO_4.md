# Plan y reparto de trabajo — Proyecto 4

## 1. Objetivo

Continuar el producto de los Proyectos 1–3 con este recorrido verificable:

```text
modelo propio del Proyecto 3
  → variante optimizada
  → cámara e inferencia local en un dispositivo edge físico
  → fotografía y metadatos persistidos en AWS
  → sección Capturas Edge dentro del portal existente
```

El Proyecto 4 dura una semana y no requiere volver a entrenar el modelo, repetir las diez
corridas de MLflow, crear otro dataset, detectar varios objetos ni transmitir video.

## 2. Equipo

| Integrante | Responsabilidad principal | Responsabilidad de respaldo |
| --- | --- | --- |
| Santiago Ortiz | Project Manager, contrato de integración, AWS, control de evidencias y demo | Revisión de backend, CI y documentación |
| Leal González, Luis Víctor | Optimización del modelo y comparación de calidad/recursos | Empaquetado reproducible del artefacto |
| Quiroz Valdovinos, Andrés | Raspberry Pi, cámara, runtime e inferencia local sin red | Cliente de envío, operación y benchmark en edge |
| Villaseñor Bernal, Ignacio | Backend de consulta y sección Capturas Edge del portal | Estados de carga/error y pruebas de integración |

Los usuarios de GitHub de Luis Víctor, Andrés e Ignacio están pendientes de confirmación. No se
asignarán issues a cuentas inferidas únicamente por el nombre.

## 3. Línea base congelada del Proyecto 3

| Elemento | Valor comprobado |
| --- | --- |
| Repositorio de origen | `BryanRomoG/proyecto3-classifier-portal` |
| Commit base importado | `5230ea63853990614a616250580068294b459ef7` |
| Dataset | `v1.0.0` |
| Clases | `car`, `person` |
| Run seleccionado | `44725ac6b1704fed8b06bc4f846651d8` (`r03-adamw-lr1e-4`) |
| Accuracy de test registrada | `0.9894736842105263` (94/95) |
| F1 macro de test registrada | `0.9892400045305243` |

La comparación del Proyecto 4 debe usar la misma validación para original y optimizado. El test
anterior no se reutiliza para ajustar ni escoger la técnica de optimización.

## 4. Decisiones que deben cerrarse en el Día 1

1. Confirmar modelo exacto de Raspberry Pi, RAM, arquitectura y sistema operativo.
2. Confirmar cámara disponible, interfaz y una captura real.
3. Probar si el checkpoint original puede cargarse en el dispositivo.
4. Elegir runtime y técnica compatibles después de medir: TorchScript, ONNX Runtime u otra.
5. Congelar el contrato del evento antes de implementar AWS, edge y frontend.
6. Confirmar cuenta, región y recursos AWS que se reutilizarán.
7. Confirmar usuarios de GitHub y fecha real de entrega.

La guía recibida menciona el 9 de octubre de 2026, fecha anterior a la creación de este plan.
Hasta confirmar la fecha vigente se usan hitos relativos `Día 1` a `Día 7`.

## 5. Contrato mínimo del evento

| Campo | Regla |
| --- | --- |
| `capture_id` | UUID generado en el edge; permanece igual durante reintentos |
| `captured_at` | Fecha de captura con zona horaria |
| `received_at` | Fecha asignada al persistir en AWS |
| `device_id` | Identificador estable y configurable del dispositivo |
| `model_version` | Versión y hash de la variante optimizada |
| `predicted_class` | Una de las clases congeladas: `car` o `person` |
| `confidence` | Número entre 0 y 1 calculado localmente |
| `image_sha256` | Hash de los mismos bytes enviados |
| `image_key` | Referencia persistida por el backend/AWS |
| `crop` | Región utilizada, solo si se aplica recorte |

La persistencia debe ser idempotente por `capture_id`: reintentar el mismo evento no crea dos
registros ni dos fotografías lógicas.

## 6. Backlog y asignación

| ID | Responsable | Entregable y criterio de cierre | Depende de | Rúbrica |
| --- | --- | --- | --- | --- |
| P4-0.1 | Santiago | Repositorio, reglas de ramas, contrato del evento y matriz de evidencias publicados | — | 6.1, 6.3 |
| P4-0.2 | Luis Víctor | Modelo original recuperado; pesos, clase, preprocesamiento, versión y SHA-256 comprobados | — | M1, 1.1 |
| P4-0.3 | Andrés | Ficha de Raspberry/cámara/runtime y captura de prueba; limitaciones registradas | — | M2, 2.1 |
| P4-0.4 | Santiago | Inventario AWS y diseño mínimo de persistencia/consulta sin secretos | P4-0.1 | M3, 4.2 |
| P4-0.5 | Ignacio | Diseño de ruta, navegación, estados y contrato de Capturas Edge | P4-0.1 | 5.1–5.3 |
| P4-1.1 | Luis Víctor | Script reproducible que genera una variante optimizada desde el modelo original, con hash y configuración | P4-0.2, P4-0.3 | 1.1, 1.2 |
| P4-1.2 | Andrés | Programa autónomo de cámara → preprocesamiento → inferencia; funciona después de desconectar la red | P4-0.3, P4-1.1 | M2, 2.1–2.3 |
| P4-1.3 | Luis Víctor | Predicciones original/optimizado sobre la misma validación; accuracy y F1 recalculables por clase | P4-1.1 | 1.3 |
| P4-1.4 | Luis Víctor + Andrés | Benchmark: 10 calentamientos y al menos 100 tiempos válidos; tamaño y p50/p95 | P4-1.1, P4-1.2 | 3.1–3.3 |
| P4-2.1 | Santiago | Ingesta idempotente en AWS de imagen y evento; consulta de lectura y reintento sin duplicados | P4-0.4 | 4.1–4.3 |
| P4-2.2 | Andrés | Cliente edge que conserva `capture_id`, muestra error y permite reintento manual | P4-1.2, P4-2.1 | 4.1, 4.3 |
| P4-2.3 | Ignacio | API de consulta paginada, imagen recuperable y orden reciente → antiguo | P4-2.1 | 4.2, 5.2 |
| P4-2.4 | Ignacio | Página Capturas Edge en la navegación existente, con carga, vacío, error y actualización | P4-0.5, P4-2.3 | M3, 5.1–5.3 |
| P4-3.1 | Andrés + Santiago | Veinte capturas reales repartidas entre clases, cinco minutos de operación y reinicio | P4-1.2, P4-2.2, P4-2.4 | 2.4, 4.1 |
| P4-3.2 | Santiago | Verificación cruzada de cinco IDs entre edge, AWS y portal; matriz de evidencias completa | P4-3.1 | M3, 6.2 |
| P4-3.3 | Todos | Reproducción con README, demo de 10–15 minutos y video opcional de 3–5 minutos | P4-3.2 | 6.1–6.3, V1–V3 |

## 7. Plan relativo de siete días

| Día | Resultado obligatorio |
| --- | --- |
| 1 | P4-0.1 a P4-0.5: modelo, hardware, contrato, AWS y portal definidos |
| 2 | Primera variante optimizada cargable y primera inferencia desde cámara |
| 3 | Inferencia offline estable y primer evento aceptado por AWS |
| 4 | Primera fotografía real visible en Capturas Edge |
| 5 | Comparación de calidad y benchmark de 100 mediciones cerrados |
| 6 | Veinte capturas, reinicio, fallo controlado y reintento sin duplicados |
| 7 | Reproducción, revisión de evidencias, ensayo y video opcional |

AWS y portal avanzan desde el Día 1 con el contrato acordado; no esperan a que termine la
optimización. El primer recorrido completo debe existir a más tardar en el Día 4.

## 8. Compuertas y definición global de terminado

La entrega no se considera terminada si falta cualquiera de estas tres compuertas:

- **M1:** la variante desplegada procede del modelo propio del Proyecto 3;
- **M2:** la Raspberry Pi clasifica localmente con cámara, incluso sin red;
- **M3:** una captura nueva llega a AWS y aparece en Capturas Edge dentro del portal.

Además deben existir:

- variante recuperable, hash y conversión reproducible;
- predicciones por muestra y métricas comparables;
- 100 tiempos válidos posteriores a 10 calentamientos;
- 20 fotografías con metadatos completos;
- prueba de fallo y reintento del mismo ID sin duplicación;
- README reproducible y configuración de ejemplo sin secretos;
- demostración funcional; video solo si se busca el bono de 15 puntos.

## 9. Flujo de Git y control del PM

- `main` permanece integrable; cada ticket usa `feat/p4-<id>-descripcion`.
- Todo cambio entra mediante Pull Request y referencia su ID.
- El responsable adjunta evidencia concreta y comandos ejecutados.
- El PM revisa primero las tres compuertas y después el detalle de la rúbrica.
- Los artefactos grandes permanecen en almacenamiento; Git conserva referencias y SHA-256.
- Nunca se versionan API keys, credenciales AWS, archivos `.env` ni contraseñas del portal.

## 10. Bloqueos iniciales

| Bloqueo | Dueño | Acción inmediata |
| --- | --- | --- |
| Usuarios de GitHub desconocidos | Santiago | Solicitar los tres usuarios y agregarlos como colaboradores |
| Fecha real no confirmada | Santiago | Confirmarla con el docente/equipo y convertir Días 1–7 en fechas |
| Raspberry/cámara no caracterizadas | Andrés | Informar modelo, RAM, SO, arquitectura y cámara |
| Runtime de optimización no elegido | Luis Víctor + Andrés | Probar carga y una entrada conocida antes de comprometer formato |
| Recursos AWS para capturas no definidos | Santiago | Inventariar y elegir la mínima extensión de infraestructura |

## 11. Control diario del PM

En cada reunión se solicita una evidencia ejecutable por frente, se verifica el siguiente
traspaso y se asigna dueño y fecha a cada bloqueo. La prioridad diaria es el recorrido completo,
no la cantidad de código: modelo propio → edge físico → AWS → portal.

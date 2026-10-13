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

## 4. Fecha de entrega y decisiones inmediatas

**Entrega confirmada:** viernes 16 de octubre de 2026 a las 23:59, hora de Ciudad de México.

El equipo trabajará con un cierre interno a las **21:00 del viernes**. Las últimas 2 horas 59
minutos quedan como margen para corregir enlaces, permisos o problemas de carga; no para agregar
funcionalidad.

1. Confirmar modelo exacto de Raspberry Pi, RAM, arquitectura y sistema operativo.
2. Confirmar cámara disponible, interfaz y una captura real.
3. Probar si el checkpoint original puede cargarse en el dispositivo.
4. Elegir runtime y técnica compatibles después de medir: TorchScript, ONNX Runtime u otra.
5. Congelar el contrato del evento antes de implementar AWS, edge y frontend.
6. Confirmar cuenta, región y recursos AWS que se reutilizarán.
7. Confirmar usuarios de GitHub y agregarlos como colaboradores.

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

## 6. Backlog priorizado y asignación

- **P0:** activa una compuerta M1–M3 o bloquea el recorrido completo. No puede posponerse.
- **P1:** puntos base importantes y evidencia obligatoria; se termina antes del viernes.
- **P2:** bono o mejora que solo comienza cuando la base funciona.

| ID | Pri. | Responsable | Límite interno | Entregable y criterio de cierre | Depende de | Rúbrica |
| --- | --- | --- | --- | --- | --- | --- |
| P4-0.1 | P0 | Santiago | Mar 13, 16:00 | Repositorio, ramas, contrato del evento y matriz de evidencias publicados | — | 6.1, 6.3 |
| P4-0.2 | P0 | Luis Víctor | Mar 13, 18:00 | Modelo original recuperado; pesos, clases, preprocesamiento, versión y SHA-256 comprobados | — | M1, 1.1 |
| P4-0.3 | P0 | Andrés | Mar 13, 18:00 | Ficha de Raspberry/cámara/runtime y una captura real; limitaciones registradas | — | M2, 2.1 |
| P4-0.4 | P0 | Santiago | Mar 13, 20:00 | Recursos AWS elegidos y contrato de ingesta/consulta definido sin secretos | P4-0.1 | M3, 4.2 |
| P4-0.5 | P0 | Ignacio | Mar 13, 20:00 | Ruta, navegación, estados y maqueta funcional de Capturas Edge con datos de contrato | P4-0.1 | 5.1–5.3 |
| P4-1.1 | P0 | Luis Víctor | Mié 14, 13:00 | Script reproducible genera una variante optimizada, con hash y configuración; prueba una entrada conocida | P4-0.2, P4-0.3 | M1, 1.1, 1.2 |
| P4-1.2 | P0 | Andrés | Mié 14, 18:00 | Cámara → preprocesamiento → inferencia autónoma; continúa después de desconectar la red | P4-0.3, P4-1.1 | M2, 2.1–2.3 |
| P4-2.1 | P0 | Santiago | Mié 14, 18:00 | Ingesta idempotente en AWS de imagen/evento y consulta de lectura | P4-0.4 | M3, 4.1–4.3 |
| P4-2.3 | P0 | Ignacio | Mié 14, 20:00 | API de consulta e imagen recuperable, orden reciente → antiguo | P4-2.1 | M3, 4.2, 5.2 |
| P4-2.4 | P0 | Ignacio | Jue 15, 11:00 | Capturas Edge integrada al portal con carga, vacío, error y actualización | P4-0.5, P4-2.3 | M3, 5.1–5.3 |
| P4-2.2 | P0 | Andrés | Jue 15, 11:00 | Cliente edge conserva `capture_id`, muestra error y reintenta manualmente | P4-1.2, P4-2.1 | 4.1, 4.3 |
| P4-1.3 | P1 | Luis Víctor | Jue 15, 14:00 | Predicciones original/optimizado sobre la misma validación; accuracy y F1 por clase recalculables | P4-1.1 | 1.3 |
| P4-1.4 | P1 | Luis Víctor + Andrés | Jue 15, 17:00 | 10 calentamientos, 100 tiempos válidos, tamaños y p50/p95 bajo condiciones documentadas | P4-1.1, P4-1.2 | 3.1–3.3 |
| P4-3.1 | P0 | Andrés + Santiago | Jue 15, 20:00 | Veinte capturas reales, ambas clases, cinco minutos, reinicio y reintento sin duplicados | P4-1.2, P4-2.2, P4-2.4 | 2.4, 4.1, 4.3 |
| P4-3.2 | P1 | Santiago | Vie 16, 13:00 | Cinco IDs contrastados entre edge, AWS y portal; matriz de evidencias completa | P4-3.1 | M3, 6.2 |
| P4-3.3 | P1/P2 | Todos | Vie 16, 18:00 | README reproducido y demo lista; video de 3–5 minutos solo después de aprobar la base | P4-3.2 | 6.1–6.3, V1–V3 |

## 7. Plan de choque hasta la entrega

### Martes 13 — Desbloquear los cuatro frentes

- **16:00:** contrato y repositorio listos; cada integrante trabaja en una rama separada.
- **18:00:** Luis confirma modelo original y Andrés demuestra cámara/hardware.
- **20:00:** Santiago congela AWS/ingesta e Ignacio entrega la página contra el contrato.
- **Cierre:** ninguna persona espera a otra para empezar; frontend usa fixture contractual y
  AWS acepta un evento de prueba generado desde laptop.

### Miércoles 14 — Probar las tres compuertas por separado

- **13:00:** variante optimizada cargable, reproducible y vinculada al modelo original (M1).
- **18:00:** inferencia con cámara continúa sin red en la Raspberry (M2).
- **20:00:** imagen/evento se persisten y pueden consultarse en AWS; API disponible para portal.
- **Cierre:** existe una grabación corta o evidencia de cada compuerta aislada.

### Jueves 15 — Recorrido completo y datos evaluables

- **11:00:** primera captura real recorre Raspberry → AWS → Capturas Edge (M3).
- **14:00:** comparación de calidad cerrada sobre la misma validación.
- **17:00:** benchmark de 100 mediciones cerrado.
- **20:00:** 20 capturas, cinco minutos, reinicio y fallo/reintento sin duplicación.
- **Cierre:** congelamiento funcional; después de esta hora solo se corrigen defectos.

### Viernes 16 — Evidencia, reproducción y entrega

- **10:00:** corregir únicamente defectos encontrados en el ensayo del jueves.
- **13:00:** contrastar cinco IDs y completar ficha, hashes, métricas y enlaces.
- **16:00:** otro integrante sigue el README desde una configuración limpia o restaurable.
- **18:00:** ensayo de 10–15 minutos; grabar video opcional únicamente si la base está verde.
- **21:00:** congelamiento de entrega, respaldo y verificación de permisos/enlaces.
- **23:00:** carga final terminada; quedan 59 minutos de contingencia.
- **23:59:** límite oficial.

## 8. Recortes de alcance obligatorios

Hasta asegurar los 100 puntos base, no se trabaja en:

- entrenamiento nuevo, nuevas clases o nuevas corridas de búsqueda;
- video en streaming, múltiples objetos, bounding boxes o segmentación;
- IoT Core, colas persistentes, websockets, filtros o dashboards avanzados;
- arranque automático de la Raspberry, orquestación completa o infraestructura nueva si un
  bucket/prefijo y el backend existente resuelven el flujo;
- CI adicional, refactors generales o mejoras visuales que no cubran la rúbrica.

La técnica de optimización se decide por la primera opción compatible y medible. Si ONNX/TorchScript
no funciona antes del límite de P4-1.1, se documenta el fallo y se cambia inmediatamente a otra
variante; no se pierde un día defendiendo una herramienta.

## 9. Compuertas y definición global de terminado

La evidencia y su responsable se controlan en `docs/EVIDENCE_MATRIX.md`; ninguna fila se marca
como lista únicamente por una descripción verbal.

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

## 10. Flujo de Git y control del PM

- `main` permanece integrable; cada ticket usa `feat/p4-<id>-descripcion`.
- Todo cambio entra mediante Pull Request y referencia su ID.
- El responsable adjunta evidencia concreta y comandos ejecutados.
- El PM revisa primero las tres compuertas y después el detalle de la rúbrica.
- Los artefactos grandes permanecen en almacenamiento; Git conserva referencias y SHA-256.
- Nunca se versionan API keys, credenciales AWS, archivos `.env` ni contraseñas del portal.
- PRs P0 de menos de 300 líneas funcionales reciben revisión prioritaria; si un cambio crece más,
  se divide por contrato, backend, dispositivo o UI.
- El PM hace cortes de integración a las 14:00 y 20:00; no espera al final del día para descubrir
  conflictos.

## 11. Bloqueos iniciales

| Bloqueo | Dueño | Acción inmediata |
| --- | --- | --- |
| Usuarios de GitHub desconocidos | Santiago | Solicitar los tres usuarios y agregarlos como colaboradores |
| Ventana de trabajo reducida | Santiago | Aplicar prioridades P0/P1/P2 y congelar funcionalidad el jueves a las 20:00 |
| Raspberry/cámara no caracterizadas | Andrés | Informar modelo, RAM, SO, arquitectura y cámara |
| Runtime de optimización no elegido | Luis Víctor + Andrés | Probar carga y una entrada conocida antes de comprometer formato |
| Recursos AWS para capturas no definidos | Santiago | Inventariar y elegir la mínima extensión de infraestructura |

## 12. Control del PM durante el cierre

En cada reunión se solicita una evidencia ejecutable por frente, se verifica el siguiente
traspaso y se asigna dueño y fecha a cada bloqueo. La prioridad diaria es el recorrido completo,
no la cantidad de código: modelo propio → edge físico → AWS → portal.

Habrá sincronizaciones breves a las **10:00, 14:00 y 20:00**. Cada reporte responde solo:
qué evidencia quedó, qué bloquea el siguiente traspaso y quién lo resolverá antes del siguiente
corte. Un bloqueo P0 sin siguiente acción se escala inmediatamente al PM.

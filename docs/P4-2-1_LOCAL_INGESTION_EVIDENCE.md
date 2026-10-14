# P4-2.1 — Evidencia local de ingesta idempotente

**Fecha:** 2026-10-14  
**Alcance:** backend, MariaDB y MinIO locales. Esta evidencia no demuestra todavía AWS,
la Raspberry ni la compuerta M3.

## Objetivo

Comprobar antes del despliegue que `POST /api/edge-captures` conserva el contrato de
captura, persiste una sola fotografía lógica por `capture_id` y rechaza reutilizar ese
identificador con contenido diferente.

## Entorno usado

- Node.js 20.20.0;
- MariaDB 11 y MinIO levantados mediante Docker Compose;
- imagen de desarrollo `pipeline/reports/classifier/confusion_matrix.png`;
- `device_id` y `model_version`: `integration-test`.

La imagen anterior es solamente un fixture para probar el transporte. No sustituye las
fotografías nuevas que debe producir la cámara durante la entrega.

## Recorrido ejecutado

1. Se levantaron exclusivamente `mariadb` y `minio`.
2. Se aplicaron las seis migraciones; `edge_captures` quedó disponible.
3. Se inició temporalmente el backend en `127.0.0.1:3100`.
4. Se calculó el SHA-256 real de la imagen y se envió un multipart con `metadata` como
   campo de texto e `image` como archivo.
5. Se repitió el mismo evento y después se cambió únicamente `confidence` conservando
   el mismo `capture_id`.
6. Se consultaron MariaDB y MinIO directamente.
7. Se eliminaron solamente la fila y el objeto de la prueba y se detuvieron los servicios.

## Resultado observado

| Comprobación | Resultado |
| --- | --- |
| `capture_id` | `e3af2a54-6b8a-45b8-8451-d57b17c1963a` |
| SHA-256 de la imagen | `f243a3fae098445b6d940e9ef30c7d30bcb8fc8be42554c9e2b45442e690a800` |
| Primera ingesta | HTTP `201` |
| Reintento idéntico | HTTP `200` |
| Mismo ID con `confidence` diferente | HTTP `409` |
| Filas para el ID después de los tres envíos | `1` |
| Objeto indicado por `image_key` | Existente en MinIO, `image/png`, 10,994 bytes |
| Limpieza | `0` filas y objeto ausente |

La key resultante siguió la forma estable
`edge-captures/<capture_id>/<image_sha256>.png`. Los volúmenes se conservaron y no quedó
ningún proceso ni contenedor ejecutándose.

## Verificaciones automatizadas

~~~text
backend: npm test          121/121 pruebas aprobadas en 15 archivos
backend: npm run typecheck aprobado
backend: npm run lint      aprobado; solo informó diferencia de versión del schema de Biome
~~~

## Pendiente para cerrar P4-2.1 y M3

- desplegar el servicio y el almacenamiento en AWS;
- identificar el recurso AWS y demostrar lectura del registro y la imagen;
- provocar un fallo reversible de envío desde el entorno de evaluación y reintentar;
- sustituir el fixture por fotografías nuevas producidas por la Raspberry;
- comprobar que esas capturas aparecen en la sección *Capturas Edge* del portal.


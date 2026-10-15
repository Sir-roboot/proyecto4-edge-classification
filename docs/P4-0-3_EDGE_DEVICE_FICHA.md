# P4-0.3 — Ficha técnica del dispositivo edge

**Fecha de caracterización:** 2026-10-14
**Responsable:** Quiroz Valdovinos, Andrés
**Rúbrica asociada:** M2 (parcial), 2.1
**Evidencia cruda:** `docs/evidence/p4-0-3/colecta-20261014.md` (salida literal de
`scripts/edge/collect_device_info.sh`, reproducible en el dispositivo)

## 1. Dispositivo

| Campo | Valor comprobado |
| --- | --- |
| Modelo | Raspberry Pi 4 Model B Rev 1.2 (revisión `c03112`) |
| CPU | ARM Cortex-A72, 4 núcleos, 600–1500 MHz |
| RAM | 4 GB (3.7 GiB utilizables, swap de 2 GiB) |
| Almacenamiento | microSD de 29 GB, 22 GB libres |
| Arquitectura | `aarch64`, userland de **64 bits** |
| Sistema operativo | Debian GNU/Linux 13 (trixie), kernel `6.18.50+rpt-rpi-v8` (Raspberry Pi OS) |
| Python del sistema | 3.13.5 (pip 25.1.1) |
| Temperatura en reposo | 46–52 °C, sin eventos de throttling (`throttled=0x0`) |
| `device_id` propuesto | `rpi-edge-01` (configurable vía `EDGE_DEVICE_ID`; hostname actual `raspberrypi`) |

## 2. Cámara

| Campo | Valor comprobado |
| --- | --- |
| Modelo | UGREEN Camera 2K |
| Interfaz | USB (`lsusb`: `0c45:636f Microdia UGREEN Camera 2K`) |
| Exposición en el SO | V4L2, dispositivo principal `/dev/video0` |
| Módulo CSI | **No hay** cámara CSI conectada (`rpicam-hello --list-cameras`: sin cámaras) |
| Herramienta de captura | `fswebcam -r 1280x720 --no-banner` |

### Captura real (evidencia 2.1)

| Campo | Valor |
| --- | --- |
| Archivo | `docs/evidence/p4-0-3/captura.jpg` |
| Resolución | 1280×720, JPEG |
| Tamaño | 341 501 bytes |
| SHA-256 | `69ff0ae0b80a9bdb97fe70a1ea7c8705659731a306d05d0fbccec4cf5a7ce469` |

La captura se tomó en el dispositivo con la webcam conectada a la Raspberry; el
hash se calculó sobre los bytes originales en el dispositivo y debe coincidir
con el archivo versionado.

## 3. Runtime de inferencia

Estado al cierre de esta ficha:

- Presentes: `numpy 2.2.4`, `Pillow 11.1.0`.
- **No instalados aún:** `torch`, `torchvision`, `onnxruntime`, `cv2`.
- Por ser `aarch64` de 64 bits, existen wheels oficiales de pip para
  PyTorch (CPU) y ONNX Runtime: ambos son candidatos viables.
- La elección final del runtime ocurre en P4-1.2 siguiendo la regla del plan:
  primera opción compatible y medible, empezando por comprobar que el
  checkpoint original (`model.pt`, ResNet-18) carga en el dispositivo.

## 4. Limitaciones registradas

1. **Sin cámara CSI:** toda captura depende de la webcam USB UGREEN vía V4L2;
   las herramientas `rpicam-*`/`libcamera-*` no aplican a este hardware.
2. **pip bloqueado fuera de entornos virtuales** (Debian 13, PEP 668
   `externally-managed-environment`): el runtime se instala en un venv
   (`python3 -m venv ~/edge-venv`).
3. **Runtime no validado todavía:** al cierre de esta ficha no se había cargado
   el checkpoint en el dispositivo; esa validación es el criterio de P4-1.2.
4. **Condiciones de la captura inicial:** interior con luz artificial,
   1280×720; la posición definitiva de la cámara para la operación de 20
   capturas (P4-3.1) queda por definir.

## 5. Reproducción

```bash
# En la Raspberry:
bash scripts/edge/collect_device_info.sh
# Deja ficha-edge-<fecha>/ficha.md y ficha-edge-<fecha>/captura.jpg
```

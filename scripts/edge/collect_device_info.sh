#!/usr/bin/env bash
# Genera la ficha técnica del dispositivo edge (P4-0.3) en un solo comando.
#
# Se ejecuta EN la Raspberry Pi. Recolecta modelo, RAM, arquitectura, SO,
# cámara y disponibilidad de runtimes de inferencia; intenta una captura real
# con la primera herramienta disponible (rpicam-still → libcamera-still →
# raspistill → fswebcam → ffmpeg) y calcula su SHA-256. Todo queda en un
# directorio de salida con un `ficha.md` listo para copiar a
# docs/P4-0-3_EDGE_DEVICE_FICHA.md, más la captura como evidencia (rúbrica 2.1).
#
# No usa `set -e` a propósito: casi todos los comandos consultados pueden no
# existir según el SO/cámara, y cada ausencia debe quedar REGISTRADA en la
# ficha como limitación, no abortar la colecta.
#
# Requisitos: bash y coreutils. Opcionales (mejoran la ficha):
#   sudo apt install -y v4l-utils fswebcam
#
# Uso:  bash scripts/edge/collect_device_info.sh
#       (la salida queda en ./ficha-edge-<fecha>/)
set -uo pipefail

STAMP="$(date +%Y%m%d_%H%M%S)"
OUT_DIR="ficha-edge-$STAMP"
FICHA="$OUT_DIR/ficha.md"
IMG="$OUT_DIR/captura.jpg"
mkdir -p "$OUT_DIR"

# Escribe en la ficha y en pantalla a la vez.
say() { printf '%s\n' "$*" | tee -a "$FICHA" >/dev/null; }

# Sección con la salida literal de un comando, o la ausencia registrada.
run() {
  local desc="$1"; shift
  say "### $desc"
  say '```'
  say "\$ $*"
  if command -v "$1" >/dev/null 2>&1; then
    "$@" 2>&1 | tee -a "$FICHA" >/dev/null || say "(el comando falló: código $?)"
  else
    say "(no disponible: '$1' no está instalado)"
  fi
  say '```'
  say ""
}

# Lee un archivo de /proc o /etc si existe.
leer() {
  local desc="$1" ruta="$2"
  say "### $desc"
  say '```'
  say "\$ cat $ruta"
  if [ -r "$ruta" ]; then
    tr -d '\0' < "$ruta" | tee -a "$FICHA" >/dev/null
    say ""
  else
    say "(no existe o no es legible: $ruta)"
  fi
  say '```'
  say ""
}

say "# Ficha técnica del dispositivo edge (P4-0.3)"
say ""
say "- Fecha de colecta: $(date --rfc-3339=seconds)"
say "- Hostname (candidato a device_id): $(hostname)"
say "- Usuario: $(whoami)"
say ""

say "## 1. Hardware"
say ""
leer "Modelo de Raspberry" /proc/device-tree/model
run  "Revisión y serie" grep -E 'Revision|Serial|Model|Hardware' /proc/cpuinfo
run  "CPU" lscpu
run  "Núcleos" nproc
run  "Memoria RAM y swap" free -h
run  "Almacenamiento en /" df -h /
run  "Temperatura actual" vcgencmd measure_temp
run  "Throttling (0x0 = sin eventos)" vcgencmd get_throttled
run  "Reparto de memoria ARM/GPU" vcgencmd get_mem arm

say "## 2. Sistema operativo y arquitectura"
say ""
leer "Distribución" /etc/os-release
run  "Kernel" uname -a
run  "Arquitectura de CPU" uname -m
run  "Bits del userland (64 o 32)" getconf LONG_BIT

say "## 3. Cámara"
say ""
run  "Cámaras CSI (Bookworm)" rpicam-hello --list-cameras
run  "Cámaras CSI (Bullseye)" libcamera-hello --list-cameras
run  "Dispositivos V4L2" v4l2-ctl --list-devices
run  "Dispositivos USB" lsusb
say "> Completar a mano: marca y modelo según la etiqueta física de la cámara,"
say "> e interfaz usada (CSI o USB)."
say ""

say "## 4. Captura real"
say ""
CAPTURA_CMD=""
intentar_captura() {
  command -v "$1" >/dev/null 2>&1 || return 1
  "$@" >/dev/null 2>&1 || return 1
  [ -s "$IMG" ] || return 1
  CAPTURA_CMD="$*"
}
intentar_captura rpicam-still -n -t 2000 -o "$IMG" \
  || intentar_captura libcamera-still -n -t 2000 -o "$IMG" \
  || intentar_captura raspistill -n -t 2000 -o "$IMG" \
  || intentar_captura fswebcam -r 1280x720 --no-banner "$IMG" \
  || intentar_captura ffmpeg -y -f v4l2 -i /dev/video0 -frames:v 1 "$IMG" \
  || true

if [ -n "$CAPTURA_CMD" ]; then
  say "- Comando que funcionó: \`$CAPTURA_CMD\`"
  say "- Archivo: \`$IMG\` ($(stat -c %s "$IMG") bytes)"
  say "- SHA-256: \`$(sha256sum "$IMG" | cut -d' ' -f1)\`"
  command -v file >/dev/null 2>&1 && say "- Formato: $(file -b "$IMG")"
else
  say "**NINGUNA herramienta de captura funcionó.** Probar a mano y registrar:"
  say '- `rpicam-still -n -t 2000 -o captura.jpg` (Raspberry Pi OS Bookworm, CSI)'
  say '- `libcamera-still -n -t 2000 -o captura.jpg` (Bullseye, CSI)'
  say '- `fswebcam -r 1280x720 --no-banner captura.jpg` (webcam USB)'
fi
say ""

say "## 5. Runtime de inferencia disponible"
say ""
run "Python" python3 --version
run "pip" pip3 --version
say "### Módulos de inferencia importables"
say '```'
if command -v python3 >/dev/null 2>&1; then
  python3 - <<'PY' 2>&1 | tee -a "$FICHA" >/dev/null
import importlib
for mod in ("torch", "torchvision", "onnxruntime", "numpy", "PIL", "cv2"):
    try:
        m = importlib.import_module(mod)
        print(f"{mod}: {getattr(m, '__version__', 'importable')}")
    except Exception as exc:
        print(f"{mod}: NO ({exc.__class__.__name__})")
PY
else
  say "(python3 no está instalado)"
fi
say '```'
say ""
ARCH="$(uname -m 2>/dev/null || echo desconocida)"
BITS="$(getconf LONG_BIT 2>/dev/null || echo '?')"
if [ "$ARCH" = "aarch64" ] && [ "$BITS" = "64" ]; then
  say "> aarch64 de 64 bits: existen wheels oficiales de pip para torch (CPU) y"
  say "> onnxruntime; ambos runtimes son candidatos viables."
else
  say "> **Limitación clave:** arquitectura \`$ARCH\` con userland de $BITS bits."
  say "> torch y onnxruntime no publican wheels oficiales para ARM de 32 bits;"
  say "> evaluar reinstalar Raspberry Pi OS de 64 bits antes de elegir runtime."
fi
say ""

say "## 6. Limitaciones observadas (completar a mano)"
say ""
say "- [ ] Condiciones de luz / posición de la cámara"
say "- [ ] RAM libre tras cargar el runtime elegido"
say "- [ ] Herramientas que faltaron durante la colecta (ver secciones con 'no disponible')"
say ""

echo ""
echo "Ficha generada en: $FICHA"
[ -s "$IMG" ] && echo "Captura de evidencia: $IMG"
echo "Siguiente paso: copiar ficha.md a docs/P4-0-3_EDGE_DEVICE_FICHA.md,"
echo "completar las secciones marcadas 'a mano' y abrir el PR de P4-0.3."

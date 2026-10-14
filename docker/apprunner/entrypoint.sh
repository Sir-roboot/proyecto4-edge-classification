#!/bin/sh
# P4-2.1 — Entrypoint del contenedor consolidado de App Runner.
#
# Traduce el secreto gestionado de RDS a DATABASE_URL (sin imprimirla), espera
# a MariaDB, aplica migraciones, ejecuta el seed solo si RUN_DB_SEED=true, y
# arranca backend (interno, :3100) + nginx (frente, :8080).
set -e

echo "[entrypoint] Preparando conexión de base de datos y entorno..."
# `dist/config/prepare-env.cli.js` (mismo módulo puro que cubre
# `backend/tests/prepare-env.test.ts`) imprime líneas `KEY=value`. Se escriben
# en un env-file temporal y se exportan con `set -a`; el archivo NUNCA se
# imprime, así que ni el JSON del secreto ni la URL llegan a los logs.
env_file="$(mktemp)"
node dist/config/prepare-env.cli.js > "${env_file}"

# shellcheck disable=SC1090
set -a
. "${env_file}"
set +a
rm -f "${env_file}"

if [ -z "${DATABASE_URL}" ]; then
  echo "[entrypoint] ERROR: no se pudo determinar DATABASE_URL (revisa DATABASE_URL / DATABASE_CREDENTIALS_JSON)." >&2
  exit 1
fi

if [ -n "${DB_HOST}" ] && [ -n "${DB_PORT}" ]; then
  node /app/docker/wait-for.mjs "${DB_HOST}" "${DB_PORT}"
fi

echo "[entrypoint] Aplicando migraciones..."
node dist/data/db/migrate.js

if [ "${RUN_DB_SEED:-false}" = "true" ]; then
  echo "[entrypoint] Sembrando datos de ejemplo..."
  node dist/data/seed.js
else
  echo "[entrypoint] Seeder omitido (RUN_DB_SEED != true)."
fi

echo "[entrypoint] Arrancando backend interno en :3100..."
PORT=3100 NODE_ENV=production node dist/ui/server.js &
backend_pid=$!

echo "[entrypoint] Sirviendo frontend y proxy /api/ en :8080..."
nginx -g 'daemon off;' &
nginx_pid=$!

# Si cualquiera de los dos procesos muere, se detiene el contenedor (App Runner
# reinicia la instancia) en vez de dejar un front sirviendo un backend muerto.
terminate() {
  kill "${backend_pid}" 2>/dev/null || true
  kill "${nginx_pid}" 2>/dev/null || true
  exit 1
}
trap terminate TERM INT

# Vigila ambos procesos con primitivas POSIX. Si backend o nginx termina, se
# detiene el otro y App Runner puede reemplazar la instancia.
while kill -0 "${backend_pid}" 2>/dev/null && kill -0 "${nginx_pid}" 2>/dev/null; do
  sleep 2
done
terminate

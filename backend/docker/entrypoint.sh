#!/bin/sh
set -e

node docker/wait-for.mjs "${DB_HOST}" "${DB_PORT}"

# Espera al object store solo cuando hay endpoint explícito (MinIO local).
# En AWS no hay endpoint ni host que esperar: S3 real resuelve por región.
if [ -n "${OBJECT_STORE_ENDPOINT_URL}" ]; then
  node docker/wait-for-object-store.mjs "${OBJECT_STORE_ENDPOINT_URL}"
fi

echo "[entrypoint] Aplicando migraciones..."
npm run db:migrate

if [ "${RUN_DB_SEED:-false}" = "true" ]; then
  echo "[entrypoint] Sembrando datos de ejemplo..."
  npm run db:seed
else
  echo "[entrypoint] Seeder omitido (RUN_DB_SEED != true)."
fi

echo "[entrypoint] Arrancando servidor..."
exec node dist/ui/server.js

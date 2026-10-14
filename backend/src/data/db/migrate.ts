import { resolve } from 'node:path';

import { migrate } from 'drizzle-orm/mysql2/migrator';

import { db, pool } from './client.js';

/**
 * Aplica las migraciones versionadas usando solo dependencias de producción.
 *
 * `drizzle-kit` permanece como herramienta de desarrollo para generar nuevas
 * migraciones, pero App Runner no necesita incluirla para aplicar los SQL ya
 * versionados.
 */
async function runMigrations(): Promise<void> {
  const migrationsFolder = resolve(process.env.DRIZZLE_MIGRATIONS_DIR ?? 'src/data/db/migrations');

  try {
    await migrate(db, { migrationsFolder });
    console.log('[migrate] Migraciones aplicadas correctamente.');
  } finally {
    await pool.end();
  }
}

runMigrations().catch((error: unknown) => {
  console.error('[migrate] No se pudieron aplicar las migraciones.', error);
  process.exit(1);
});

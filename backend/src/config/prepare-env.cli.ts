import 'dotenv/config';

import { prepareEnvironment, quoteForPosixShell } from './prepare-env.js';

/**
 * P4-2.1 — CLI del entrypoint de App Runner.
 *
 * Escribe en stdout, en formato `KEY='value'`, las variables que el shell del
 * entrypoint debe exportar (`DATABASE_URL`, `DB_HOST`, `DB_PORT`). El stdout se
 * redirige directamente a un env-file temporal, que el entrypoint lee y borra
 * sin volcarlo a logs.
 *
 * Se ejecuta como `node dist/config/prepare-env.cli.js` desde
 * `docker/apprunner/entrypoint.sh`.
 */
function main(): void {
  const { env } = prepareEnvironment(process.env);

  const databaseUrl = env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('No se pudo determinar DATABASE_URL.');
  }

  const entries: Array<[string, string | undefined]> = [
    ['DATABASE_URL', databaseUrl],
    ['DB_HOST', env.DB_HOST],
    ['DB_PORT', env.DB_PORT],
  ];

  for (const [key, value] of entries) {
    if (typeof value === 'string' && value.length > 0) {
      process.stdout.write(`${key}=${quoteForPosixShell(value)}\n`);
    }
  }
}

main();

import { buildDatabaseUrl } from './database-url.js';

/**
 * P4-2.1 — Preparación del entorno de arranque para App Runner.
 *
 * Módulo **puro respecto a efectos**: `prepareEnvironment` no lee
 * `process.env` por su cuenta ni imprime nada; recibe el entorno como
 * argumento y devuelve el entorno efectivo. La CLI (`node
 * dist/config/prepare-env.js`) es la única que toca stdout, y **nunca** escribe
 * el JSON del secreto ni la `DATABASE_URL` completos (ver requisito: no
 * imprimir secretos).
 *
 * Traduce el JSON del secreto gestionado de RDS (`DATABASE_CREDENTIALS_JSON`,
 * `{username,password,host,port}`) a `DATABASE_URL` —lo que espera
 * `config/env.ts`— usando el constructor puro `buildDatabaseUrl`, y deriva
 * `DB_HOST` / `DB_PORT` para el `wait-for` de la base. Cuando `DATABASE_URL` ya
 * viene definida, no la toca.
 */

export interface PreparedEnvironment {
  /** Entorno efectivo con `DATABASE_URL` y, si aplica, `DB_HOST`/`DB_PORT`. */
  env: NodeJS.ProcessEnv;
  /** Host a esperar antes de migrar (solo si se conoce). */
  dbHost?: string;
  /** Puerto a esperar antes de migrar (solo si se conoce). */
  dbPort?: string;
}

/** Escapa un valor para asignarlo de forma segura en un archivo shell POSIX. */
export function quoteForPosixShell(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

/** Parsea `mysql://user:pass@host:port/db` sin exponer la contraseña. */
function parseDatabaseUrl(databaseUrl: string): { host?: string; port?: string } {
  try {
    const parsed = new URL(databaseUrl);
    return {
      host: parsed.hostname || undefined,
      port: parsed.port || undefined,
    };
  } catch {
    return {};
  }
}

/**
 * Calcula el entorno efectivo para el arranque.
 *
 * Precedencia: si `DATABASE_URL` ya existe, se usa tal cual (p. ej. desarrollo
 * local o un override explícito). Si no, se construye desde
 * `DATABASE_CREDENTIALS_JSON` + `DB_NAME`, y de ahí se derivan `DB_HOST` /
 * `DB_PORT` salvo que ya vengan definidos.
 */
export function prepareEnvironment(env: NodeJS.ProcessEnv): PreparedEnvironment {
  if (env.DATABASE_URL && env.DATABASE_URL.trim() !== '') {
    const { host, port } = parseDatabaseUrl(env.DATABASE_URL);
    const dbHost = env.DB_HOST ?? host;
    const dbPort = env.DB_PORT ?? port;

    return {
      env: {
        ...env,
        DB_HOST: dbHost,
        DB_PORT: dbPort,
      },
      dbHost,
      dbPort,
    };
  }

  const credentialsJson = env.DATABASE_CREDENTIALS_JSON;
  if (!credentialsJson || credentialsJson.trim() === '') {
    throw new Error(
      'Falta DATABASE_URL o DATABASE_CREDENTIALS_JSON: no hay forma de configurar la base de datos.',
    );
  }

  const databaseName = env.DB_NAME;
  if (!databaseName || databaseName.trim() === '') {
    throw new Error('DB_NAME es obligatorio para construir DATABASE_URL desde el secreto de RDS.');
  }

  const databaseUrl = buildDatabaseUrl(credentialsJson, databaseName);
  const { host, port } = parseDatabaseUrl(databaseUrl);

  return {
    env: {
      ...env,
      DATABASE_URL: databaseUrl,
      DB_HOST: env.DB_HOST ?? host,
      DB_PORT: env.DB_PORT ?? port,
    },
    dbHost: env.DB_HOST ?? host,
    dbPort: env.DB_PORT ?? port,
  };
}

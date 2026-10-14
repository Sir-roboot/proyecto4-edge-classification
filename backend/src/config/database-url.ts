/**
 * P4-2.1 — Construcción de la `DATABASE_URL` a partir del secreto gestionado
 * de RDS.
 *
 * Módulo **puro**: no lee `process.env`, no importa `env` ni mysql2, así que
 * se puede verificar sin credenciales reales ni conexión a la base (ver
 * `backend/tests/database-url.test.ts`).
 *
 * En AWS App Runner la contraseña de RDS vive en un secreto gestionado que se
 * entrega como JSON con las claves `username`, `password`, `host` y `port`
 * (formato que usa Secrets Manager para las credenciales rotadas de RDS). El
 * entrypoint del contenedor consolida ese JSON con `DB_NAME` para producir la
 * cadena de conexión que espera el backend (`DATABASE_URL`). Ni el JSON ni la
 * URL se imprimen nunca.
 */

/** Campos que debe traer el JSON del secreto gestionado de RDS. */
export interface RdsCredentials {
  username: string;
  password: string;
  host: string;
  port: number;
}

/** Error de configuración del secreto: mensaje sin valores sensibles. */
export class DatabaseUrlConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DatabaseUrlConfigError';
  }
}

function assertNonBlank(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new DatabaseUrlConfigError(`El secreto de RDS no incluye un "${field}" no vacío.`);
  }

  return value;
}

/**
 * Valida y normaliza el JSON del secreto gestionado de RDS.
 *
 * Acepta el JSON como objeto ya parseado o como cadena; en ambos casos exige
 * `username`, `password`, `host` y `port`. El puerto debe ser un entero en
 * rango válido o una cadena numérica (Secrets Manager lo entrega como número).
 */
export function parseRdsCredentials(raw: unknown): RdsCredentials {
  let value: unknown = raw;

  if (typeof raw === 'string') {
    try {
      value = JSON.parse(raw);
    } catch {
      throw new DatabaseUrlConfigError('El secreto de RDS no es JSON válido.');
    }
  }

  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new DatabaseUrlConfigError('El secreto de RDS debe ser un objeto JSON.');
  }

  const record = value as Record<string, unknown>;
  const username = assertNonBlank(record.username, 'username');
  const password = assertNonBlank(record.password, 'password');
  const host = assertNonBlank(record.host, 'host');

  const rawPort = record.port;
  const port =
    typeof rawPort === 'number'
      ? rawPort
      : typeof rawPort === 'string'
        ? Number(rawPort)
        : Number.NaN;

  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new DatabaseUrlConfigError('El secreto de RDS no incluye un "port" válido.');
  }

  return { username, password, host, port };
}

/** Codifica un componente de la URL (usuario, contraseña, base). */
function encodeUrlComponent(value: string): string {
  return encodeURIComponent(value);
}

/**
 * Construye la `DATABASE_URL` para Drizzle/mysql2 a partir del JSON del
 * secreto gestionado de RDS y del nombre de la base.
 *
 * Codifica usuario y contraseña (`encodeURIComponent`) para que caracteres
 * como `@`, `:` o `/` no rompan la URL. El host no se codifica: es un nombre
 * DNS o una IP. Lanza sin incluir jamás la contraseña en el mensaje.
 */
export function buildDatabaseUrl(credentialsJson: unknown, databaseName: string): string {
  const credentials = parseRdsCredentials(credentialsJson);
  const database = assertNonBlank(databaseName, 'DB_NAME');

  return (
    `mysql://${encodeUrlComponent(credentials.username)}:${encodeUrlComponent(credentials.password)}` +
    `@${credentials.host}:${credentials.port}/${encodeUrlComponent(database)}`
  );
}

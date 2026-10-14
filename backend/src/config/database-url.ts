/**
 * P4-2.1 — Construcción de la `DATABASE_URL` a partir del secreto gestionado
 * de RDS.
 *
 * Módulo **puro**: no lee `process.env`, no importa `env` ni mysql2, así que
 * se puede verificar sin credenciales reales ni conexión a la base (ver
 * `backend/tests/database-url.test.ts`).
 *
 * En AWS ECS Fargate la contraseña de RDS vive en un secreto gestionado por el
 * propio RDS (`manage_master_user_password = true`), que solo contiene
 * `username` y `password` — no `host`/`port`. El host y el puerto son datos no
 * secretos y llegan al contenedor como variables de Terraform (`DB_HOST` /
 * `DB_PORT`). Este módulo acepta ambos formatos: secretos mínimos
 * (`username`/`password`) con host/puerto de fallback explícito, y secretos
 * enriquecidos que ya incluyen `host`/`port`. Ni el JSON ni la URL se imprimen
 * nunca.
 */

/** Campos que puede traer el JSON del secreto gestionado de RDS. */
export interface RdsCredentials {
  username: string;
  password: string;
  /** Presente solo en secretos enriquecidos; si falta se usa el fallback. */
  host?: string;
  /** Presente solo en secretos enriquecidos; si falta se usa el fallback. */
  port?: number;
}

/** Host/puerto no secretos que actúan como fallback cuando el secreto no los trae. */
export interface DatabaseEndpoint {
  host?: string;
  port?: number | string;
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

function parsePort(rawPort: unknown): number {
  const port =
    typeof rawPort === 'number'
      ? rawPort
      : typeof rawPort === 'string'
        ? Number(rawPort)
        : Number.NaN;

  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new DatabaseUrlConfigError('El secreto de RDS no incluye un "port" válido.');
  }

  return port;
}

/**
 * Valida y normaliza el JSON del secreto gestionado de RDS.
 *
 * Acepta el JSON como objeto ya parseado o como cadena; en ambos casos exige
 * `username` y `password`. `host` y `port` son opcionales: cuando están
 * presentes se validan y se devuelven; cuando faltan, `buildDatabaseUrl` los
 * resuelve con el fallback explícito (`DB_HOST`/`DB_PORT`).
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

  const credentials: RdsCredentials = { username, password };

  if (record.host !== undefined) {
    credentials.host = assertNonBlank(record.host, 'host');
  }

  if (record.port !== undefined) {
    credentials.port = parsePort(record.port);
  }

  return credentials;
}

/** Resuelve el host: el endpoint explícito manda; si falta, usa el secreto enriquecido. */
function resolveHost(credentials: RdsCredentials, endpoint?: DatabaseEndpoint): string {
  const explicitHost = endpoint?.host;
  if (typeof explicitHost === 'string' && explicitHost.trim().length > 0) {
    return explicitHost;
  }

  if (credentials.host !== undefined) {
    return credentials.host;
  }

  throw new DatabaseUrlConfigError(
    'No hay host para la base de datos: el secreto de RDS no lo incluye y no se definió DB_HOST.',
  );
}

/** Resuelve el puerto: el endpoint explícito manda; si falta, usa el secreto enriquecido. */
function resolvePort(credentials: RdsCredentials, endpoint?: DatabaseEndpoint): number {
  const explicitPort = endpoint?.port;
  const port =
    typeof explicitPort === 'number'
      ? explicitPort
      : typeof explicitPort === 'string'
        ? Number(explicitPort)
        : Number.NaN;

  if (Number.isInteger(port) && port > 0 && port <= 65535) {
    return port;
  }

  if (explicitPort === undefined && credentials.port !== undefined) {
    return credentials.port;
  }

  throw new DatabaseUrlConfigError(
    'No hay port para la base de datos: el secreto de RDS no lo incluye y no se definió un DB_PORT válido.',
  );
}

/** Codifica un componente de la URL (usuario, contraseña, base). */
function encodeUrlComponent(value: string): string {
  return encodeURIComponent(value);
}

/**
 * Construye la `DATABASE_URL` para Drizzle/mysql2 a partir del JSON del
 * secreto gestionado de RDS y del nombre de la base.
 *
 * El endpoint explícito (`DB_HOST`/`DB_PORT`) tiene prioridad porque representa
 * la instancia declarada por Terraform. Si no se proporciona, se conservan los
 * `host`/`port` de un secreto enriquecido por compatibilidad.
 *
 * Codifica usuario y contraseña (`encodeURIComponent`) para que caracteres
 * como `@`, `:` o `/` no rompan la URL. El host no se codifica: es un nombre
 * DNS o una IP. Lanza sin incluir jamás la contraseña en el mensaje.
 */
export function buildDatabaseUrl(
  credentialsJson: unknown,
  databaseName: string,
  endpoint?: DatabaseEndpoint,
): string {
  const credentials = parseRdsCredentials(credentialsJson);
  const database = assertNonBlank(databaseName, 'DB_NAME');
  const host = resolveHost(credentials, endpoint);
  const port = resolvePort(credentials, endpoint);

  return (
    `mysql://${encodeUrlComponent(credentials.username)}:${encodeUrlComponent(credentials.password)}` +
    `@${host}:${port}/${encodeUrlComponent(database)}`
  );
}

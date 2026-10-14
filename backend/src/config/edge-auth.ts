import { timingSafeEqual } from 'node:crypto';

/**
 * P4-2.1 — Autenticación de la ingesta edge.
 *
 * Módulo **puro**: no lee `process.env`, no importa `env` ni Express, así que
 * se puede verificar sin arrancar la app ni abrir conexiones (ver
 * `backend/tests/edge-auth.test.ts`).
 *
 * El contrato (`docs/EDGE_CAPTURE_CONTRACT.md`) fija que el dispositivo envía
 * el token compartido como `Authorization: Bearer <token>`. La comparación es
 * en **tiempo constante** para no filtrar el token por diferencias de tiempo,
 * y el resultado se expone como un motivo tipado (nunca como el token).
 */

/** Longitud mínima del `EDGE_INGEST_TOKEN` exigida por la configuración. */
export const EDGE_INGEST_TOKEN_MIN_LENGTH = 32;

/** Esquema aceptado para el encabezado `Authorization`. */
const BEARER_SCHEME = 'Bearer';

/**
 * Resultado de evaluar el encabezado `Authorization` contra el token
 * esperado. `ok` es la única fuente de verdad: la capa UI responde 401 para
 * cualquier otro valor, sin inspeccionar mensajes.
 */
export type EdgeIngestAuthResult =
  | { ok: true }
  | { ok: false; reason: 'missing-header' | 'wrong-scheme' | 'invalid-token' };

/** Comprueba si un valor es una cadena no vacía (ni solo espacios). */
function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

/**
 * Compara dos tokens en tiempo constante.
 *
 * `crypto.timingSafeEqual` exige buffers de la misma longitud, así que la
 * propia comprobación de longitud se hace antes; longitudes distintas nunca
 * pueden ser iguales y no hace falta comparar bytes en ese caso.
 */
export function tokensMatch(expected: string, received: string): boolean {
  const expectedBuffer = Buffer.from(expected, 'utf8');
  const receivedBuffer = Buffer.from(received, 'utf8');

  if (expectedBuffer.length !== receivedBuffer.length) {
    return false;
  }

  return timingSafeEqual(expectedBuffer, receivedBuffer);
}

/**
 * Extrae el token de un encabezado `Authorization: Bearer <token>`.
 *
 * El esquema no distingue mayúsculas de minúsculas (RFC 7235); el token sí.
 * Devuelve `null` cuando el encabezado no existe, no es una cadena, no usa el
 * esquema `Bearer` o no trae token.
 */
export function parseBearerToken(header: unknown): string | null {
  if (!isNonEmptyString(header)) {
    return null;
  }

  const separatorIndex = header.indexOf(' ');
  if (separatorIndex === -1) {
    return null;
  }

  const scheme = header.slice(0, separatorIndex);
  if (scheme.toLowerCase() !== BEARER_SCHEME.toLowerCase()) {
    return null;
  }

  const token = header.slice(separatorIndex + 1).trim();
  return token.length > 0 ? token : null;
}

/**
 * Autentica el encabezado `Authorization` contra el token esperado.
 *
 * Nunca registra ni devuelve el token: solo el motivo de rechazo.
 */
export function authenticateEdgeIngest(
  authorizationHeader: unknown,
  expectedToken: string,
): EdgeIngestAuthResult {
  if (!isNonEmptyString(authorizationHeader)) {
    return { ok: false, reason: 'missing-header' };
  }

  const token = parseBearerToken(authorizationHeader);
  if (token === null) {
    return { ok: false, reason: 'wrong-scheme' };
  }

  if (!tokensMatch(expectedToken, token)) {
    return { ok: false, reason: 'invalid-token' };
  }

  return { ok: true };
}

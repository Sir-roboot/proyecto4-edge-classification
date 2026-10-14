import { describe, expect, it } from 'vitest';

import {
  authenticateEdgeIngest,
  EDGE_INGEST_TOKEN_MIN_LENGTH,
  parseBearerToken,
  tokensMatch,
} from '../src/config/edge-auth.js';

/**
 * P4-2.1 — Autenticación de la ingesta edge.
 *
 * Pruebas unitarias puras: no leen `process.env`, no arrancan Express y no
 * tocan MariaDB ni el object store. Cubren token válido, ausente, esquema
 * incorrecto, token incorrecto y longitudes distintas (el caso que
 * `crypto.timingSafeEqual` rechaza si no se maneja antes).
 */

// Token ficticio, no secreto, de longitud >= 32 (mismo valor de ejemplo que
// usan docker-compose.yml / .env.example / portal-ci.yml).
const VALID_TOKEN = 'local-dev-edge-ingest-token-000000000001';
const OTHER_TOKEN = 'local-dev-edge-ingest-token-000000000002';

describe('EDGE_INGEST_TOKEN_MIN_LENGTH', () => {
  it('exige al menos 32 caracteres', () => {
    expect(EDGE_INGEST_TOKEN_MIN_LENGTH).toBe(32);
    expect(VALID_TOKEN.length).toBeGreaterThanOrEqual(EDGE_INGEST_TOKEN_MIN_LENGTH);
  });
});

describe('tokensMatch', () => {
  it('es true para tokens idénticos', () => {
    expect(tokensMatch(VALID_TOKEN, VALID_TOKEN)).toBe(true);
  });

  it('es false para tokens distintos de la misma longitud', () => {
    expect(tokensMatch(VALID_TOKEN, OTHER_TOKEN)).toBe(false);
  });

  it('es false para longitudes distintas (no llama timingSafeEqual)', () => {
    expect(tokensMatch(VALID_TOKEN, VALID_TOKEN.slice(0, 10))).toBe(false);
    expect(tokensMatch('short', 'a-much-longer-token-value')).toBe(false);
  });

  it('es false cuando el token recibido está vacío', () => {
    expect(tokensMatch(VALID_TOKEN, '')).toBe(false);
  });
});

describe('parseBearerToken', () => {
  it('extrae el token de un encabezado Bearer', () => {
    expect(parseBearerToken(`Bearer ${VALID_TOKEN}`)).toBe(VALID_TOKEN);
  });

  it('acepta el esquema sin distinguir mayúsculas (el token sí distingue)', () => {
    expect(parseBearerToken(`bearer ${VALID_TOKEN}`)).toBe(VALID_TOKEN);
    expect(parseBearerToken(`BEARER ${VALID_TOKEN}`)).toBe(VALID_TOKEN);
  });

  it('devuelve null sin encabezado o con encabezados no válidos', () => {
    expect(parseBearerToken(undefined)).toBeNull();
    expect(parseBearerToken('')).toBeNull();
    expect(parseBearerToken('   ')).toBeNull();
    expect(parseBearerToken(42)).toBeNull();
    expect(parseBearerToken(VALID_TOKEN)).toBeNull();
    expect(parseBearerToken(`Basic ${VALID_TOKEN}`)).toBeNull();
    expect(parseBearerToken('Bearer')).toBeNull();
    expect(parseBearerToken('Bearer   ')).toBeNull();
  });

  it('no recorta el token más allá de espacios sobrantes alrededor', () => {
    expect(parseBearerToken(`Bearer   ${VALID_TOKEN}  `)).toBe(VALID_TOKEN);
  });
});

describe('authenticateEdgeIngest', () => {
  it('acepta un token válido', () => {
    expect(authenticateEdgeIngest(`Bearer ${VALID_TOKEN}`, VALID_TOKEN)).toEqual({ ok: true });
  });

  it('rechaza encabezado ausente con reason "missing-header"', () => {
    expect(authenticateEdgeIngest(undefined, VALID_TOKEN)).toEqual({
      ok: false,
      reason: 'missing-header',
    });
    expect(authenticateEdgeIngest('', VALID_TOKEN)).toEqual({
      ok: false,
      reason: 'missing-header',
    });
  });

  it('rechaza esquema incorrecto con reason "wrong-scheme"', () => {
    expect(authenticateEdgeIngest(`Basic ${VALID_TOKEN}`, VALID_TOKEN)).toEqual({
      ok: false,
      reason: 'wrong-scheme',
    });
    expect(authenticateEdgeIngest(VALID_TOKEN, VALID_TOKEN)).toEqual({
      ok: false,
      reason: 'wrong-scheme',
    });
  });

  it('rechaza token incorrecto con reason "invalid-token"', () => {
    expect(authenticateEdgeIngest(`Bearer ${OTHER_TOKEN}`, VALID_TOKEN)).toEqual({
      ok: false,
      reason: 'invalid-token',
    });
  });

  it('rechaza token de longitud distinta con reason "invalid-token"', () => {
    expect(authenticateEdgeIngest('Bearer short', VALID_TOKEN)).toEqual({
      ok: false,
      reason: 'invalid-token',
    });
    expect(authenticateEdgeIngest(`Bearer ${VALID_TOKEN}extra`, VALID_TOKEN)).toEqual({
      ok: false,
      reason: 'invalid-token',
    });
  });

  it('no devuelve nunca el token esperado ni el recibido', () => {
    const failure = authenticateEdgeIngest(`Bearer ${OTHER_TOKEN}`, VALID_TOKEN);
    expect(JSON.stringify(failure)).not.toContain(VALID_TOKEN);
    expect(JSON.stringify(failure)).not.toContain(OTHER_TOKEN);
  });
});

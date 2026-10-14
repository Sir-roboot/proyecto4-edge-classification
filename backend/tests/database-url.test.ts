import { describe, expect, it } from 'vitest';

import {
  buildDatabaseUrl,
  DatabaseUrlConfigError,
  parseRdsCredentials,
} from '../src/config/database-url.js';

/**
 * P4-2.1 — `DATABASE_URL` desde el secreto gestionado de RDS.
 *
 * Pruebas unitarias puras: no hay credenciales reales, no se lee
 * `process.env` y no se abre ninguna conexión. El JSON de ejemplo es
 * ficticio y no corresponde a ninguna base de datos real.
 */

const SECRET_JSON = JSON.stringify({
  username: 'app_user',
  password: 'not-a-real-password',
  host: 'dataset-quality-dev.example.rds.amazonaws.com',
  port: 3306,
});

describe('parseRdsCredentials', () => {
  it('acepta el JSON como cadena', () => {
    expect(parseRdsCredentials(SECRET_JSON)).toEqual({
      username: 'app_user',
      password: 'not-a-real-password',
      host: 'dataset-quality-dev.example.rds.amazonaws.com',
      port: 3306,
    });
  });

  it('acepta el JSON ya parseado', () => {
    expect(parseRdsCredentials(JSON.parse(SECRET_JSON)).host).toBe(
      'dataset-quality-dev.example.rds.amazonaws.com',
    );
  });

  it('convierte el puerto en cadena numérica a número', () => {
    const credentials = parseRdsCredentials({ ...JSON.parse(SECRET_JSON), port: '3306' });
    expect(credentials.port).toBe(3306);
  });

  it('acepta un secreto gestionado que solo trae username y password', () => {
    expect(parseRdsCredentials({ username: 'app_user', password: 'not-a-real-password' })).toEqual({
      username: 'app_user',
      password: 'not-a-real-password',
    });
  });

  it('rechaza JSON inválido sin exponer el contenido', () => {
    expect(() => parseRdsCredentials('{no-es-json')).toThrow(DatabaseUrlConfigError);
  });

  it('rechaza campos faltantes o vacíos', () => {
    const base = JSON.parse(SECRET_JSON) as Record<string, unknown>;

    expect(() => parseRdsCredentials({ ...base, username: undefined })).toThrow(
      DatabaseUrlConfigError,
    );
    expect(() => parseRdsCredentials({ ...base, password: '' })).toThrow(DatabaseUrlConfigError);
    expect(() => parseRdsCredentials({ ...base, host: '   ' })).toThrow(DatabaseUrlConfigError);
  });

  it('rechaza un puerto no válido', () => {
    const base = JSON.parse(SECRET_JSON) as Record<string, unknown>;

    expect(() => parseRdsCredentials({ ...base, port: 'no-numero' })).toThrow(
      DatabaseUrlConfigError,
    );
    expect(() => parseRdsCredentials({ ...base, port: 0 })).toThrow(DatabaseUrlConfigError);
    expect(() => parseRdsCredentials({ ...base, port: 70000 })).toThrow(DatabaseUrlConfigError);
  });

  it('rechaza valores que no son objetos', () => {
    expect(() => parseRdsCredentials(null)).toThrow(DatabaseUrlConfigError);
    expect(() => parseRdsCredentials([1, 2, 3])).toThrow(DatabaseUrlConfigError);
  });
});

describe('buildDatabaseUrl', () => {
  it('construye mysql://usuario:password@host:puerto/base', () => {
    expect(buildDatabaseUrl(SECRET_JSON, 'image_repo')).toBe(
      'mysql://app_user:not-a-real-password@dataset-quality-dev.example.rds.amazonaws.com:3306/image_repo',
    );
  });

  it('codifica usuario, contraseña y nombre de la base', () => {
    const url = buildDatabaseUrl(
      JSON.stringify({
        username: 'user@corp',
        password: 'p@ss:w/rd#1',
        host: 'db.internal',
        port: 3306,
      }),
      'my db',
    );

    expect(url).toBe('mysql://user%40corp:p%40ss%3Aw%2Frd%231@db.internal:3306/my%20db');
  });

  it('no codifica el host (nombre DNS o IP)', () => {
    const url = buildDatabaseUrl(SECRET_JSON, 'image_repo');
    expect(url).toContain('@dataset-quality-dev.example.rds.amazonaws.com:3306/');
  });

  it('usa host/port de fallback cuando el secreto solo trae username/password', () => {
    const url = buildDatabaseUrl(
      JSON.stringify({ username: 'app_user', password: 'p@ss word' }),
      'image_repo',
      { host: 'db.internal', port: 3306 },
    );

    expect(url).toBe('mysql://app_user:p%40ss%20word@db.internal:3306/image_repo');
  });

  it('prefiere el endpoint explícito sobre un secreto enriquecido', () => {
    const url = buildDatabaseUrl(SECRET_JSON, 'image_repo', { host: 'fallback-host', port: 9999 });

    expect(url).toBe('mysql://app_user:not-a-real-password@fallback-host:9999/image_repo');
  });

  it('lanza sin host ni port y no expone la contraseña', () => {
    try {
      buildDatabaseUrl(
        JSON.stringify({ username: 'app_user', password: 'super-secret-value' }),
        'image_repo',
      );
      expect.unreachable('debía lanzar');
    } catch (error) {
      expect(error).toBeInstanceOf(DatabaseUrlConfigError);
      expect((error as Error).message).not.toContain('super-secret-value');
    }
  });

  it('exige un DB_NAME no vacío', () => {
    expect(() => buildDatabaseUrl(SECRET_JSON, '')).toThrow(DatabaseUrlConfigError);
    expect(() => buildDatabaseUrl(SECRET_JSON, '   ')).toThrow(DatabaseUrlConfigError);
  });

  it('propaga el error del secreto inválido sin incluir la contraseña', () => {
    try {
      buildDatabaseUrl(JSON.stringify({ username: 'u', password: '1234567890', host: 'h' }), 'db');
      expect.unreachable('debía lanzar');
    } catch (error) {
      expect(error).toBeInstanceOf(DatabaseUrlConfigError);
      expect((error as Error).message).not.toContain('1234567890');
    }
  });
});

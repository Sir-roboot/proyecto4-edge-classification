import { describe, expect, it } from 'vitest';

import { prepareEnvironment, quoteForPosixShell } from '../src/config/prepare-env.js';

/**
 * P4-2.1 — Preparación del entorno de App Runner.
 *
 * Pruebas unitarias puras: `prepareEnvironment` recibe el entorno como
 * argumento, así que no se toca `process.env`. No hay secretos reales: el JSON
 * y la contraseña son ficticios.
 */

const SECRET_JSON = JSON.stringify({
  username: 'app_user',
  password: 'not-a-real-password',
  host: 'db.internal.example.com',
  port: 3306,
});

describe('prepareEnvironment', () => {
  it('construye DATABASE_URL desde DATABASE_CREDENTIALS_JSON + DB_NAME', () => {
    const { env, dbHost, dbPort } = prepareEnvironment({
      DATABASE_CREDENTIALS_JSON: SECRET_JSON,
      DB_NAME: 'image_repo',
    });

    expect(env.DATABASE_URL).toBe(
      'mysql://app_user:not-a-real-password@db.internal.example.com:3306/image_repo',
    );
    expect(dbHost).toBe('db.internal.example.com');
    expect(dbPort).toBe('3306');
    expect(env.DB_HOST).toBe('db.internal.example.com');
    expect(env.DB_PORT).toBe('3306');
  });

  it('construye DATABASE_URL con DB_HOST/DB_PORT no secretos cuando el secreto solo trae username/password', () => {
    const { env, dbHost, dbPort } = prepareEnvironment({
      DATABASE_CREDENTIALS_JSON: JSON.stringify({
        username: 'app_user',
        password: 'not-a-real-password',
      }),
      DB_NAME: 'image_repo',
      DB_HOST: 'db.internal.example.com',
      DB_PORT: '3306',
    });

    expect(env.DATABASE_URL).toBe(
      'mysql://app_user:not-a-real-password@db.internal.example.com:3306/image_repo',
    );
    expect(dbHost).toBe('db.internal.example.com');
    expect(dbPort).toBe('3306');
    expect(env.DB_HOST).toBe('db.internal.example.com');
    expect(env.DB_PORT).toBe('3306');
  });

  it('mantiene compatible un secreto enriquecido con host/port sin DB_HOST/DB_PORT', () => {
    const { env, dbHost, dbPort } = prepareEnvironment({
      DATABASE_CREDENTIALS_JSON: SECRET_JSON,
      DB_NAME: 'image_repo',
    });

    expect(env.DATABASE_URL).toBe(
      'mysql://app_user:not-a-real-password@db.internal.example.com:3306/image_repo',
    );
    expect(dbHost).toBe('db.internal.example.com');
    expect(dbPort).toBe('3306');
  });

  it('mantiene DATABASE_URL y wait-for alineados con el endpoint explícito', () => {
    const { env, dbHost, dbPort } = prepareEnvironment({
      DATABASE_CREDENTIALS_JSON: SECRET_JSON,
      DB_NAME: 'image_repo',
      DB_HOST: 'fallback.internal.example.com',
      DB_PORT: '9999',
    });

    expect(env.DATABASE_URL).toBe(
      'mysql://app_user:not-a-real-password@fallback.internal.example.com:9999/image_repo',
    );
    expect(dbHost).toBe('fallback.internal.example.com');
    expect(dbPort).toBe('9999');
    expect(env.DB_HOST).toBe('fallback.internal.example.com');
    expect(env.DB_PORT).toBe('9999');
  });

  it('respeta DATABASE_URL ya definida y no toca el secreto', () => {
    const existing = 'mysql://root:password@localhost:3306/image_repo';
    const { env, dbHost, dbPort } = prepareEnvironment({ DATABASE_URL: existing });

    expect(env.DATABASE_URL).toBe(existing);
    expect(dbHost).toBe('localhost');
    expect(dbPort).toBe('3306');
    expect(env.DB_HOST).toBe('localhost');
    expect(env.DB_PORT).toBe('3306');
  });

  it('respeta DB_HOST/DB_PORT explícitos por encima de los derivados', () => {
    const { env, dbHost, dbPort } = prepareEnvironment({
      DATABASE_CREDENTIALS_JSON: SECRET_JSON,
      DB_NAME: 'image_repo',
      DB_HOST: 'override-host',
      DB_PORT: '9999',
    });

    expect(dbHost).toBe('override-host');
    expect(dbPort).toBe('9999');
    expect(env.DATABASE_URL).toContain('@override-host:9999/');
    expect(env.DB_HOST).toBe('override-host');
    expect(env.DB_PORT).toBe('9999');
  });

  it('lanza si no hay DATABASE_URL ni DATABASE_CREDENTIALS_JSON', () => {
    expect(() => prepareEnvironment({ DB_NAME: 'image_repo' })).toThrow(
      /DATABASE_URL o DATABASE_CREDENTIALS_JSON/,
    );
  });

  it('lanza si falta DB_NAME al construir desde el secreto', () => {
    expect(() => prepareEnvironment({ DATABASE_CREDENTIALS_JSON: SECRET_JSON })).toThrow(/DB_NAME/);
  });

  it('no incluye la contraseña en el mensaje de error', () => {
    try {
      prepareEnvironment({
        DATABASE_CREDENTIALS_JSON: JSON.stringify({
          username: 'u',
          password: 'super-secret-value',
          host: 'h',
        }),
        DB_NAME: 'db',
      });
      expect.unreachable('debía lanzar');
    } catch (error) {
      expect((error as Error).message).not.toContain('super-secret-value');
    }
  });

  it('lanza sin host/port (secreto mínimo y sin DB_HOST/DB_PORT) sin exponer la contraseña', () => {
    try {
      prepareEnvironment({
        DATABASE_CREDENTIALS_JSON: JSON.stringify({
          username: 'app_user',
          password: 'super-secret-value',
        }),
        DB_NAME: 'image_repo',
      });
      expect.unreachable('debía lanzar');
    } catch (error) {
      expect((error as Error).message).not.toContain('super-secret-value');
    }
  });
});

describe('quoteForPosixShell', () => {
  it('protege espacios, paréntesis y comillas simples al cargar el env-file', () => {
    expect(quoteForPosixShell("mysql://user:p'a(ss)@db:3306/image repo")).toBe(
      "'mysql://user:p'\\''a(ss)@db:3306/image repo'",
    );
  });
});

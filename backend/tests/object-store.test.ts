import { describe, expect, it } from 'vitest';

import { buildObjectStoreClientConfig } from '../src/data/storage/object-store.config.js';

/**
 * P4-2.1 — Configuración del cliente del object store.
 *
 * Pruebas unitarias puras sobre `buildObjectStoreClientConfig`: no leen
 * `process.env`, no construyen un S3Client y **nunca** abren conexión a AWS ni
 * a MinIO. Verifican la diferencia entre el modo MinIO local (endpoint,
 * forcePathStyle y credenciales explícitas) y el modo AWS (sin endpoint ni
 * credenciales, dejando actuar a la cadena por defecto del SDK).
 */

describe('buildObjectStoreClientConfig', () => {
  describe('modo MinIO local (endpoint + credenciales explícitas)', () => {
    it('usa el endpoint, forcePathStyle y las credenciales indicadas', () => {
      const config = buildObjectStoreClientConfig({
        region: 'us-east-1',
        endpointUrl: 'http://localhost:9000',
        forcePathStyle: true,
        accessKey: 'minioadmin',
        secretKey: 'minioadmin',
      });

      expect(config.region).toBe('us-east-1');
      expect(config.endpoint).toBe('http://localhost:9000');
      expect(config.forcePathStyle).toBe(true);
      expect(config.credentials).toEqual({
        accessKeyId: 'minioadmin',
        secretAccessKey: 'minioadmin',
      });
    });

    it('respeta forcePathStyle=false cuando se pide explícitamente', () => {
      const config = buildObjectStoreClientConfig({
        region: 'us-east-1',
        endpointUrl: 'https://minio.example.com',
        forcePathStyle: false,
        accessKey: 'key',
        secretKey: 'secret',
      });

      expect(config.forcePathStyle).toBe(false);
    });
  });

  describe('modo AWS (S3 real con cadena por defecto)', () => {
    it('omite endpoint, forcePathStyle y credentials', () => {
      const config = buildObjectStoreClientConfig({
        region: 'us-east-1',
        forcePathStyle: false,
      });

      expect(config.region).toBe('us-east-1');
      // Sin endpoint: el SDK usa el S3 real de la región.
      expect(config.endpoint).toBeUndefined();
      // Sin credenciales: el SDK usa instance role / cadena por defecto.
      expect(config.credentials).toBeUndefined();
      expect('forcePathStyle' in config).toBe(false);
    });

    it('permite elegir otra región sin agregar configuración ajena al cliente', () => {
      const config = buildObjectStoreClientConfig({
        region: 'us-west-2',
        forcePathStyle: false,
      });

      expect(config.region).toBe('us-west-2');
      expect(config.endpoint).toBeUndefined();
    });
  });

  describe('credenciales incompletas', () => {
    it('falla si solo hay access key', () => {
      expect(() =>
        buildObjectStoreClientConfig({
          region: 'us-east-1',
          endpointUrl: 'http://localhost:9000',
          forcePathStyle: true,
          accessKey: 'minioadmin',
        }),
      ).toThrow(/OBJECT_STORE_ACCESS_KEY.*OBJECT_STORE_SECRET_KEY/);
    });

    it('falla si solo hay secret key', () => {
      expect(() =>
        buildObjectStoreClientConfig({
          region: 'us-east-1',
          endpointUrl: 'http://localhost:9000',
          forcePathStyle: true,
          secretKey: 'minioadmin',
        }),
      ).toThrow(/OBJECT_STORE_ACCESS_KEY.*OBJECT_STORE_SECRET_KEY/);
    });

    it('trata una cadena vacía como ausente y falla si la otra sí viene', () => {
      expect(() =>
        buildObjectStoreClientConfig({
          region: 'us-east-1',
          accessKey: '',
          secretKey: 'minioadmin',
        }),
      ).toThrow(/OBJECT_STORE_ACCESS_KEY.*OBJECT_STORE_SECRET_KEY/);
    });

    it('no falla cuando ninguna credencial está definida', () => {
      const config = buildObjectStoreClientConfig({
        region: 'us-east-1',
        forcePathStyle: false,
      });

      expect(config.credentials).toBeUndefined();
    });
  });
});

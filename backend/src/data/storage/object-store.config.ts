import type { S3ClientConfig } from '@aws-sdk/client-s3';

/**
 * Configuración de conexión a un almacén de objetos S3-compatible.
 *
 * Módulo **puro**: no lee `process.env` ni importa `env`, para poder construir
 * y verificar la configuración sin arrancar la app ni abrir conexiones (ver
 * `backend/tests/object-store.test.ts`).
 */
export interface ObjectStoreConfig {
  region: string;
  /** Ausente → S3 real de AWS; presente → MinIO u otro S3-compatible. */
  endpointUrl?: string;
  /** Solo aplica con endpoint (MinIO). */
  forcePathStyle: boolean;
  accessKey?: string;
  secretKey?: string;
}

/**
 * Construye la configuración del cliente S3 a partir de valores explícitos.
 *
 * Reglas:
 *  - Sin credenciales → se omite la sección `credentials` y el SDK resuelve
 *    la cadena por defecto (instance role de App Runner, env, ~/.aws, SSO).
 *  - Sin endpoint → modo AWS (S3 real, style virtual-host).
 *  - Con endpoint → modo MinIO local (endpoint explícito, credenciales).
 *
 * Lanza si las credenciales vienen incompletas: nunca se acepta una sola.
 */
export function buildObjectStoreClientConfig(config: ObjectStoreConfig): S3ClientConfig {
  const hasAccessKey = config.accessKey !== undefined && config.accessKey !== '';
  const hasSecretKey = config.secretKey !== undefined && config.secretKey !== '';

  if (hasAccessKey !== hasSecretKey) {
    throw new Error(
      'OBJECT_STORE_ACCESS_KEY y OBJECT_STORE_SECRET_KEY deben configurarse juntas o ninguna.',
    );
  }

  const clientConfig: S3ClientConfig = {
    region: config.region,
  };

  // Sin endpoint, el SDK habla con el S3 real de la región y resuelve el
  // endpoint por sí mismo.
  if (config.endpointUrl) {
    clientConfig.endpoint = config.endpointUrl;
    clientConfig.forcePathStyle = config.forcePathStyle;
  }

  // Con credenciales explícitas (MinIO). Sin ellas, `clientConfig.credentials`
  // se deja sin definir para que el SDK use su cadena por defecto.
  if (hasAccessKey && hasSecretKey) {
    clientConfig.credentials = {
      accessKeyId: config.accessKey as string,
      secretAccessKey: config.secretKey as string,
    };
  }

  return clientConfig;
}

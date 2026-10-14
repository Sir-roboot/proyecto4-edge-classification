import { S3Client } from '@aws-sdk/client-s3';

import { env } from '../../config/env.js';
import { buildObjectStoreClientConfig } from './object-store.config.js';

// Re-export: la construcción pura de la configuración vive en
// `object-store.config.ts` (sin dependencia de `env`) para poder probarla en
// aislamiento. Aquí solo se instancia el cliente real desde el entorno.
export type { ObjectStoreConfig } from './object-store.config.js';
export { buildObjectStoreClientConfig } from './object-store.config.js';

/**
 * Cliente S3 único para todo el almacenamiento de objetos del backend.
 *
 * Local: MinIO con endpoint y credenciales explícitas.
 * AWS (App Runner): S3 real sin endpoint ni claves estáticas — el SDK usa la
 * cadena de credenciales/instance role.
 */
export const s3Client = new S3Client(
  buildObjectStoreClientConfig({
    region: env.OBJECT_STORE_REGION,
    endpointUrl: env.OBJECT_STORE_ENDPOINT_URL,
    forcePathStyle: env.OBJECT_STORE_FORCE_PATH_STYLE,
    accessKey: env.OBJECT_STORE_ACCESS_KEY,
    secretKey: env.OBJECT_STORE_SECRET_KEY,
  }),
);

// Bucket donde se almacenan las imágenes.
export const objectStoreBucket = env.OBJECT_STORE_BUCKET;

// `true` cuando hay endpoint explícito (MinIO local u otro S3-compatible).
// En AWS es `false`: no se puede asumir permiso para crear buckets.
export const isLocalObjectStoreEndpoint = env.OBJECT_STORE_ENDPOINT_URL !== undefined;

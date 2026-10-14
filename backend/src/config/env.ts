import 'dotenv/config';
import { z } from 'zod';

/**
 * Valida las variables de entorno usadas por la aplicación.
 */
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

  PORT: z.coerce.number().int().positive().default(3000),

  DATABASE_URL: z.string().min(1),

  // ── Object storage (S3-compatible)
  //
  // El backend usa un único cliente S3 (@aws-sdk/client-s3) para todo el
  // almacenamiento de objetos:
  //  - Local: MinIO, con endpoint explícito, path-style y credenciales.
  //  - AWS (App Runner): S3 real, sin endpoint ni credenciales estáticas —
  //    el SDK resuelve región y credenciales desde la cadena por defecto
  //    (instance role de App Runner / variables del entorno / ~/.aws).
  //
  // Nunca se aceptan secretos dentro del código: solo llegan por entorno.
  OBJECT_STORE_BUCKET: z.string().min(3),

  // Región de firma del cliente. Obligatoria incluso contra MinIO (el SDK
  // exige una región para firmar), aunque el endpoint apunte al MinIO local.
  OBJECT_STORE_REGION: z.string().min(1).default('us-east-1'),

  // Solo para MinIO local u otro S3-compatible. Ausente → S3 real de AWS.
  OBJECT_STORE_ENDPOINT_URL: z.string().url().optional(),

  // Solo tiene efecto con endpoint (MinIO): fuerza URLs de estilo
  // `http://host/bucket/key` en vez del estilo virtual-host. En AWS se omite.
  OBJECT_STORE_FORCE_PATH_STYLE: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),

  OBJECT_STORE_ACCESS_KEY: z.string().min(1).optional(),

  OBJECT_STORE_SECRET_KEY: z.string().min(1).optional(),

  MAX_UPLOAD_SIZE_BYTES: z.coerce
    .number()
    .int()
    .positive()
    .default(5 * 1024 * 1024),

  // Servicio Python interno. La URL nunca se recibe desde una solicitud HTTP:
  // se fija al desplegar el backend para evitar convertir la inferencia en un
  // proxy hacia destinos elegidos por el cliente.
  CLASSIFIER_INFERENCE_URL: z.string().url().default('http://localhost:8300'),

  CLASSIFIER_INFERENCE_TIMEOUT_MS: z.coerce.number().int().positive().default(30_000),

  // T3-2.3: servicio `trainer` (pipeline/src/dataset_quality/classifier/jobs_app.py), que
  // valida con las reglas del entrenador, revisa la compuerta y entrena de verdad.
  TRAINER_URL: z.string().url().default('http://localhost:8400'),

  // Evaluation: reportes commiteados del clasificador y raíz de `pipeline/`, contra la que se
  // resuelven las rutas de los recortes de test (`data/processed/crops/...`).
  CLASSIFIER_REPORTS_DIR: z.string().min(1).default('../pipeline/reports/classifier'),
  CLASSIFIER_DATA_ROOT: z.string().min(1).default('../pipeline'),

  // Archivo compartido que fija el modelo elegido desde la página Models.
  SELECTED_MODEL_PATH: z
    .string()
    .min(1)
    .default('../pipeline/reports/classifier/selected-model.json'),

  // SPEC-PIPE-001 — dónde vive la salida REAL de la pipeline de Data Quality
  // (quality.json, splits.json, versions.json) y el `quality.yaml` que esa
  // misma pipeline lee en cada corrida.
  //
  // Corrección de revisión (Mau, PR de APP-07): esto apuntaba antes a
  // `contracts/` (repo root) por defecto -- pero `pipeline/dvc.yaml` escribe
  // esos tres archivos en `pipeline/data/interim/` (stages quality_gate,
  // split, release), nunca en `contracts/`, que sigue siendo el mock
  // versionado de APP-01/APP-05. Con el default viejo, correr `dvc repro`
  // nunca cambiaba lo que mostraba la Web App. `PIPELINE_OUTPUT_DIR` apunta
  // ahora al directorio que la pipeline realmente escribe.
  //
  // En Docker Compose, ambos se montan como volumen (ver docker-compose.yml);
  // en desarrollo local (`npm run dev`, fuera de Docker) los defaults apuntan
  // a las rutas reales del monorepo, relativas a este paquete (`backend/`).
  PIPELINE_OUTPUT_DIR: z.string().min(1).default('../pipeline/data/interim'),
  QUALITY_POLICY_PATH: z.string().min(1).default('../pipeline/quality.yaml'),
});

/**
 * Las credenciales del object store son opcionales (en AWS se usa la cadena
 * por defecto del SDK), pero **nunca** se acepta una sola de las dos: o se
 * configuran ambas (MinIO local) o ninguna (S3 con instance role). Un par
 * incompleto es siempre un error de configuración, no un fallback silencioso.
 */
const envSchemaWithObjectStoreRules = envSchema.refine(
  (values) =>
    (values.OBJECT_STORE_ACCESS_KEY === undefined) ===
    (values.OBJECT_STORE_SECRET_KEY === undefined),
  {
    message:
      'OBJECT_STORE_ACCESS_KEY y OBJECT_STORE_SECRET_KEY deben configurarse juntas o ninguna (en AWS usa la cadena de credenciales por defecto).',
    path: ['OBJECT_STORE_ACCESS_KEY'],
  },
);

/**
 * Variables ya validadas y tipadas.
 * Si alguna configuración requerida falta, la aplicación falla al iniciar.
 */
export const env = envSchemaWithObjectStoreRules.parse(process.env);

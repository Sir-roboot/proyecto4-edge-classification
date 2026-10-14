import { relations } from 'drizzle-orm';
import {
  bigint,
  boolean,
  double,
  index,
  int,
  mysqlEnum,
  mysqlTable,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/mysql-core';

/**
 * Guarda los metadatos de las imágenes.
 * El archivo real se almacena en MinIO mediante storageKey.
 */

export const images = mysqlTable(
  'images',
  {
    // ID único de la imagen.
    id: bigint('id', {
      mode: 'number',
      unsigned: true,
    })
      .autoincrement()
      .primaryKey(),

    // Nombre original del archivo.
    filename: varchar('filename', {
      length: 255,
    }).notNull(),

    // Ruta o key del archivo dentro de MinIO.
    storageKey: varchar('storage_key', {
      length: 512,
    }).notNull(),

    // Tipo de archivo, por ejemplo image/jpeg.
    mimeType: varchar('mime_type', {
      length: 100,
    }).notNull(),

    // Dimensiones de la imagen en píxeles.
    width: int('width', {
      unsigned: true,
    }).notNull(),

    height: int('height', {
      unsigned: true,
    }).notNull(),

    // Tamaño del archivo en bytes.
    sizeBytes: bigint('size_bytes', {
      mode: 'number',
      unsigned: true,
    }).notNull(),

    // Estado actual del proceso de anotación.
    status: mysqlEnum('status', ['pending', 'in_progress', 'completed'])
      .notNull()
      .default('pending'),

    // Fecha de creación del registro.
    createdAt: timestamp('created_at').notNull().defaultNow(),

    // Fecha de la última actualización.
    updatedAt: timestamp('updated_at').notNull().defaultNow().onUpdateNow(),
  },

  // Índices para mejorar búsquedas y filtros.
  (table) => [
    uniqueIndex('images_storage_key_unique').on(table.storageKey),
    index('images_status_idx').on(table.status),
    index('images_created_at_idx').on(table.createdAt),
    index('images_status_created_at_idx').on(table.status, table.createdAt),
  ],
);
/**
 * categories
 *
 * Categorías/clases usadas para anotar imágenes (equivalente a
 * `categories` en el formato COCO).
 */

export const categories = mysqlTable(
  'categories',
  {
    // ID único de la categoría.
    id: bigint('id', {
      mode: 'number',
      unsigned: true,
    })
      .autoincrement()
      .primaryKey(),

    // Nombre de la categoría, por ejemplo person o car.
    name: varchar('name', {
      length: 150,
    }).notNull(),

    // Color usado para mostrar la bounding box en la interfaz (hexadecimal).
    color: varchar('color', {
      length: 7,
    }).notNull(),

    // Fecha de creación de la categoría.
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },

  // Evita que existan dos categorías con el mismo nombre.
  (table) => [uniqueIndex('categories_name_unique').on(table.name)],
);

/**
 * annotations
 *
 * Bounding box asociado a una imagen y una categoría. Los campos de bbox
 * siguen la convención de COCO (x, y = esquina superior izquierda;
 * width/height = dimensiones de la caja) para que la futura fase de
 * exportación a COCO JSON no requiera cambios de schema.
 */
export const annotations = mysqlTable(
  'annotations',
  {
    // ID único de la anotación.
    id: bigint('id', {
      mode: 'number',
      unsigned: true,
    })
      .autoincrement()
      .primaryKey(),

    // Imagen a la que pertenece la bounding box.
    imageId: bigint('image_id', {
      mode: 'number',
      unsigned: true,
    })
      .notNull()
      .references(() => images.id, {
        onDelete: 'cascade',
      }),

    // Categoría asignada a la bounding box.
    categoryId: bigint('category_id', {
      mode: 'number',
      unsigned: true,
    })
      .notNull()
      .references(() => categories.id, {
        onDelete: 'restrict',
      }),

    // Posición y tamaño de la caja en píxeles.
    bboxX: double('bbox_x').notNull(),
    bboxY: double('bbox_y').notNull(),
    bboxWidth: double('bbox_width').notNull(),
    bboxHeight: double('bbox_height').notNull(),

    // Área de la bounding box para la exportación COCO.
    area: double('area').notNull(),

    // Campo requerido por el formato COCO.
    isCrowd: boolean('iscrowd').notNull().default(false),

    // Fecha de creación de la anotación.
    createdAt: timestamp('created_at').notNull().defaultNow(),

    // Fecha de la última modificación.
    updatedAt: timestamp('updated_at').notNull().defaultNow().onUpdateNow(),
  },

  // Índices para buscar anotaciones por imagen y categoría.
  (table) => [
    index('annotations_image_id_idx').on(table.imageId),
    index('annotations_category_id_idx').on(table.categoryId),
    index('annotations_image_category_idx').on(table.imageId, table.categoryId),
  ],
);

/**
 * Relación: una imagen puede tener muchas anotaciones.
 */
export const imagesRelations = relations(images, ({ many }) => ({
  annotations: many(annotations),
}));

/**
 * Relación: una categoría puede pertenecer a muchas anotaciones.
 */
export const categoriesRelations = relations(categories, ({ many }) => ({
  annotations: many(annotations),
}));

/**
 * Cada anotación pertenece a una imagen y a una categoría.
 */
export const annotationsRelations = relations(annotations, ({ one }) => ({
  image: one(images, {
    fields: [annotations.imageId],
    references: [images.id],
  }),

  category: one(categories, {
    fields: [annotations.categoryId],
    references: [categories.id],
  }),
}));

export const trainingJobs = mysqlTable(
  'training_jobs',
  {
    id: bigint('id', {
      mode: 'number',
      unsigned: true,
    })
      .autoincrement()
      .primaryKey(),

    status: mysqlEnum('status', ['queued', 'running', 'completed', 'failed'])
      .notNull()
      .default('queued'),

    optimizer: varchar('optimizer', {
      length: 50,
    }).notNull(),

    batchSize: int('batch_size', {
      unsigned: true,
    }).notNull(),

    epochs: int('epochs', {
      unsigned: true,
    }).notNull(),

    learningRate: double('learning_rate').notNull(),

    imageSize: int('image_size', {
      unsigned: true,
    }).notNull(),

    dropout: double('dropout').notNull(),

    // JSON list of hidden-layer widths of the head, e.g. "[256]" or "[]" (linear head).
    hiddenLayers: varchar('hidden_layers', {
      length: 100,
    })
      .notNull()
      .default('[256]'),

    // The real job in the `trainer` service and the MLflow run it produced.
    trainerJobId: varchar('trainer_job_id', {
      length: 64,
    }),

    mlflowRunId: varchar('mlflow_run_id', {
      length: 64,
    }),

    // Provenance the trainer checked before starting (release, quality gate, manifest).
    datasetVersion: varchar('dataset_version', {
      length: 50,
    }),

    qualityGateStatus: varchar('quality_gate_status', {
      length: 20,
    }),

    manifestSha256: varchar('manifest_sha256', {
      length: 64,
    }),

    currentEpoch: int('current_epoch', {
      unsigned: true,
    })
      .notNull()
      .default(0),

    progress: double('progress').notNull().default(0),

    // TEXT: un VARCHAR(16000) en utf8mb4 supera el límite de 65 535 bytes por fila.
    logs: text('logs').notNull().default(''),

    errorMessage: varchar('error_message', {
      length: 2000,
    }),

    createdAt: timestamp('created_at').notNull().defaultNow(),

    startedAt: timestamp('started_at'),

    finishedAt: timestamp('finished_at'),
  },

  (table) => [
    index('training_jobs_status_idx').on(table.status),
    index('training_jobs_created_at_idx').on(table.createdAt),
  ],
);

/**
 * edge_captures
 *
 * Eventos de captura enviados por los dispositivos edge. Cada fila = una
 * fotografía y una predicción calculada en el dispositivo. El contrato está
 * congelado en `docs/EDGE_CAPTURE_CONTRACT.md`; `capture_id` es la clave de
 * idempotencia (única) y `image_key` la referencia del objeto en S3/MinIO.
 */
export const edgeCaptures = mysqlTable(
  'edge_captures',
  {
    // Clave de idempotencia generada por el edge. Nunca cambia entre reintentos.
    captureId: varchar('capture_id', {
      length: 36,
    })
      .notNull()
      .primaryKey(),

    // Se conserva literalmente para no perder zona ni milisegundos. Esos
    // datos forman parte de la comparación idempotente del evento.
    capturedAt: varchar('captured_at', {
      length: 40,
    }).notNull(),

    // Identificador estable y configurable del dispositivo.
    deviceId: varchar('device_id', {
      length: 128,
    }).notNull(),

    // Versión y hash de la variante optimizada en ejecución.
    modelVersion: varchar('model_version', {
      length: 256,
    }).notNull(),

    // Clase congelada del Proyecto 3: car | person.
    predictedClass: mysqlEnum('predicted_class', ['car', 'person']).notNull(),

    // Confianza calculada localmente, en [0, 1].
    confidence: double('confidence').notNull(),

    // SHA-256 (hex minúsculas) de los mismos bytes de la imagen enviada.
    imageSha256: varchar('image_sha256', {
      length: 64,
    }).notNull(),

    // Región de recorte aplicada (nullable: se omite cuando no hay recorte).
    // Se guarda como JSON string serializado (x, y, width, height).
    crop: varchar('crop', {
      length: 512,
    }),

    // Referencia del objeto persistido en S3/MinIO.
    imageKey: varchar('image_key', {
      length: 512,
    }).notNull(),

    // Tipo MIME de la imagen: image/jpeg | image/png.
    mimeType: varchar('mime_type', {
      length: 100,
    }).notNull(),

    // Tamaño en bytes de la imagen recibida.
    sizeBytes: bigint('size_bytes', {
      mode: 'number',
      unsigned: true,
    }).notNull(),

    // Fecha en que el backend persistió el evento (asignada por el servidor).
    receivedAt: timestamp('received_at').notNull().defaultNow(),
  },

  (table) => [
    index('edge_captures_received_at_idx').on(table.receivedAt),
    index('edge_captures_device_id_idx').on(table.deviceId),
  ],
);

/**
 * Tipos TypeScript generados automáticamente desde el esquema.
 */
export type Image = typeof images.$inferSelect;
export type NewImage = typeof images.$inferInsert;

export type Category = typeof categories.$inferSelect;
export type NewCategory = typeof categories.$inferInsert;

export type Annotation = typeof annotations.$inferSelect;
export type NewAnnotation = typeof annotations.$inferInsert;

export type TrainingJob = typeof trainingJobs.$inferSelect;
export type NewTrainingJob = typeof trainingJobs.$inferInsert;

export type EdgeCapture = typeof edgeCaptures.$inferSelect;
export type NewEdgeCapture = typeof edgeCaptures.$inferInsert;

import {
  deleteImageObject,
  getImageObjectStream,
  type EdgeCapture,
  findEdgeCaptureById,
  insertEdgeCapture,
  listEdgeCaptures,
  type NewEdgeCapture,
  uploadImageObject,
} from '../data/index.js';
import {
  computeImageSha256,
  type EdgeCaptureCrop,
  type EdgeCaptureMetadata,
  validateEdgeCaptureImage,
  validateEdgeCaptureMetadata,
} from './edge-capture.validation.js';
import {
  EdgeCaptureConflictError,
  EdgeCapturePayloadTooLargeError,
  EdgeCaptureUnprocessableEntityError,
  EdgeCaptureUnsupportedMediaTypeError,
} from './errors.js';

/**
 * P4-2.1 — Servicio de ingesta de capturas edge.
 *
 * Idempotencia anclada en `capture_id` (contrato, sección 6):
 *  - `capture_id` nuevo → sube el objeto, registra la fila y devuelve
 *    `created = true` (HTTP 201).
 *  - Reintento con **todos** los metadatos y el hash idénticos → `created =
 *    false`, sin escribir nada (HTTP 200).
 *  - Mismo `capture_id` con contenido distinto (hash o metadatos) → error
 *    tipado 409.
 *
 * La key del objeto es determinista:
 * `edge-captures/<capture_id>/<image_sha256>.<ext>` donde `ext` es `jpg` o
 * `png` según el MIME.
 */

export interface EdgeCaptureUploadInput {
  /** Metadata cruda (objeto ya parseado desde la parte JSON del multipart). */
  metadata: unknown;
  /** Bytes reales de la parte `image`. */
  image: {
    mimeType: string;
    buffer: Buffer;
  };
}

export interface EdgeCaptureUploadResult {
  /** `true` si se persistió una captura nueva; `false` en reintento idempotente. */
  created: boolean;
  capture: EdgeCapture;
}

export interface EdgeCaptureDependencies {
  findEdgeCaptureById: (captureId: string) => Promise<EdgeCapture | null>;
  insertEdgeCapture: (capture: NewEdgeCapture) => Promise<EdgeCapture>;
  /** Sube el objeto de la imagen; devuelve `void` (la key se calcula aquí). */
  putImageObject: (key: string, buffer: Buffer, mimeType: string) => Promise<void>;
  /** Elimina un objeto subido (para limpiar si el insert falla). */
  deleteImageObject: (key: string) => Promise<void>;
}

/** Extensión del objeto según el MIME validado. */
function extensionForMime(mimeType: 'image/jpeg' | 'image/png'): string {
  return mimeType === 'image/png' ? 'png' : 'jpg';
}

/** Key determinista del objeto persistido. */
export function buildEdgeCaptureImageKey(
  captureId: string,
  imageSha256: string,
  mimeType: 'image/jpeg' | 'image/png',
): string {
  return `edge-captures/${captureId}/${imageSha256}.${extensionForMime(mimeType)}`;
}

/** Serializa el crop (o `null`) para almacenarlo en la columna `crop`. */
function serializeCrop(crop: EdgeCaptureMetadata['crop']): string | null {
  return crop ? JSON.stringify(crop) : null;
}

/** Respuesta de ingesta, con la forma del contrato (sección 4). */
export interface EdgeCaptureResponse {
  capture_id: string;
  captured_at: string;
  device_id: string;
  model_version: string;
  predicted_class: 'car' | 'person';
  confidence: number;
  image_sha256: string;
  crop?: EdgeCaptureCrop;
  image_key: string;
  /** Asignado por el servidor al persistir (RFC 3339 con zona horaria). */
  received_at: string;
}

/**
 * Convierte una fila persistida en la respuesta del contrato: eco de los
 * campos del evento más `received_at` e `image_key` (asignados por el
 * servidor).
 */
export function toEdgeCaptureResponse(row: EdgeCapture): EdgeCaptureResponse {
  const crop = row.crop ? (JSON.parse(row.crop) as EdgeCaptureCrop) : undefined;

  return {
    capture_id: row.captureId,
    captured_at: row.capturedAt,
    device_id: row.deviceId,
    model_version: row.modelVersion,
    predicted_class: row.predictedClass,
    confidence: row.confidence,
    image_sha256: row.imageSha256,
    ...(crop ? { crop } : {}),
    image_key: row.imageKey,
    received_at: row.receivedAt.toISOString(),
  };
}

/**
 * Compara la metadata de un reintento con la fila persistida para decidir si
 * el evento es estrictamente idéntico. Cualquier diferencia → conflicto.
 */
function isIdenticalRetry(existing: EdgeCapture, metadata: EdgeCaptureMetadata): boolean {
  return (
    existing.imageSha256 === metadata.image_sha256 &&
    existing.capturedAt === metadata.captured_at &&
    existing.deviceId === metadata.device_id &&
    existing.modelVersion === metadata.model_version &&
    existing.predictedClass === metadata.predicted_class &&
    existing.confidence === metadata.confidence &&
    existing.crop === serializeCrop(metadata.crop)
  );
}

export function createEdgeCaptureService(dependencies: EdgeCaptureDependencies) {
  async function ingest(input: EdgeCaptureUploadInput): Promise<EdgeCaptureUploadResult> {
    // 1. Validar metadata (forma + contrato). Metadata inválida → 422.
    const metadataResult = validateEdgeCaptureMetadata(input.metadata);
    if (!metadataResult.success) {
      throw new EdgeCaptureUnprocessableEntityError(
        `La metadata no cumple el contrato: ${metadataResult.issues
          .map((issue) => `${issue.path}: ${issue.message}`)
          .join('; ')}`,
      );
    }
    const metadata = metadataResult.data;

    // 2. Validar MIME y tamaño de la imagen antes de tocar el almacenamiento.
    const imageResult = validateEdgeCaptureImage({
      mimeType: input.image.mimeType,
      buffer: input.image.buffer,
    });
    if (!imageResult.success) {
      // El motivo distingue 415 (MIME) de 413 (tamaño) sin comparar mensajes.
      if (imageResult.reason === 'payload-too-large') {
        throw new EdgeCapturePayloadTooLargeError(imageResult.message);
      }
      throw new EdgeCaptureUnsupportedMediaTypeError(imageResult.message);
    }

    // 3. Recalcular el SHA-256 sobre los bytes reales y cotejarlo con el declarado.
    const recomputedSha256 = computeImageSha256(input.image.buffer);
    if (recomputedSha256 !== metadata.image_sha256) {
      throw new EdgeCaptureUnprocessableEntityError(
        'El image_sha256 declarado no coincide con los bytes de la imagen.',
      );
    }

    // 4. Idempotencia: si el capture_id ya existe, decidir 200 vs 409.
    const existing = await dependencies.findEdgeCaptureById(metadata.capture_id);
    if (existing) {
      if (isIdenticalRetry(existing, metadata)) {
        return { created: false, capture: existing };
      }

      throw new EdgeCaptureConflictError('El capture_id ya existe con contenido diferente.');
    }

    // 5. Captura nueva: subir el objeto con key determinista y registrar la fila.
    const imageKey = buildEdgeCaptureImageKey(
      metadata.capture_id,
      metadata.image_sha256,
      imageResult.data.mimeType,
    );

    await dependencies.putImageObject(imageKey, input.image.buffer, imageResult.data.mimeType);

    try {
      const capture = await dependencies.insertEdgeCapture({
        captureId: metadata.capture_id,
        capturedAt: metadata.captured_at,
        deviceId: metadata.device_id,
        modelVersion: metadata.model_version,
        predictedClass: metadata.predicted_class,
        confidence: metadata.confidence,
        imageSha256: metadata.image_sha256,
        crop: serializeCrop(metadata.crop),
        imageKey,
        mimeType: imageResult.data.mimeType,
        sizeBytes: imageResult.data.sizeBytes,
      });

      return { created: true, capture };
    } catch (error) {
      // Dos solicitudes pueden observar al mismo tiempo que el ID no existe.
      // Si otra ganó la carrera, no se debe borrar su objeto determinista.
      const racedCapture = await dependencies
        .findEdgeCaptureById(metadata.capture_id)
        .catch(() => null);

      if (racedCapture) {
        if (racedCapture.imageKey !== imageKey) {
          await dependencies.deleteImageObject(imageKey).catch(() => undefined);
        }

        if (isIdenticalRetry(racedCapture, metadata)) {
          return { created: false, capture: racedCapture };
        }

        throw new EdgeCaptureConflictError(
          'El capture_id fue persistido concurrentemente con contenido diferente.',
        );
      }

      await dependencies.deleteImageObject(imageKey).catch(() => undefined);
      throw error;
    }
  }

  return { ingest };
}

/** Instancia de producción con las dependencias reales de la capa Data. */
const edgeCaptureService = createEdgeCaptureService({
  findEdgeCaptureById,
  insertEdgeCapture,
  putImageObject: uploadImageObject,
  deleteImageObject,
});

export const ingestEdgeCapture = edgeCaptureService.ingest;

/**
 * Consulta las capturas edge persistidas, de la más reciente a la más antigua.
 */
export async function getEdgeCaptureList(
  limit = 100,
  offset = 0,
): Promise<EdgeCaptureResponse[]> {
  const rows = await listEdgeCaptures(limit, offset);
  return rows.map(toEdgeCaptureResponse);
}

/**
 * Obtiene la imagen de una captura por su identificador.
 * Devuelve null si la captura no existe.
 */
export async function getEdgeCaptureImage(captureId: string): Promise<{
  stream: Awaited<ReturnType<typeof getImageObjectStream>>;
  mimeType: string;
} | null> {
  const capture = await findEdgeCaptureById(captureId);

  if (!capture) {
    return null;
  }

  const stream = await getImageObjectStream(capture.imageKey);

  return {
    stream,
    mimeType: capture.mimeType,
  };
}

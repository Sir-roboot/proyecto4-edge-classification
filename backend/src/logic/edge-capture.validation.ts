import { createHash } from 'node:crypto';

import { z } from 'zod';

/**
 * P4-2.1 — Validación del evento de captura edge.
 *
 * Reglas congeladas en `docs/EDGE_CAPTURE_CONTRACT.md` (secciones 2 y 3):
 *
 *  - `metadata` no puede exceder 4096 bytes (4 KiB) de JSON; más grande es
 *    un `400` (se valida en el transporte, no aquí).
 *  - `capture_id` es un UUID (RFC 4122).
 *  - `captured_at` es RFC 3339 **con zona horaria** (`Z` o `±hh:mm`).
 *  - `device_id` y `model_version` son no vacíos (ni solo espacios).
 *  - `predicted_class` es una de las clases congeladas: `car` o `person`.
 *  - `confidence` está en `[0, 1]`.
 *  - `image_sha256` es hex en minúsculas, exactamente 64 caracteres.
 *  - `crop` (opcional) tiene `x >= 0`, `y >= 0`, `width > 0`, `height > 0`.
 *  - El schema es estricto (`additionalProperties: false`): claves extra
 *    (incluidas `received_at` / `image_key`) invalidan el documento.
 *  - La imagen debe ser `image/jpeg` o `image/png` y no exceder 10 MiB.
 *  - El `image_sha256` declarado debe coincidir con el SHA-256 recalculado
 *    sobre los bytes reales de la imagen.
 */

/** Hash de los mismos bytes de la imagen, en hexadecimal minúsculas. */
const sha256Schema = z
  .string()
  .regex(/^[0-9a-f]{64}$/, 'image_sha256 debe ser un SHA-256 hex en minúsculas de 64 caracteres.');

const rfc3339WithZonePattern =
  /^(\d{4})-(\d{2})-(\d{2})[Tt](\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:[Zz]|[+-](\d{2}):(\d{2}))$/;

function isValidRfc3339WithZone(value: string): boolean {
  const match = rfc3339WithZonePattern.exec(value);
  if (!match) {
    return false;
  }

  const [
    ,
    yearText,
    monthText,
    dayText,
    hourText,
    minuteText,
    secondText,
    offsetHourText,
    offsetMinuteText,
  ] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);
  const offsetHour = offsetHourText === undefined ? 0 : Number(offsetHourText);
  const offsetMinute = offsetMinuteText === undefined ? 0 : Number(offsetMinuteText);

  if (
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > new Date(Date.UTC(year, month, 0)).getUTCDate() ||
    hour > 23 ||
    minute > 59 ||
    second > 59 ||
    offsetHour > 23 ||
    offsetMinute > 59
  ) {
    return false;
  }

  return !Number.isNaN(Date.parse(value));
}

/** RFC 3339 con desplazamiento de zona horaria obligatorio (`Z` o `±hh:mm`). */
const rfc3339WithZoneSchema = z
  .string()
  .regex(
    rfc3339WithZonePattern,
    'captured_at debe ser una fecha RFC 3339 con zona horaria (Z o ±hh:mm).',
  )
  .refine(isValidRfc3339WithZone, {
    message: 'captured_at no es una fecha válida.',
  });

/** UUID RFC 4122 (acepta cualquier versión/variante del formato canónico). */
const uuidSchema = z
  .string()
  .regex(
    /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/,
    'capture_id debe ser un UUID.',
  );

/** Cadena no vacía ni compuesta solo de espacios, con tope de longitud. */
function nonBlankString(maxLength: number) {
  return z
    .string()
    .max(maxLength, `El campo no puede exceder ${maxLength} caracteres.`)
    .refine((value) => value.trim().length > 0, {
      message: 'El campo no puede estar vacío ni contener solo espacios.',
    });
}

/** Región de recorte aplicada, en píxeles de la imagen enviada. */
export const edgeCaptureCropSchema = z
  .object({
    x: z.number().int().nonnegative({ message: 'crop.x debe ser un entero >= 0.' }),
    y: z.number().int().nonnegative({ message: 'crop.y debe ser un entero >= 0.' }),
    width: z.number().int().positive({ message: 'crop.width debe ser un entero > 0.' }),
    height: z.number().int().positive({ message: 'crop.height debe ser un entero > 0.' }),
  })
  .strict();

export type EdgeCaptureCrop = z.infer<typeof edgeCaptureCropSchema>;

/** Metadata de entrada del multipart (`metadata`), estricta y sin claves extra. */
export const edgeCaptureMetadataSchema = z
  .object({
    capture_id: uuidSchema,
    captured_at: rfc3339WithZoneSchema,
    device_id: nonBlankString(128),
    model_version: nonBlankString(256),
    predicted_class: z.enum(['car', 'person'], {
      message: 'predicted_class debe ser "car" o "person".',
    }),
    confidence: z
      .number()
      .min(0, { message: 'confidence debe ser >= 0.' })
      .max(1, { message: 'confidence debe ser <= 1.' }),
    image_sha256: sha256Schema,
    crop: edgeCaptureCropSchema.optional(),
  })
  .strict();

export type EdgeCaptureMetadata = z.infer<typeof edgeCaptureMetadataSchema>;

/** Tipos MIME permitidos para la parte `image`. */
export const edgeCaptureMimeSchema = z.enum(['image/jpeg', 'image/png'], {
  message: 'La imagen debe ser image/jpeg o image/png.',
});

/** Tamaño máximo de la imagen: 10 MiB = 10 * 1024 * 1024 bytes. */
export const EDGE_CAPTURE_MAX_IMAGE_BYTES = 10 * 1024 * 1024;

/** Tamaño máximo de la parte `metadata`: 4 KiB. */
export const EDGE_CAPTURE_MAX_METADATA_BYTES = 4096;

/**
 * Calcula el SHA-256 (hex minúsculas) de un buffer.
 */
export function computeImageSha256(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex');
}

export interface EdgeCaptureValidationIssue {
  path: string;
  message: string;
}

export type EdgeCaptureValidationResult<T> =
  | { success: true; data: T }
  | { success: false; issues: EdgeCaptureValidationIssue[] };

/** Motivo por el que se rechazó la imagen, sin depender del texto del mensaje. */
export type EdgeCaptureImageRejection = 'unsupported-media-type' | 'payload-too-large';

export type EdgeCaptureImageValidationResult =
  | { success: true; data: { mimeType: 'image/jpeg' | 'image/png'; sizeBytes: number } }
  | { success: false; reason: EdgeCaptureImageRejection; message: string };

function toResult<T>(
  result: { success: true; data: T } | { success: false; error: z.ZodError },
): EdgeCaptureValidationResult<T> {
  if (result.success) {
    return { success: true, data: result.data };
  }

  return {
    success: false,
    issues: result.error.issues.map((issue) => ({
      path: issue.path.join('.'),
      message: issue.message,
    })),
  };
}

/**
 * Valida la metadata cruda (objeto ya parseado desde JSON) contra el
 * contrato. No lanza: devuelve el resultado para que el servicio decida el
 * error tipado.
 */
export function validateEdgeCaptureMetadata(
  input: unknown,
): EdgeCaptureValidationResult<EdgeCaptureMetadata> {
  return toResult(edgeCaptureMetadataSchema.safeParse(input));
}

/**
 * Valida que el `image_sha256` declarado coincida con el SHA-256 recalculado
 * sobre los bytes reales de la imagen.
 */
export function validateImageSha256(declared: string, buffer: Buffer): boolean {
  return computeImageSha256(buffer) === declared;
}

/**
 * Valida el MIME y el tamaño de la imagen (`image/jpeg` o `image/png`,
 * máximo 10 MiB). El tamaño se evalúa sobre los bytes reales.
 */
export function validateEdgeCaptureImage(input: {
  mimeType: string;
  buffer: Buffer;
}): EdgeCaptureImageValidationResult {
  const mime = edgeCaptureMimeSchema.safeParse(input.mimeType);
  if (!mime.success) {
    return {
      success: false,
      reason: 'unsupported-media-type',
      message: 'La imagen debe ser image/jpeg o image/png.',
    };
  }

  const sizeBytes = input.buffer.length;
  if (sizeBytes > EDGE_CAPTURE_MAX_IMAGE_BYTES) {
    return {
      success: false,
      reason: 'payload-too-large',
      message: 'La imagen excede el tamaño máximo de 10 MiB.',
    };
  }

  return { success: true, data: { mimeType: mime.data, sizeBytes } };
}

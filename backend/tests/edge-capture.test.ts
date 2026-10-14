import { createHash } from 'node:crypto';

import { beforeEach, describe, expect, it, vi } from 'vitest';

// Evita construir el pool de MariaDB y el cliente de MinIO al importar el
// servicio: estas pruebas inyectan dependencias simuladas.
vi.mock('../src/data/index.js', () => ({
  findEdgeCaptureById: vi.fn(),
  insertEdgeCapture: vi.fn(),
  uploadImageObject: vi.fn(),
  deleteImageObject: vi.fn(),
}));

import type { EdgeCapture, NewEdgeCapture } from '../src/data/index.js';
import {
  buildEdgeCaptureImageKey,
  createEdgeCaptureService,
  type EdgeCaptureDependencies,
  toEdgeCaptureResponse,
} from '../src/logic/edge-capture.service.js';
import {
  EdgeCaptureConflictError,
  EdgeCapturePayloadTooLargeError,
  EdgeCaptureUnprocessableEntityError,
  EdgeCaptureUnsupportedMediaTypeError,
} from '../src/logic/errors.js';

/**
 * P4-2.1 — Ingesta de capturas edge.
 *
 * Pruebas de la capa Logic con dependencias simuladas (repositorio y
 * almacenamiento): no tocan MariaDB ni MinIO. Verifican la idempotencia por
 * `capture_id`, el conflicto por contenido distinto, la validación de hash,
 * clase/confianza, MIME y tamaño, y la key determinista.
 */

const CAPTURE_ID = '6f5c1f7e-1b2a-4c3d-9e4f-0a1b2c3d4e5f';

function pngBuffer(seed = 'edge-capture'): Buffer {
  // PNG mínimo y válido (el servicio no lo decodifica; solo cuenta/hashea bytes).
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.from(seed),
  ]);
}

function sha256(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex');
}

function buildMetadata(overrides: Record<string, unknown> = {}) {
  return {
    capture_id: CAPTURE_ID,
    captured_at: '2026-10-13T14:05:37.482-06:00',
    device_id: 'rpi-edge-01',
    model_version: 'onnx-int8-1.0.0+sha256:abc',
    predicted_class: 'person',
    confidence: 0.9734,
    image_sha256: sha256(pngBuffer()),
    ...overrides,
  };
}

/** Fila tal como la devolvería el repositorio tras persistir. */
function rowFromMetadata(
  metadata: ReturnType<typeof buildMetadata>,
  imageKey: string,
): EdgeCapture {
  return {
    captureId: metadata.capture_id as string,
    capturedAt: metadata.captured_at as string,
    deviceId: metadata.device_id as string,
    modelVersion: metadata.model_version as string,
    predictedClass: metadata.predicted_class as 'car' | 'person',
    confidence: metadata.confidence as number,
    imageSha256: metadata.image_sha256 as string,
    crop: null,
    imageKey,
    mimeType: 'image/png',
    sizeBytes: pngBuffer().length,
    receivedAt: new Date('2026-10-13T20:05:38.000Z'),
  };
}

function dependencies(overrides: Partial<EdgeCaptureDependencies> = {}): EdgeCaptureDependencies {
  return {
    findEdgeCaptureById: vi.fn().mockResolvedValue(null),
    insertEdgeCapture: vi.fn().mockImplementation(async (capture: NewEdgeCapture) =>
      rowFromMetadata(
        buildMetadata({
          capture_id: capture.captureId,
          captured_at: capture.capturedAt,
          device_id: capture.deviceId,
          model_version: capture.modelVersion,
          predicted_class: capture.predictedClass,
          confidence: capture.confidence,
          image_sha256: capture.imageSha256,
        }),
        capture.imageKey,
      ),
    ),
    putImageObject: vi.fn().mockResolvedValue(undefined),
    deleteImageObject: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function uploadInput(metadata: unknown = buildMetadata(), buffer = pngBuffer()) {
  return {
    metadata,
    image: { mimeType: 'image/png', buffer },
  };
}

describe('P4-2.1 — ingesta de capturas edge', () => {
  beforeEach(() => vi.clearAllMocks());

  it('captura nueva: sube el objeto, registra y devuelve created=true', async () => {
    const deps = dependencies();
    const service = createEdgeCaptureService(deps);

    const result = await service.ingest(uploadInput());

    expect(result.created).toBe(true);
    const expectedKey = buildEdgeCaptureImageKey(CAPTURE_ID, sha256(pngBuffer()), 'image/png');
    expect(deps.putImageObject).toHaveBeenCalledWith(expectedKey, expect.any(Buffer), 'image/png');
    expect(deps.insertEdgeCapture).toHaveBeenCalledOnce();
    expect(result.capture.captureId).toBe(CAPTURE_ID);
  });

  it('reintento con metadatos y hash idénticos: created=false y sin escritura', async () => {
    const metadata = buildMetadata();
    const imageKey = buildEdgeCaptureImageKey(CAPTURE_ID, metadata.image_sha256, 'image/png');
    const deps = dependencies({
      findEdgeCaptureById: vi.fn().mockResolvedValue(rowFromMetadata(metadata, imageKey)),
    });
    const service = createEdgeCaptureService(deps);

    const result = await service.ingest(uploadInput(metadata));

    expect(result.created).toBe(false);
    expect(result.capture.captureId).toBe(CAPTURE_ID);
    expect(deps.insertEdgeCapture).not.toHaveBeenCalled();
    expect(deps.putImageObject).not.toHaveBeenCalled();
  });

  it('resuelve una carrera idempotente sin borrar el objeto compartido', async () => {
    const metadata = buildMetadata();
    const imageKey = buildEdgeCaptureImageKey(CAPTURE_ID, metadata.image_sha256, 'image/png');
    const existing = rowFromMetadata(metadata, imageKey);
    const deps = dependencies({
      findEdgeCaptureById: vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce(existing),
      insertEdgeCapture: vi.fn().mockRejectedValue(new Error('duplicate primary key')),
    });
    const service = createEdgeCaptureService(deps);

    const result = await service.ingest(uploadInput(metadata));

    expect(result).toEqual({ created: false, capture: existing });
    expect(deps.putImageObject).toHaveBeenCalledOnce();
    expect(deps.deleteImageObject).not.toHaveBeenCalled();
  });

  it('mismo capture_id con contenido distinto: error 409', async () => {
    const metadata = buildMetadata();
    const imageKey = buildEdgeCaptureImageKey(CAPTURE_ID, metadata.image_sha256, 'image/png');
    const otherImage = pngBuffer('otra-imagen');
    const otherMetadata = { ...metadata, image_sha256: sha256(otherImage) };
    const deps = dependencies({
      findEdgeCaptureById: vi.fn().mockResolvedValue(rowFromMetadata(metadata, imageKey)),
    });
    const service = createEdgeCaptureService(deps);

    await expect(service.ingest(uploadInput(otherMetadata, otherImage))).rejects.toBeInstanceOf(
      EdgeCaptureConflictError,
    );
    expect(deps.insertEdgeCapture).not.toHaveBeenCalled();
  });

  it('hash declarado que no coincide con los bytes: error 422', async () => {
    const deps = dependencies();
    const service = createEdgeCaptureService(deps);
    const wrongHash = buildMetadata({ image_sha256: '0'.repeat(64) });

    await expect(service.ingest(uploadInput(wrongHash))).rejects.toBeInstanceOf(
      EdgeCaptureUnprocessableEntityError,
    );
    expect(deps.putImageObject).not.toHaveBeenCalled();
    expect(deps.insertEdgeCapture).not.toHaveBeenCalled();
  });

  it('clase fuera de {car, person}: error 422', async () => {
    const deps = dependencies();
    const service = createEdgeCaptureService(deps);

    await expect(
      service.ingest(uploadInput(buildMetadata({ predicted_class: 'bicycle' }))),
    ).rejects.toBeInstanceOf(EdgeCaptureUnprocessableEntityError);
  });

  it('confianza fuera de [0, 1]: error 422', async () => {
    const deps = dependencies();
    const service = createEdgeCaptureService(deps);

    await expect(
      service.ingest(uploadInput(buildMetadata({ confidence: 1.5 }))),
    ).rejects.toBeInstanceOf(EdgeCaptureUnprocessableEntityError);
  });

  it('fecha calendaria imposible: error 422', async () => {
    const deps = dependencies();
    const service = createEdgeCaptureService(deps);

    await expect(
      service.ingest(uploadInput(buildMetadata({ captured_at: '2026-02-30T14:05:37Z' }))),
    ).rejects.toBeInstanceOf(EdgeCaptureUnprocessableEntityError);
  });

  it('MIME no soportado: error 415', async () => {
    const deps = dependencies();
    const service = createEdgeCaptureService(deps);
    const input = uploadInput();
    input.image.mimeType = 'image/webp';

    await expect(service.ingest(input)).rejects.toBeInstanceOf(
      EdgeCaptureUnsupportedMediaTypeError,
    );
  });

  it('imagen mayor a 10 MiB: error 413', async () => {
    const deps = dependencies();
    const service = createEdgeCaptureService(deps);
    const bigBuffer = Buffer.alloc(10 * 1024 * 1024 + 1, 0x41);
    const metadata = buildMetadata({ image_sha256: sha256(bigBuffer) });

    await expect(service.ingest(uploadInput(metadata, bigBuffer))).rejects.toBeInstanceOf(
      EdgeCapturePayloadTooLargeError,
    );
  });

  it('si el insert falla, limpia solo el objeto subido', async () => {
    const failing = new Error('insert falló');
    const deps = dependencies({
      insertEdgeCapture: vi.fn().mockRejectedValue(failing),
    });
    const service = createEdgeCaptureService(deps);
    const expectedKey = buildEdgeCaptureImageKey(CAPTURE_ID, sha256(pngBuffer()), 'image/png');

    await expect(service.ingest(uploadInput())).rejects.toThrow('insert falló');
    expect(deps.putImageObject).toHaveBeenCalledWith(expectedKey, expect.any(Buffer), 'image/png');
    expect(deps.deleteImageObject).toHaveBeenCalledWith(expectedKey);
  });

  it('la key del objeto es determinista: edge-captures/<capture_id>/<hash>.<ext>', () => {
    expect(buildEdgeCaptureImageKey(CAPTURE_ID, 'a'.repeat(64), 'image/png')).toBe(
      `edge-captures/${CAPTURE_ID}/${'a'.repeat(64)}.png`,
    );
    expect(buildEdgeCaptureImageKey(CAPTURE_ID, 'b'.repeat(64), 'image/jpeg')).toBe(
      `edge-captures/${CAPTURE_ID}/${'b'.repeat(64)}.jpg`,
    );
  });

  it('serializa únicamente los campos definidos por la respuesta del contrato', () => {
    const metadata = buildMetadata();
    const row = rowFromMetadata(
      metadata,
      buildEdgeCaptureImageKey(CAPTURE_ID, metadata.image_sha256, 'image/png'),
    );

    expect(toEdgeCaptureResponse(row)).toEqual({
      capture_id: CAPTURE_ID,
      captured_at: metadata.captured_at,
      device_id: metadata.device_id,
      model_version: metadata.model_version,
      predicted_class: metadata.predicted_class,
      confidence: metadata.confidence,
      image_sha256: metadata.image_sha256,
      image_key: row.imageKey,
      received_at: '2026-10-13T20:05:38.000Z',
    });
  });
});

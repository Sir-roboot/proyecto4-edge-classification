import { Readable } from 'node:stream';
import type { Express } from 'express';
import express from 'express';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  process.env.DATABASE_URL ??= 'mysql://test:test@127.0.0.1:3306/test';
  process.env.OBJECT_STORE_BUCKET ??= 'test-bucket';
  process.env.EDGE_INGEST_TOKEN ??= 'test-edge-ingest-token-1234567890123456';

  return {
    getEdgeCaptureList: vi.fn(),
    getEdgeCaptureDetail: vi.fn(),
    getEdgeCaptureImage: vi.fn(),
    ingestEdgeCapture: vi.fn(),
    toEdgeCaptureResponse: vi.fn(),
  };
});

vi.mock('../src/logic/index.js', () => {
  class EdgeCaptureError extends Error {
    status = 500;
  }

  class EdgeCaptureBadRequestError extends EdgeCaptureError {
    status = 400;
  }

  return {
    authenticateEdgeIngest: vi.fn((_req: unknown, _res: unknown, next: () => void) => next()),
    EDGE_CAPTURE_MAX_IMAGE_BYTES: 10 * 1024 * 1024,
    EDGE_CAPTURE_MAX_METADATA_BYTES: 4096,
    EdgeCaptureBadRequestError,
    EdgeCaptureError,
    getEdgeCaptureList: mocks.getEdgeCaptureList,
    getEdgeCaptureDetail: mocks.getEdgeCaptureDetail,
    getEdgeCaptureImage: mocks.getEdgeCaptureImage,
    ingestEdgeCapture: mocks.ingestEdgeCapture,
    toEdgeCaptureResponse: mocks.toEdgeCaptureResponse,
  };
});

import { registerEdgeCaptureRoutes } from '../src/ui/edge-captures.route.js';

const capture = {
  capture_id: 'capture-123',
  captured_at: '2026-10-16T10:00:00Z',
  device_id: 'rpi-01',
  model_version: 'int8-v1',
  predicted_class: 'car',
  confidence: 0.95,
  image_sha256: 'a'.repeat(64),
  image_key: 'edge-captures/capture-123/a.jpg',
  received_at: '2026-10-16T10:01:00.000Z',
};

let server: ReturnType<Express['listen']> | undefined;

async function startServer(): Promise<string> {
  const app = express();

  registerEdgeCaptureRoutes(app, '/api/edge-captures');

  const currentServer = app.listen(0);
  server = currentServer;

  await new Promise<void>((resolve) => currentServer.once('listening', resolve));

  const address = currentServer.address();

  if (!address || typeof address === 'string') {
    throw new Error('No se pudo iniciar el servidor de prueba.');
  }

  return `http://127.0.0.1:${address.port}`;
}

afterEach(async () => {
  vi.clearAllMocks();

  if (server) {
    await new Promise<void>((resolve, reject) =>
      server?.close((error) => (error ? reject(error) : resolve())),
    );
  }

  server = undefined;
});

describe('P4-2.3 API de consulta de capturas edge', () => {
  it('devuelve listado paginado', async () => {
    mocks.getEdgeCaptureList.mockResolvedValue([capture]);

    const base = await startServer();
    const response = await fetch(`${base}/api/edge-captures?limit=10&offset=0`);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      captures: [capture],
      limit: 10,
      offset: 0,
    });
    expect(mocks.getEdgeCaptureList).toHaveBeenCalledWith(10, 0);
  });

  it('rechaza parámetros de paginación inválidos', async () => {
    const base = await startServer();
    const response = await fetch(`${base}/api/edge-captures?limit=999`);

    expect(response.status).toBe(400);
  });

  it('devuelve detalle de una captura concreta', async () => {
    mocks.getEdgeCaptureDetail.mockResolvedValue(capture);

    const base = await startServer();
    const response = await fetch(`${base}/api/edge-captures/capture-123`);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(capture);
    expect(mocks.getEdgeCaptureDetail).toHaveBeenCalledWith('capture-123');
  });

  it('devuelve 404 cuando no existe el detalle', async () => {
    mocks.getEdgeCaptureDetail.mockResolvedValue(null);

    const base = await startServer();
    const response = await fetch(`${base}/api/edge-captures/missing-id`);

    expect(response.status).toBe(404);
  });

  it('transmite la imagen con su MIME original', async () => {
    mocks.getEdgeCaptureImage.mockResolvedValue({
      stream: Readable.from(Buffer.from('image-bytes')),
      mimeType: 'image/jpeg',
    });

    const base = await startServer();
    const response = await fetch(`${base}/api/edge-captures/capture-123/image`);

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('image/jpeg');
    expect(Buffer.from(await response.arrayBuffer()).toString()).toBe('image-bytes');
  });

  it('devuelve 404 si la imagen no existe', async () => {
    mocks.getEdgeCaptureImage.mockResolvedValue(null);

    const base = await startServer();
    const response = await fetch(`${base}/api/edge-captures/missing-id/image`);

    expect(response.status).toBe(404);
  });
});

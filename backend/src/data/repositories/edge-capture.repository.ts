
import { desc, eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import {
  type EdgeCapture,
  edgeCaptures,
  type NewEdgeCapture,
} from '../db/schema.js';

/**
 * Busca una captura por capture_id.
 */
export async function findEdgeCaptureById(
  captureId: string,
): Promise<EdgeCapture | null> {
  const rows = await db
    .select()
    .from(edgeCaptures)
    .where(eq(edgeCaptures.captureId, captureId))
    .limit(1);

  return rows[0] ?? null;
}

/**
 * Lista capturas ordenadas desde la más reciente.
 */
export async function listEdgeCaptures(
  limit = 100,
  offset = 0,
): Promise<EdgeCapture[]> {
  return db
    .select()
    .from(edgeCaptures)
    .orderBy(desc(edgeCaptures.receivedAt))
    .limit(limit)
    .offset(offset);
}

/**
 * Inserta una captura y devuelve la fila persistida.
 */
export async function insertEdgeCapture(
  capture: NewEdgeCapture,
): Promise<EdgeCapture> {
  await db.insert(edgeCaptures).values(capture);

  const row = await findEdgeCaptureById(capture.captureId);

  if (!row) {
    throw new Error(
      'No se pudo guardar la captura edge en MariaDB.',
    );
  }

  return row;
}


import { eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import { type EdgeCapture, edgeCaptures, type NewEdgeCapture } from '../db/schema.js';

/**
 * Busca una captura edge por su clave de idempotencia (`capture_id`).
 * Devuelve `null` cuando no existe.
 */
export async function findEdgeCaptureById(captureId: string): Promise<EdgeCapture | null> {
  const rows = await db
    .select()
    .from(edgeCaptures)
    .where(eq(edgeCaptures.captureId, captureId))
    .limit(1);

  return rows[0] ?? null;
}

/**
 * Inserta una captura edge y la devuelve tal como quedó persistida.
 *
 * `capture_id` es la llave primaria: un intento de insertar un id ya
 * existente falla a nivel de base de datos (el servicio lo traduce a un
 * conflicto). El servicio que idempotentiza es la capa Logic; aquí solo se
 * ejecuta la escritura.
 */
export async function insertEdgeCapture(capture: NewEdgeCapture): Promise<EdgeCapture> {
  // El PK es el `capture_id` (no autoincrement), así que no se depende de
  // `$returningId`: se inserta y se relee la fila por su clave primaria.
  await db.insert(edgeCaptures).values(capture);

  const row = await findEdgeCaptureById(capture.captureId);
  if (!row) {
    throw new Error('No se pudo guardar la captura edge en MariaDB.');
  }

  return row;
}

import { desc, eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import { type EdgeCapture, edgeCaptures, type NewEdgeCapture } from '../db/schema.js';

/**
 * Busca una captura por capture_id.
 */
export async function findEdgeCa*tureById(captureId: string): Promi*e<EdgeCapture | null> {
  const ro*s = await db
    .select()
    .fr*m(edgeCaptures)
    .where(eq(edge*aptures.captureId, captureId))
   *.limit(1);

  return rows[0] ?? nu*l;
}

/**
 * Lista capturas ordena*as desde la más reciente.
 */
expo*t async function listEdgeCaptures(*imit = 100, offset = 0): Promise<E*geCapture[]> {
  return db
    .se*ect()
    .from(edgeCaptures)
    *orderBy(desc(edgeCaptures.received*t))
    .limit(limit)
    .offset(*ffset);
}

/**
 * Inserta una capt*ra y devuelve la fila persistida.
**/
export async function insertEdg*Capture(capture: NewEdgeCapture): *romise<EdgeCapture> {
  await db.i*sert(edgeCaptures).values(capture)*

  const row = await findEdgeCapt*reById(capture.captureId);

  if (*row) {
    throw new Error('No se *udo guardar la captura edge en Mar*aDB.');
  }

  return row;
}

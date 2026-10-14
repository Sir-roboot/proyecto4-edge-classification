import type { Readable } from 'node:stream';

import {
  CreateBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
} from '@aws-sdk/client-s3';

import { isLocalObjectStoreEndpoint, objectStoreBucket, s3Client } from './object-store.client.js';

/**
 * Verifica que el bucket exista.
 *
 * Con endpoint explícito (MinIO local) lo crea si falta, para conservar el
 * arranque de un clon limpio sin pasos manuales. En AWS solo comprueba: el
 * bucket lo provisiona IaC y el instance role del backend **no** tiene (ni
 * necesita) `s3:CreateBucket`.
 */
export async function ensureObjectStoreBucket(): Promise<void> {
  try {
    await s3Client.send(new HeadBucketCommand({ Bucket: objectStoreBucket }));
    return;
  } catch (error) {
    if (!isLocalObjectStoreEndpoint) {
      // Sin endpoint, un bucket ausente es un error real de infraestructura.
      throw error;
    }
  }

  try {
    await s3Client.send(new CreateBucketCommand({ Bucket: objectStoreBucket }));
  } catch (error) {
    // Otra instancia puede haberlo creado entre el HeadBucket y el Create.
    if (!isBucketAlreadyOwnedError(error)) {
      throw error;
    }
  }
}

/** Detecta el error de "el bucket ya es tuyo" del S3-compatible/MinIO. */
function isBucketAlreadyOwnedError(error: unknown): boolean {
  const name = (error as { name?: string } | null)?.name;
  return name === 'BucketAlreadyOwnedByYou' || name === 'BucketAlreadyExists';
}

/**
 * Guarda un archivo en el almacén de objetos, fijando su `ContentType` para
 * que las lecturas devuelvan el MIME correcto sin metadatos extra.
 */
export async function uploadImageObject(
  storageKey: string,
  buffer: Buffer,
  mimeType: string,
): Promise<void> {
  await s3Client.send(
    new PutObjectCommand({
      Bucket: objectStoreBucket,
      Key: storageKey,
      Body: buffer,
      ContentType: mimeType,
    }),
  );
}

/**
 * Elimina un archivo almacenado en el almacén de objetos.
 */
export async function deleteImageObject(storageKey: string): Promise<void> {
  await s3Client.send(
    new DeleteObjectCommand({
      Bucket: objectStoreBucket,
      Key: storageKey,
    }),
  );
}

/**
 * Obtiene un stream de lectura (Readable) del archivo guardado.
 */
export async function getImageObjectStream(storageKey: string): Promise<Readable> {
  const response = await s3Client.send(
    new GetObjectCommand({
      Bucket: objectStoreBucket,
      Key: storageKey,
    }),
  );

  if (!response.Body) {
    throw new Error(`El objeto "${storageKey}" no tiene cuerpo en el almacén de objetos.`);
  }

  return response.Body as Readable;
}

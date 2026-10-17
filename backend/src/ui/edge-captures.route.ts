import type express from 'express';
import multer from 'multer';
import { env } from '../config/env.js';
import {
  authenticateEdgeIngest,
  EDGE_CAPTURE_MAX_IMAGE_BYTES,
  EDGE_CAPTURE_MAX_METADATA_BYTES,
  EdgeCaptureBadRequestError,
  EdgeCaptureError,
  getEdgeCaptureDetail,
  getEdgeCaptureImage,
  getEdgeCaptureList,
  ingestEdgeCapture,
  toEdgeCaptureResponse,
} from '../logic/index.js';


/**
 * P4-2.1 — Ruta compartida de ingesta de capturas edge.
 *
 * Contrato: `docs/EDGE_CAPTURE_CONTRACT.md`. Esta función se monta en **dos**
 * caminos con exactamente la misma cadena auth → multer → handler:
 *
 *  - `POST /api/edge-captures` — ruta pública del contrato, para clientes
 *    directos (la Raspberry tal como la documenta el contrato).
 *  - `POST /edge-captures` — alias **interno** para que el nginx del
 *    contenedor consolidado (App Runner) pueda quitar el prefijo `/api/` con
 *    `proxy_pass http://127.0.0.1:3100/`, igual que hace el nginx local, sin
 *    reescribir la ruta en el backend.
 *
 * El orden importa: la autenticación corre **antes** de Multer, así que una
 * petición sin token válido se rechaza con `401` sin siquiera consumir/parsear
 * el multipart y, por lo tanto, sin persistir nada.
 */

/** 401 uniforme: mismo cuerpo para token ausente, mal esquema o incorrecto. */
const UNAUTHORIZED_BODY = { error: 'No autorizado.' };

/**
 * Middleware de autenticación de la ingesta edge.
 *
 * Compara el token en tiempo constante (`node:crypto`) contra
 * `EDGE_INGEST_TOKEN`. Nunca registra ni devuelve el token: solo responde 401,
 * antes de que Multer lea el cuerpo.
 */
export function requireEdgeIngestToken(
  req: express.Request,
  res: express.Response,
  next: express.NextFunction,
): void {
  const result = authenticateEdgeIngest(req.get('authorization'), env.EDGE_INGEST_TOKEN);

  if (!result.ok) {
    // El motivo (`missing-header` / `wrong-scheme` / `invalid-token`) no se
    // expone en la respuesta ni en logs: no da pistas a un atacante.
    res.status(401).json(UNAUTHORIZED_BODY);
    return;
  }

  next();
}

/**
 * Mapea los errores tipados de la ingesta edge a su código HTTP.
 *
 * El status vive en el propio error (`EdgeCaptureError.status`), así que el
 * mapeo no depende de comparar mensajes. Un error desconocido cae en 500.
 */
function sendEdgeCaptureError(res: express.Response, error: unknown): void {
  if (error instanceof EdgeCaptureError) {
    res.status(error.status).json({ error: error.message });
    return;
  }

  console.error('Error desconocido al ingerir la captura edge.', error);
  res.status(500).json({ error: 'No se pudo procesar la captura edge.' });
}

/**
 * Registra la ruta de ingesta en un `path` dado (ver nota de montaje arriba).
 * El mismo multer y el mismo handler sirven a ambas rutas.
 */
export function registerEdgeCaptureRoutes(app: express.Express, path: string): void {
  /**
   * Multer dedicado a la ingesta de capturas edge.
   *
   * El contrato fija un límite de 10 MiB para la parte `image` (independiente
   * del límite del portal). Un archivo más grande produce un `MulterError` con
   * `code === 'LIMIT_FILE_SIZE'`, que el manejador de errores mapea a 413.
   */
  const edgeCaptureUpload = multer({
    storage: multer.memoryStorage(),
    limits: {
      fileSize: EDGE_CAPTURE_MAX_IMAGE_BYTES,
    },
  });

    /**
   * GET: lista de capturas edge.
   * Acepta limit y offset para paginar.
   */
  app.get(path, async (req, res) => {
    const rawLimit = req.query.limit;
    const rawOffset = req.query.offset;

    const limit = rawLimit === undefined ? 100 : Number(rawLimit);
    const offset = rawOffset === undefined ? 0 : Number(rawOffset);

    if (
      !Number.isInteger(limit) ||
      limit < 1 ||
      limit > 200 ||
      !Number.isInteger(offset) ||
      offset < 0
    ) {
      res.status(400).json({
        error: 'Los parámetros limit y offset no son válidos.',
      });
      return;
    }

    try {
      const captures = await getEdgeCaptureList(limit, offset);

      res.status(200).json({
        captures,
        limit,
        offset,
      });
    } catch (error) {
      console.error('Error al consultar capturas edge.', error);
      res.status(500).json({
        error: 'No se pudieron consultar las capturas edge.',
      });
    }
  });

  /**
   * GET: imagen original de una captura.
   * El objeto se obtiene del bucket privado mediante Logic.
   */
  app.get(`${path}/:captureId/image`, async (req, res) => {
    try {
      const result = await getEdgeCaptureImage(req.params.captureId);

      if (!result) {
        res.status(404).json({
          error: 'No se encontró la captura solicitada.',
        });
        return;
      }

      res.setHeader('Content-Type', result.mimeType);
      res.setHeader('Cache-Control', 'private, max-age=300');
      res.setHeader('X-Content-Type-Options', 'nosniff');

      result.stream.on('error', (error) => {
        console.error('Error al leer la imagen de una captura edge.', error);

        if (!res.headersSent) {
          res.status(500).json({
            error: 'No se pudo leer la imagen.',
          });
        } else {
          res.destroy(error instanceof Error ? error : undefined);
        }
      });

      result.stream.pipe(res);
    } catch (error) {
      console.error('Error al obtener imagen edge.', error);

      if (!res.headersSent) {
        res.status(500).json({
          error: 'No se pudo obtener la imagen de la captura.',
        });
      } else {
        res.destroy(error instanceof Error ? error : undefined);
      }
    }
  });

  app.post(
    path,
    requireEdgeIngestToken,
    edgeCaptureUpload.fields([{ name: 'image', maxCount: 1 }]),
    async (req, res) => {
      try {
        const files = req.files as Record<string, Express.Multer.File[] | undefined> | undefined;
        const imagePart = files?.image?.[0];
        const bodyKeys = Object.keys(req.body as Record<string, unknown>);
        const metadataPart = (req.body as Record<string, unknown>).metadata;

        // Deben existir exactamente el campo de texto `metadata` y el archivo
        // `image`; campos de texto adicionales también violan el contrato.
        if (
          typeof metadataPart !== 'string' ||
          !imagePart ||
          bodyKeys.length !== 1 ||
          bodyKeys[0] !== 'metadata'
        ) {
          throw new EdgeCaptureBadRequestError(
            'El multipart debe incluir las partes "metadata" e "image".',
          );
        }

        // La metadata no debe exceder 4 KiB.
        if (Buffer.byteLength(metadataPart, 'utf8') > EDGE_CAPTURE_MAX_METADATA_BYTES) {
          throw new EdgeCaptureBadRequestError(
            'La metadata excede el tamaño máximo de 4096 bytes.',
          );
        }

        let metadata: unknown;
        try {
          metadata = JSON.parse(metadataPart);
        } catch {
          throw new EdgeCaptureBadRequestError('La parte "metadata" no es JSON válido.');
        }

        const result = await ingestEdgeCapture({
          metadata,
          image: {
            mimeType: imagePart.mimetype,
            buffer: imagePart.buffer,
          },
        });

        // Respuesta del contrato: eco del evento + received_at + image_key.
        res.status(result.created ? 201 : 200).json(toEdgeCaptureResponse(result.capture));
      } catch (error) {
        sendEdgeCaptureError(res, error);
      }
    },
  );
}

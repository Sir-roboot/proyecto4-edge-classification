/**
 * SPEC-VALID-001 ÔÇö Errores tipados de la capa Logic.
 *
 * La capa UI mapea la clase del error a un c├│digo HTTP. De este modo no
 * necesita inspeccionar mensajes de texto para decidir el status, lo que
 * ser├¡a fr├ígil ante cualquier cambio de redacci├│n.
 */

/**
 * Dato inv├ílido o regla de negocio violada. La capa UI responde 400.
 */
export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

/**
 * El recurso solicitado no existe en la base de datos. La capa UI responde 404.
 */
export class NotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NotFoundError';
  }
}

/**
 * P4-2.1 — Errores tipados de la ingesta de capturas edge.
 *
 * Cada clase lleva un `status` HTTP semántico para que la capa UI mapee el
 * error sin comparar el texto del mensaje (mismo criterio que
 * `ValidationError`/`NotFoundError`). El `status` es la única fuente de
 * verdad del código de respuesta.
 */
export class EdgeCaptureError extends Error {
  /** Código de estado HTTP que corresponde a este error. */
  public readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'EdgeCaptureError';
    this.status = status;
  }
}

/** Petición mal formada (falta una parte, metadata no es JSON, etc.). → 400 */
export class EdgeCaptureBadRequestError extends EdgeCaptureError {
  constructor(message: string) {
    super(message, 400);
    this.name = 'EdgeCaptureBadRequestError';
  }
}

/** La imagen excede el tamaño máximo permitido. → 413 */
export class EdgeCapturePayloadTooLargeError extends EdgeCaptureError {
  constructor(message: string) {
    super(message, 413);
    this.name = 'EdgeCapturePayloadTooLargeError';
  }
}

/** La parte `image` no es `image/jpeg` ni `image/png`. → 415 */
export class EdgeCaptureUnsupportedMediaTypeError extends EdgeCaptureError {
  constructor(message: string) {
    super(message, 415);
    this.name = 'EdgeCaptureUnsupportedMediaTypeError';
  }
}

/** Metadata sintácticamente válida pero que no cumple el contrato. → 422 */
export class EdgeCaptureUnprocessableEntityError extends EdgeCaptureError {
  constructor(message: string) {
    super(message, 422);
    this.name = 'EdgeCaptureUnprocessableEntityError';
  }
}

/** `capture_id` ya persistido con contenido distinto. → 409 */
export class EdgeCaptureConflictError extends EdgeCaptureError {
  constructor(message: string) {
    super(message, 409);
    this.name = 'EdgeCaptureConflictError';
  }
}

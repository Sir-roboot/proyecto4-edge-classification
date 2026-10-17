
import {
  AlertCircle,
  Camera,
  Car,
  Clock3,
  Cpu,
  RefreshCw,
  UserRound,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { z } from "zod";
import { buildApiUrl, getJson } from "@/api/client";

const captureSchema = z.object({
  capture_id: z.string(),
  captured_at: z.string(),
  device_id: z.string(),
  model_version: z.string(),
  predicted_class: z.enum(["car", "person"]),
  confidence: z.number().min(0).max(1),
  image_sha256: z.string(),
  crop: z
    .object({
      x: z.number(),
      y: z.number(),
      width: z.number(),
      height: z.number(),
    })
    .optional(),
  image_key: z.string(),
  received_at: z.string(),
});

const captureListSchema = z.object({
  captures: z.array(captureSchema),
  limit: z.number(),
  offset: z.number(),
});

type EdgeCapture = z.infer<typeof captureSchema>;

function formatDate(value: string): string {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("es-MX", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function errorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message
    : "Ocurrió un error inesperado.";
}

export function EdgeCapturesPage(): JSX.Element {
  const [captures, setCaptures] = useState<EdgeCapture[]>([]);
  const [selected, setSelected] = useState<EdgeCapture | null>(null);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const loadCaptures = useCallback(async (signal: AbortSignal) => {
    setLoading(true);
    setError(null);

    try {
      const result = await getJson(
        "/edge-captures?limit=100&offset=0",
        captureListSchema,
        { signal },
      );

      setCaptures(result.captures);
    } catch (cause) {
      if (!signal.aborted) {
        setError(errorMessage(cause));
      }
    } finally {
      if (!signal.aborted) {
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();

    void loadCaptures(controller.signal);

    return () => controller.abort();
  }, [loadCaptures, reloadKey]);

  async function showDetail(captureId: string): Promise<void> {
    setSelected(null);
    setDetailError(null);
    setDetailLoading(true);

    try {
      const detail = await getJson(
        `/edge-captures/${encodeURIComponent(captureId)}`,
        captureSchema,
      );

      setSelected(detail);
    } catch (cause) {
      setDetailError(errorMessage(cause));
    } finally {
      setDetailLoading(false);
    }
  }

  return (
    <section className="edge-captures-page">
      <header className="edge-captures-header">
        <div>
          <p className="edge-captures-eyebrow">
            Clasificador en producción
          </p>

          <h2>
            <Camera aria-hidden size={22} />
            Capturas Edge
          </h2>

          <p>
            Eventos enviados por dispositivos Edge con inferencia local.
          </p>
        </div>

        <button
          type="button"
          onClick={() => setReloadKey((value) => value + 1)}
          disabled={loading}
        >
          <RefreshCw size={16} aria-hidden />
          Actualizar
        </button>
      </header>

      {error && (
        <div role="alert" className="edge-captures-error">
          <AlertCircle size={18} />
          <span>
            No se pudieron cargar las capturas: {error}
          </span>
        </div>
      )}

      {loading && (
        <p role="status" className="edge-captures-state">
          Cargando capturas Edge...
        </p>
      )}

      {!loading && !error && captures.length === 0 && (
        <div className="edge-captures-state">
          <Camera size={28} />
          <strong>Todavía no hay capturas</strong>
          <span>
            Cuando la Raspberry envíe eventos, aparecerán aquí.
          </span>
        </div>
      )}

      {!loading && !error && captures.length > 0 && (
        <div className="edge-captures-grid">
          {captures.map((capture) => (
            <article
              className="edge-capture-card"
              key={capture.capture_id}
            >
              <img
                src={buildApiUrl(
                  `/edge-captures/${encodeURIComponent(
                    capture.capture_id,
                  )}/image`,
                )}
                alt={`Captura ${capture.capture_id}`}
                loading="lazy"
                onError={(event) => {
                  event.currentTarget.alt =
                    "No se pudo cargar la imagen de esta captura";
                }}
              />

              <div className="edge-capture-card-body">
                <div className="edge-capture-card-title">
                  <span
                    className={`edge-capture-class ${capture.predicted_class}`}
                  >
                    {capture.predicted_class === "car" ? (
                      <Car size={15} aria-hidden />
                    ) : (
                      <UserRound size={15} aria-hidden />
                    )}

                    {capture.predicted_class === "car"
                      ? "Vehículo"
                      : "Persona"}
                  </span>

                  <strong>
                    {(capture.confidence * 100).toFixed(1)}%
                  </strong>
                </div>

                <p>
                  <Cpu size={15} aria-hidden />
                  <span>{capture.device_id}</span>
                </p>

                <p>
                  <Clock3 size={15} aria-hidden />
                  <span>{formatDate(capture.captured_at)}</span>
                </p>

                <button
                  type="button"
                  className="edge-capture-detail-button"
                  onClick={() => void showDetail(capture.capture_id)}
                >
                  Consultar detalle
                </button>
              </div>
            </article>
          ))}
        </div>
      )}

      {detailLoading && (
        <p role="status" className="edge-captures-detail-state">
          Consultando detalle...
        </p>
      )}

      {detailError && (
        <div role="alert" className="edge-captures-error">
          No se pudo consultar el detalle: {detailError}
        </div>
      )}

      {selected && (
        <section
          className="edge-capture-detail"
          aria-label="Detalle de captura"
        >
          <div className="edge-capture-detail-header">
            <h3>Detalle de captura</h3>

            <button
              type="button"
              onClick={() => setSelected(null)}
            >
              Cerrar
            </button>
          </div>

          <dl>
            <dt>Capture ID</dt>
            <dd>{selected.capture_id}</dd>

            <dt>Clase predicha</dt>
            <dd>{selected.predicted_class}</dd>

            <dt>Confianza</dt>
            <dd>
              {(selected.confidence * 100).toFixed(2)}%
            </dd>

            <dt>Dispositivo</dt>
            <dd>{selected.device_id}</dd>

            <dt>Versión del modelo</dt>
            <dd>{selected.model_version}</dd>

            <dt>Fecha de captura</dt>
            <dd>{formatDate(selected.captured_at)}</dd>

            <dt>Fecha de recepción</dt>
            <dd>{formatDate(selected.received_at)}</dd>

            <dt>SHA-256 de imagen</dt>
            <dd>{selected.image_sha256}</dd>

            {selected.crop && (
              <>
                <dt>Recorte</dt>
                <dd>
                  {`${selected.crop.x}, ${selected.crop.y}, ${selected.crop.width} × ${selected.crop.height}`}
                </dd>
              </>
            )}
          </dl>
        </section>
      )}
    </section>
  );
}

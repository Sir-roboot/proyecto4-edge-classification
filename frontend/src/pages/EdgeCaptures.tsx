
import { useCallback, useEffect, useState } from "react";
import {
  AlertCircle,
  Camera,
  Car,
  Clock3,
  Cpu,
  ImageOff,
  RefreshCw,
  UserRound,
} from "lucide-react";
import { z } from "zod";
import { buildApiUrl, getJson } from "@/api/client";
import { AppLayout } from "@/components/layout/AppLayout";

const edgeCaptureSchema = z.object({
  capture_id: z.string(),
  captured_at: z.string(),
  device_id: z.string(),
  model_version: z.string(),
  predicted_class: z.enum(["car", "person"]),
  confidence: z.number().min(0).max(1),
  image_sha256: z.string(),
  image_key: z.string(),
  received_at: z.string(),
  crop: z
    .object({
      x: z.number(),
      y: z.number(),
      width: z.number(),
      height: z.number(),
    })
    .optional(),
});

const edgeCaptureListSchema = z.object({
  captures: z.array(edgeCaptureSchema),
  limit: z.number(),
  offset: z.number(),
});

type EdgeCapture = z.infer<typeof edgeCaptureSchema>;

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

function formatConfidence(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function getImageUrl(capture: EdgeCapture): string {
  return buildApiUrl(
    `/edge-captures/${encodeURIComponent(capture.capture_id)}/image`
  );
}

export function EdgeCapturesPage() {
  const [captures, setCaptures] = useState<EdgeCapture[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const loadCaptures = useCallback(async (signal: AbortSignal) => {
    setLoading(true);
    setError(null);

    try {
      const response = await getJson(
        "/edge-captures?limit=100&offset=0",
        edgeCaptureListSchema,
        { signal }
      );

      setCaptures(response.captures);
    } catch (cause) {
      if (signal.aborted) {
        return;
      }

      setError(
        cause instanceof Error
          ? cause.message
          : "No se pudieron cargar las capturas."
      );
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

  return (
    <AppLayout>
      <main className="min-w-0 flex-1 px-6 py-6 lg:px-10 lg:py-8">
        <div className="mx-auto flex max-w-7xl flex-col gap-6">
          <header className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="flex items-center gap-2">
                <Camera className="h-6 w-6 text-accent-lilac" aria-hidden />
                <h1 className="text-xl font-semibold text-ink">
                  Capturas Edge
                </h1>
              </div>

              <p className="mt-2 text-sm text-ink-muted">
                Fotografías y predicciones generadas localmente por los
                dispositivos Edge.
              </p>
            </div>

            <button
              type="button"
              onClick={() => setReloadKey((value) => value + 1)}
              disabled={loading}
              className="inline-flex items-center justify-center gap-2 rounded-lg border border-border bg-surface px-4 py-2 text-sm font-medium text-ink transition-colors hover:bg-sidebar disabled:cursor-not-allowed disabled:opacity-50"
            >
              <RefreshCw
                className={`h-4 w-4 ${loading ? "animate-spin" : ""}`}
                aria-hidden
              />
              Actualizar
            </button>
          </header>

          <section
            className="grid grid-cols-1 gap-4 sm:grid-cols-3"
            aria-label="Resumen de capturas"
          >
            <div className="rounded-xl border border-border bg-surface p-5">
              <div className="flex items-center gap-3">
                <Camera className="h-5 w-5 text-accent-lilac" aria-hidden />
                <span className="text-sm text-ink-muted">
                  Capturas cargadas
                </span>
              </div>
              <p className="mt-3 text-2xl font-semibold text-ink">
                {captures.length}
              </p>
            </div>

            <div className="rounded-xl border border-border bg-surface p-5">
              <div className="flex items-center gap-3">
                <Car className="h-5 w-5 text-ink-muted" aria-hidden />
                <span className="text-sm text-ink-muted">Vehículos</span>
              </div>
              <p className="mt-3 text-2xl font-semibold text-ink">
                {captures.filter((capture) => capture.predicted_class === "car").length}
              </p>
            </div>

            <div className="rounded-xl border border-border bg-surface p-5">
              <div className="flex items-center gap-3">
                <UserRound className="h-5 w-5 text-ink-muted" aria-hidden />
                <span className="text-sm text-ink-muted">Personas</span>
              </div>
              <p className="mt-3 text-2xl font-semibold text-ink">
                {captures.filter((capture) => capture.predicted_class === "person").length}
              </p>
            </div>
          </section>

          {error && (
            <div
              role="alert"
              className="flex items-start gap-3 rounded-xl border border-red-300 bg-red-50 p-4 text-sm text-red-800"
            >
              <AlertCircle className="mt-0.5 h-5 w-5 shrink-0" aria-hidden />
              <div>
                <p className="font-semibold">
                  No se pudieron cargar las capturas.
                </p>
                <p className="mt-1">{error}</p>
                <button
                  type="button"
                  onClick={() => setReloadKey((value) => value + 1)}
                  className="mt-2 font-semibold underline"
                >
                  Intentar de nuevo
                </button>
              </div>
            </div>
          )}

          {loading && (
            <div
              className="rounded-xl border border-border bg-surface p-8 text-center text-sm text-ink-muted"
              role="status"
            >
              Cargando capturas Edge...
            </div>
          )}

          {!loading && !error && captures.length === 0 && (
            <div className="rounded-xl border border-border bg-surface px-6 py-14 text-center">
              <ImageOff
                className="mx-auto h-10 w-10 text-ink-muted"
                aria-hidden
              />
              <h2 className="mt-4 font-semibold text-ink">
                Todavía no hay capturas
              </h2>
              <p className="mt-2 text-sm text-ink-muted">
                Cuando la Raspberry envíe capturas y el backend las guarde,
                aparecerán aquí.
              </p>
            </div>
          )}

          {!loading && !error && captures.length > 0 && (
            <section
              className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3"
              aria-label="Listado de capturas Edge"
            >
              {captures.map((capture) => (
                <article
                  key={capture.capture_id}
                  className="overflow-hidden rounded-xl border border-border bg-surface"
                >
                  <div className="aspect-video bg-sidebar">
                    <img
                      src={getImageUrl(capture)}
                      alt={`Captura ${capture.capture_id}: ${capture.predicted_class}`}
                      loading="lazy"
                      className="h-full w-full object-contain"
                      onError={(event) => {
                        event.currentTarget.style.display = "none";
                      }}
                    />
                  </div>

                  <div className="flex flex-col gap-4 p-5">
                    <div className="flex items-center justify-between gap-3">
                      <span
                        className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-sm font-semibold ${
                          capture.predicted_class === "car"
                            ? "bg-blue-50 text-blue-800"
                            : "bg-purple-50 text-purple-800"
                        }`}
                      >
                        {capture.predicted_class === "car" ? (
                          <Car className="h-4 w-4" aria-hidden />
                        ) : (
                          <UserRound className="h-4 w-4" aria-hidden />
                        )}
                        {capture.predicted_class === "car"
                          ? "Vehículo"
                          : "Persona"}
                      </span>

                      <span className="text-sm font-semibold text-ink">
                        {formatConfidence(capture.confidence)}
                      </span>
                    </div>

                    <div>
                      <p className="text-xs text-ink-muted">
                        Identificador de captura
                      </p>
                      <p className="mt-1 break-all font-mono text-xs text-ink">
                        {capture.capture_id}
                      </p>
                    </div>

                    <div className="grid grid-cols-1 gap-3 text-sm">
                      <div className="flex items-start gap-2">
                        <Cpu
                          className="mt-0.5 h-4 w-4 shrink-0 text-ink-muted"
                          aria-hidden
                        />
                        <div className="min-w-0">
                          <p className="text-xs text-ink-muted">Dispositivo</p>
                          <p className="break-all text-ink">
                            {capture.device_id}
                          </p>
                        </div>
                      </div>

                      <div className="flex items-start gap-2">
                        <Clock3
                          className="mt-0.5 h-4 w-4 shrink-0 text-ink-muted"
                          aria-hidden
                        />
                        <div>
                          <p className="text-xs text-ink-muted">
                            Capturada
                          </p>
                          <p className="text-ink">
                            {formatDate(capture.captured_at)}
                          </p>
                        </div>
                      </div>
                    </div>

                    <div className="border-t border-border pt-3">
                      <p className="text-xs text-ink-muted">Modelo</p>
                      <p className="mt-1 break-all text-sm text-ink">
                        {capture.model_version}
                      </p>

                      <p className="mt-3 text-xs text-ink-muted">
                        Recibida por el servidor
                      </p>
                      <p className="mt-1 text-sm text-ink">
                        {formatDate(capture.received_at)}
                      </p>
                    </div>
                  </div>
                </article>
              ))}
            </section>
          )}
        </div>
      </main>
    </AppLayout>
  );
}

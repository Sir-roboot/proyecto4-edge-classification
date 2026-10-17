import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  buildApiUrl: vi.fn((path: string) => `/api${path}`),
  getJson: vi.fn(),
}));

vi.mock("@/api/client", () => api);

import { EdgeCapturesPage } from "../src/pages/classifier/EdgeCaptures";

const capture = {
  capture_id: "capture-123",
  captured_at: "2026-10-16T10:00:00Z",
  device_id: "rpi-01",
  model_version: "int8-v1",
  predicted_class: "car" as const,
  confidence: 0.95,
  image_sha256: "a".repeat(64),
  image_key: "edge-captures/capture-123/a.jpg",
  received_at: "2026-10-16T10:01:00.000Z",
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

beforeEach(() => {
  api.getJson.mockReset();
});

describe("Capturas Edge", () => {
  it("muestra carga, listado e imagen", async () => {
    let resolveRequest: ((value: unknown) => void) | undefined;

    api.getJson.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveRequest = resolve;
        })
    );

    render(<EdgeCapturesPage />);

    expect(screen.getByRole("status")).toHaveTextContent("Cargando capturas Edge");

    resolveRequest?.({
      captures: [capture],
      limit: 100,
      offset: 0,
    });

    expect(await screen.findByText("Vehículo")).toBeInTheDocument();
    expect(screen.getByText("95.0%")).toBeInTheDocument();

    expect(screen.getByAltText("Captura capture-123")).toHaveAttribute(
      "src",
      "/api/edge-captures/capture-123/image"
    );
  });

  it("muestra el estado vacío", async () => {
    api.getJson.mockResolvedValueOnce({
      captures: [],
      limit: 100,
      offset: 0,
    });

    render(<EdgeCapturesPage />);

    expect(await screen.findByText("Todavía no hay capturas")).toBeInTheDocument();
  });

  it("muestra un error y permite reintentar", async () => {
    api.getJson.mockRejectedValueOnce(new Error("No se pudo conectar con el servidor."));

    render(<EdgeCapturesPage />);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "No se pudo conectar con el servidor"
    );

    api.getJson.mockResolvedValueOnce({
      captures: [capture],
      limit: 100,
      offset: 0,
    });

    fireEvent.click(screen.getByRole("button", { name: /Actualizar/i }));

    expect(await screen.findByText("Vehículo")).toBeInTheDocument();
  });

  it("consulta y muestra el detalle de una captura", async () => {
    api.getJson
      .mockResolvedValueOnce({
        captures: [capture],
        limit: 100,
        offset: 0,
      })
      .mockResolvedValueOnce(capture);

    render(<EdgeCapturesPage />);

    fireEvent.click(
      await screen.findByRole("button", {
        name: "Consultar detalle",
      })
    );

    await waitFor(() => {
      expect(api.getJson.mock.calls[1]?.[0]).toBe("/edge-captures/capture-123");
    });

    expect(
      await screen.findByRole("region", {
        name: "Detalle de captura",
      })
    ).toBeInTheDocument();

    expect(screen.getByText("a".repeat(64))).toBeInTheDocument();
  });
});

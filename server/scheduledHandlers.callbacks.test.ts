import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  authenticateRequest: vi.fn(),
  getAllFavoriteLocations: vi.fn(),
  acquireForecastRefreshLock: vi.fn(),
}));

vi.mock("./_core/sdk", () => ({
  sdk: { authenticateRequest: mocks.authenticateRequest },
}));

vi.mock("./db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./db")>()),
  getAllFavoriteLocations: mocks.getAllFavoriteLocations,
  acquireForecastRefreshLock: mocks.acquireForecastRefreshLock,
}));

import {
  collectFavoritesForecastsHandler,
  collectForecastsHandler,
  collectObservationsHandler,
  collectPhysicalObservationSnapshotsHandler,
} from "./scheduledHandlers";

type ResponseCapture = {
  status: ReturnType<typeof vi.fn>;
  json: ReturnType<typeof vi.fn>;
};

function responseCapture(): ResponseCapture {
  const response: Partial<ResponseCapture> = {};
  response.status = vi.fn(() => response);
  response.json = vi.fn(() => response);
  return response as ResponseCapture;
}

describe("contrat de sécurité des callbacks planifiés", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.authenticateRequest.mockResolvedValue({ isCron: false, taskUid: undefined });
    mocks.getAllFavoriteLocations.mockResolvedValue([]);
    mocks.acquireForecastRefreshLock.mockResolvedValue(true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.each([
    ["prévisions quotidiennes", collectForecastsHandler],
    ["scoring observations", collectObservationsHandler],
    ["prévisions favoris", collectFavoritesForecastsHandler],
    ["snapshots physiques", collectPhysicalObservationSnapshotsHandler],
  ])("refuse un appel SDK non-cron avant tout effet de bord : %s", async (_name, handler) => {
    const res = responseCapture();

    await handler({ body: {}, url: "/api/scheduled/test" } as any, res as any);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({ error: "cron-only" });
    expect(mocks.getAllFavoriteLocations).not.toHaveBeenCalled();
    expect(mocks.acquireForecastRefreshLock).not.toHaveBeenCalled();
  });

  it("retourne un 500 redacted et un requestId lorsque le callback échoue après authentification", async () => {
    mocks.authenticateRequest.mockResolvedValue({ isCron: true, taskUid: "cron-test" });
    mocks.getAllFavoriteLocations.mockRejectedValue(new Error("mysql://user:top-secret@db/internal"));
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const res = responseCapture();

    await collectPhysicalObservationSnapshotsHandler({ body: {}, url: "/api/scheduled/physical" } as any, res as any);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      error: "scheduled-collection-failed",
      requestId: expect.any(String),
    }));
    const body = res.json.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(JSON.stringify(body)).not.toContain("top-secret");
    expect(body).not.toHaveProperty("stack");
    expect(mocks.acquireForecastRefreshLock).not.toHaveBeenCalled();
    expect(consoleError).toHaveBeenCalledWith("[MeteoAI] Physical snapshot collection failed", expect.objectContaining({
      errorType: "Error",
    }));
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "../_core/context";

const getLatestHourlyComparisonDiagnosticSnapshot = vi.hoisted(() => vi.fn());
const collectExpertForecasts = vi.hoisted(() => vi.fn());

vi.mock("../db", async importOriginal => ({
  ...(await importOriginal<typeof import("../db")>()),
  getLatestHourlyComparisonDiagnosticSnapshot,
}));
vi.mock("../weatherServices", async importOriginal => ({
  ...(await importOriginal<typeof import("../weatherServices")>()),
  collectExpertForecasts,
}));

import { weatherRouter } from "./weather";
import { HONDEGHEM } from "../stationService";
import { makeLocationKey } from "../db";

function publicCaller() {
  const ctx = {
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: { clearCookie: () => {} } as TrpcContext["res"],
    user: null,
  } as TrpcContext;
  return weatherRouter.createCaller(ctx);
}

afterEach(() => {
  getLatestHourlyComparisonDiagnosticSnapshot.mockReset();
  collectExpertForecasts.mockReset();
});

describe("weather.getHourlyComparisonDiagnostics", () => {
  it("lit seulement le snapshot du lieu demandé", async () => {
    const snapshot = {
      locationKey: "50.757_2.52",
      cycleDate: "2026-10-06",
      diagnostics: [],
      capturedAt: new Date("2026-10-07T01:00:00.000Z"),
    };
    getLatestHourlyComparisonDiagnosticSnapshot.mockResolvedValue(snapshot);

    const result = await publicCaller().getHourlyComparisonDiagnostics({
      lat: 50.7567,
      lon: 2.5204,
    });

    expect(result).toEqual(snapshot);
    expect(getLatestHourlyComparisonDiagnosticSnapshot).toHaveBeenCalledWith(
      "50.757_2.52"
    );
    expect(collectExpertForecasts).not.toHaveBeenCalled();
  });

  it("utilise Hondeghem par défaut et ne déclenche aucune collecte", async () => {
    getLatestHourlyComparisonDiagnosticSnapshot.mockResolvedValue(null);

    await expect(
      publicCaller().getHourlyComparisonDiagnostics()
    ).resolves.toBeNull();

    expect(getLatestHourlyComparisonDiagnosticSnapshot).toHaveBeenCalledWith(
      makeLocationKey(HONDEGHEM.lat, HONDEGHEM.lon)
    );
    expect(collectExpertForecasts).not.toHaveBeenCalled();
  });
});

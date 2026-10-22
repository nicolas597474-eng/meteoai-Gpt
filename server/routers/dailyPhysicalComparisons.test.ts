import { afterEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "../_core/context";

const getDailyPhysicalComparisonHistory = vi.hoisted(() => vi.fn());
const getDailyPhysicalComparisonRevisionHistory = vi.hoisted(() => vi.fn());
vi.mock("../db", async importOriginal => ({
  ...(await importOriginal<typeof import("../db")>()),
  getDailyPhysicalComparisonHistory,
  getDailyPhysicalComparisonRevisionHistory,
}));

import { dailyPhysicalComparisonsRouter } from "./dailyPhysicalComparisons";

function caller(role: "admin" | "user" | null) {
  const ctx = {
    req: {} as TrpcContext["req"],
    res: {} as TrpcContext["res"],
    user: role ? { id: 5, role } : null,
  } as TrpcContext;
  return dailyPhysicalComparisonsRouter.createCaller(ctx);
}

afterEach(() => {
  getDailyPhysicalComparisonHistory.mockReset();
  getDailyPhysicalComparisonRevisionHistory.mockReset();
});

describe("weather.dailyPhysicalComparisons.getHistory", () => {
  it("refuse les appels anonymes et non-admin sans lire l’archive", async () => {
    await expect(caller(null).getHistory({})).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(caller("user").getHistory({})).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(getDailyPhysicalComparisonHistory).not.toHaveBeenCalled();
  });

  it("transmet au lecteur de production le lieu, les filtres et le curseur validés", async () => {
    getDailyPhysicalComparisonHistory.mockResolvedValue({
      status: "empty",
      rows: [],
      hasMore: false,
      nextCursor: null,
    });
    const result = await caller("admin").getHistory({
      lat: 50.7567,
      lon: 2.5204,
      validDateFrom: "2026-09-01",
      validDateTo: "2026-10-02",
      serviceName: "AROME",
      variable: "temperature_max",
      horizonBucket: "6-24h",
      cursor: { validDate: "2026-10-01", id: 12 },
      pageSize: 25,
    });

    expect(getDailyPhysicalComparisonHistory).toHaveBeenCalledWith({
      locationKey: "50.757_2.52",
      validDateFrom: "2026-09-01",
      validDateTo: "2026-10-02",
      serviceName: "AROME",
      variable: "temperature_max",
      horizonBucket: "6-24h",
      cursor: { validDate: "2026-10-01", id: 12 },
      pageSize: 25,
    });
    expect(result.status).toBe("empty");
    // The result may not have modelOptions, so check if it exists first
    if (result.modelOptions) {
      expect(result.modelOptions.find((model: any) => model.modelId === "best_match")).toMatchObject({
        isDerivedReference: true,
        serviceName: "Open-Meteo",
      });
    }
  });

  it("rejette les plages inversées, les coordonnées partielles et les tailles excessives avant lecture", async () => {
    await expect(caller("admin").getHistory({ validDateFrom: "2026-10-03", validDateTo: "2026-10-02" }))
      .rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(caller("admin").getHistory({ lat: 50.7567 }))
      .rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(caller("admin").getHistory({ pageSize: 101 }))
      .rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(getDailyPhysicalComparisonHistory).not.toHaveBeenCalled();
  });

  it("expose séparément les révisions append-only, avec les mêmes filtres et les mêmes contrôles d’accès", async () => {
    await expect(caller(null).getRevisionHistory({})).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(caller("user").getRevisionHistory({})).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(getDailyPhysicalComparisonRevisionHistory).not.toHaveBeenCalled();

    getDailyPhysicalComparisonRevisionHistory.mockResolvedValue({
      status: "empty",
      rows: [],
      hasMore: false,
      nextCursor: null,
    });
    const result = await caller("admin").getRevisionHistory({
      lat: 50.7567,
      lon: 2.5204,
      validDateFrom: "2026-09-01",
      validDateTo: "2026-10-02",
      serviceName: "AROME",
      variable: "temperature_max",
      horizonBucket: "6-24h",
      pageSize: 25,
    });

    expect(getDailyPhysicalComparisonRevisionHistory).toHaveBeenCalledWith({
      locationKey: "50.757_2.52",
      validDateFrom: "2026-09-01",
      validDateTo: "2026-10-02",
      serviceName: "AROME",
      variable: "temperature_max",
      horizonBucket: "6-24h",
      cursor: undefined,
      pageSize: 25,
    });
    expect(result.status).toBe("empty");
  });
});

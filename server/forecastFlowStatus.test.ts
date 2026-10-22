import { describe, expect, it } from "vitest";
import { buildForecastFlowStatuses } from "./forecastFlowStatus";

const expectedModels = ["AROME", "Open-Meteo"];
const now = new Date("2026-09-02T08:00:00.000Z");

describe("buildForecastFlowStatuses", () => {
  it("classe SUCCESS lorsque les preuves quotidienne et horaire sont fraîches", () => {
    const [status] = buildForecastFlowStatuses({ expectedModels, dailyCollectedModels: ["AROME"], hourlyCollectedModels: ["AROME"], collectedAt: "2026-09-02T03:00:00.000Z", now });
    expect(status).toMatchObject({ model: "AROME", status: "SUCCESS", dailyCollected: true, hourlyCollected: true, ageHours: 5 });
  });

  it("classe PARTIAL lorsqu’une seule granularité est archivée", () => {
    const [status] = buildForecastFlowStatuses({ expectedModels, dailyCollectedModels: ["AROME"], hourlyCollectedModels: [], collectedAt: "2026-09-02T03:00:00.000Z", now });
    expect(status.status).toBe("PARTIAL");
    expect(status.reason).toContain("horaire absente");
  });

  it("classe FAILED lorsqu’aucune granularité n’est archivée", () => {
    const [status] = buildForecastFlowStatuses({ expectedModels, collectedAt: "2026-09-02T03:00:00.000Z", now });
    expect(status.status).toBe("FAILED");
  });

  it("classe STALE avant tout autre état lorsque le bilan dépasse 30 heures", () => {
    const [status] = buildForecastFlowStatuses({ expectedModels, dailyCollectedModels: ["AROME"], hourlyCollectedModels: ["AROME"], collectedAt: "2026-08-31T23:00:00.000Z", now });
    expect(status.status).toBe("STALE");
    expect(status.reason).toContain("seuil 30 h");
  });

  it("classe tous les flux FAILED en l’absence de bilan vérifiable", () => {
    const statuses = buildForecastFlowStatuses({ expectedModels, collectedAt: null, now });
    expect(statuses).toHaveLength(2);
    expect(statuses.every((item) => item.status === "FAILED")).toBe(true);
  });
});

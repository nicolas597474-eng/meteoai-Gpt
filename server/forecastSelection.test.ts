import { describe, expect, it } from "vitest";
import { selectLatestForecasts } from "./forecastSelection";

describe("sélection des prévisions collectées", () => {
  it("conserve uniquement la collecte la plus récente par date et modèle", () => {
    const selected = selectLatestForecasts([
      { id: 1, date: "2026-08-12", serviceName: "ECMWF", collectedAt: "2026-08-12T05:00:00Z", value: 20 },
      { id: 2, date: "2026-08-12", serviceName: "ECMWF", collectedAt: "2026-08-12T05:30:00Z", value: 21 },
      { id: 3, date: "2026-08-12", serviceName: "AROME", collectedAt: "2026-08-12T05:15:00Z", value: 22 },
    ]);

    expect(selected).toHaveLength(2);
    expect(selected.find((row) => row.serviceName === "ECMWF")?.value).toBe(21);
  });
});

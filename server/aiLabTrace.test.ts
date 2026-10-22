import { describe, expect, it } from "vitest";
import { buildAppliedModelWeights, filterForecastTraceToModelNames } from "./aiLabTrace";

describe("trace AI Lab", () => {
  it("n’expose que les modèles qui ont effectivement contribué à la fusion", () => {
    const result = buildAppliedModelWeights({
      parameterSources: {
        temperature: [
          { name: "ECMWF", type: "model", finalWeight: 0.7 },
          { name: "Station locale", type: "station", finalWeight: 0.3 },
        ],
        precipitation: [{ name: "ECMWF", type: "model", finalWeight: 0.4 }],
        wind: [{ name: "AROME", type: "model", finalWeight: 0.8 }],
        humidity: [{ name: "ECMWF", type: "model", finalWeight: 0.6 }],
      },
    });

    expect(result).toEqual([
      expect.objectContaining({ name: "AROME", wind: 0.8, averageWeight: 0.8 }),
      expect.objectContaining({ name: "ECMWF", temperature: 0.7, precipitation: 0.4, humidity: 0.6, averageWeight: (0.7 + 0.4 + 0.6) / 3 }),
    ]);
  });

  it("ne fabrique aucun contributeur sans trace valide", () => {
    expect(buildAppliedModelWeights(null)).toEqual([]);
  });

  it("exclut les modèles non officiels d’une ancienne trace tout en préservant les autres sources", () => {
    const filtered = filterForecastTraceToModelNames({
      parameterSources: {
        temperature: [
          { name: "ECMWF", type: "model", finalWeight: 0.7 },
          { name: "Open-Meteo", type: "model", finalWeight: 0.3 },
          { name: "Station locale", type: "station", finalWeight: 0.2 },
        ],
        precipitation: [{ name: "best_match", type: "model", finalWeight: 0.2 }],
        wind: [{ name: "GFS", type: "model", finalWeight: 0.8 }],
        humidity: [{ name: "Open-Meteo", type: "model", finalWeight: 0.2 }],
      },
    }, new Set(["ECMWF", "GFS"]));

    expect(buildAppliedModelWeights(filtered).map((model) => model.name)).toEqual(["GFS", "ECMWF"]);
    expect(filtered?.parameterSources?.temperature).toContainEqual({ name: "Station locale", type: "station", finalWeight: 0.2 });
    expect(filtered?.parameterSources?.precipitation).toEqual([]);
    expect(filtered?.parameterSources?.humidity).toEqual([]);
  });
});

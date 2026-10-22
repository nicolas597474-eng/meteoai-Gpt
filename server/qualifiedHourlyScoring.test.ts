import { describe, expect, it } from "vitest";
import { scoreQualifiedHourlyModels } from "./qualifiedHourlyScoring";

describe("scoreQualifiedHourlyModels", () => {
  const snapshots = Array.from({ length: 18 }, (_, hour) => ({ hour, stationCount: 1, temperature: 10 + hour / 2, precipitation: 0, windSpeed: 8 }));
  it("crée un score uniquement avec une couverture horaire physique suffisante", () => {
    const forecasts = snapshots.map((snapshot) => ({ modelName: "ECMWF", hour: snapshot.hour, temperature: snapshot.temperature, precipitation: 0, windSpeed: 8 }));
    const scores = scoreQualifiedHourlyModels(snapshots, forecasts);
    expect(scores).toHaveLength(1);
    expect(scores[0].sampleSize).toBe(18);
    expect(scores[0].maeTemp).toBe(0);
    expect(scores[0].precipPod).toBe(0);
    expect(scores[0].precipFar).toBe(0);
    expect(scores[0].precipFalsePositives).toBe(0);
    expect(scores[0].precipFalseNegatives).toBe(0);
  });

  it("conserve les faux positifs de pluie mesurés contre les snapshots physiques", () => {
    const forecasts = snapshots.map((snapshot) => ({ modelName: "ECMWF", hour: snapshot.hour, temperature: snapshot.temperature, precipitation: 1, windSpeed: 8 }));
    const [score] = scoreQualifiedHourlyModels(snapshots, forecasts);
    expect(score.precipFalsePositives).toBe(18);
    expect(score.precipFar).toBe(1);
    expect(score.precipCsi).toBe(0);
  });

  it("refuse une série incomplète", () => {
    const forecasts = snapshots.slice(0, 17).map((snapshot) => ({ modelName: "ECMWF", hour: snapshot.hour, temperature: snapshot.temperature, precipitation: 0, windSpeed: 8 }));
    expect(scoreQualifiedHourlyModels(snapshots, forecasts)).toEqual([]);
  });

  it("ne publie pas de score normalisé lorsque la pression ou l’humidité ne sont pas alignées", () => {
    const forecasts = snapshots.map((snapshot) => ({
      modelName: "ECMWF",
      hour: snapshot.hour,
      temperature: snapshot.temperature,
      precipitation: 0,
      windSpeed: 8,
    }));
    const [score] = scoreQualifiedHourlyModels(snapshots, forecasts);
    expect(score.normalizedScore).toBeNull();
    expect(score.pressureScore).toBeNull();
    expect(score.humidityScore).toBeNull();
  });
});

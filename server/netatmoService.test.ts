import { describe, expect, it } from "vitest";
import { mapNetatmoPublicStation, mapPersistedNetatmoObservation } from "./netatmoService";
import { getStationSourceKind } from "./stationService";

describe("stations Netatmo publiques", () => {
  it("convertit une station extérieure publique en observation physique vérifiable", () => {
    const station = mapNetatmoPublicStation({
      _id: "public-1",
      station_name: "Station jardin",
      place: { location: [2.52, 50.76], altitude: 42 },
      modules: [
        { type: "NAModule1", dashboard_data: { Temperature: 18.4, Humidity: 66, time_utc: 1_786_524_000 } },
        { type: "NAModule2", dashboard_data: { WindStrength: 11, GustStrength: 22, WindAngle: 140 } },
        { type: "NAModule3", dashboard_data: { sum_rain_1: 0.4 } },
      ],
      dashboard_data: { Pressure: 1016 },
    }, 50.7567, 2.5204);

    expect(station).toMatchObject({
      stationId: "netatmo-public-1",
      source: "netatmo",
      temperature: 18.4,
      humidity: 66,
      pressure: 1016,
      windSpeed: 11,
      precipitation: 0.4,
      isActive: true,
    });
    expect(getStationSourceKind("netatmo")).toBe("physical");
  });

  it("ignore une réponse sans position ou sans mesure extérieure exploitable", () => {
    expect(mapNetatmoPublicStation({ _id: "missing" }, 50.7567, 2.5204)).toBeNull();
    expect(mapNetatmoPublicStation({ _id: "empty", place: { location: [2.52, 50.76] }, modules: [] }, 50.7567, 2.5204)).toBeNull();
  });

  it("accepte une réponse publique qui représente directement le module extérieur", () => {
    const station = mapNetatmoPublicStation({
      _id: "outdoor-1",
      type: "NAModule1",
      place: { location: [2.52, 50.76] },
      dashboard_data: { Temperature: 19.1, Humidity: 58, time_utc: 1_786_524_000 },
    }, 50.7567, 2.5204);

    expect(station).toMatchObject({
      stationId: "netatmo-outdoor-1",
      temperature: 19.1,
      humidity: 58,
    });
  });

  it("décode les séries publiques getpublicdata avec les mesures de vent et de pluie", () => {
    const station = mapNetatmoPublicStation({
      _id: "public-series-1",
      place: { location: [2.52, 50.76] },
      measures: {
        weather: {
          type: ["temperature", "humidity", "pressure"],
          res: { "1786524000": [20.3, 57, 1015.6] },
        },
        wind: { type: ["wind"], wind_strength: 14, gust_strength: 28, wind_angle: 135, wind_timeutc: 1_786_524_060 },
        rain: { type: ["rain"], rain_60min: 0.6, rain_utc: 1_786_524_120 },
      },
    }, 50.7567, 2.5204);

    expect(station).toMatchObject({
      stationId: "netatmo-public-series-1",
      temperature: 20.3,
      humidity: 57,
      pressure: 1015.6,
      windSpeed: 14,
      windGust: 28,
      windDirection: 135,
      precipitation: 0.6,
    });
    expect(station?.updatedAt).toBe(new Date(1_786_524_120 * 1000).toISOString());
    expect(station?.measurementTimes).toMatchObject({
      temperature: new Date(1_786_524_000 * 1000).toISOString(),
      humidity: new Date(1_786_524_000 * 1000).toISOString(),
      pressure: new Date(1_786_524_000 * 1000).toISOString(),
      windSpeed: new Date(1_786_524_060 * 1000).toISOString(),
      windGust: new Date(1_786_524_060 * 1000).toISOString(),
      windDirection: new Date(1_786_524_060 * 1000).toISOString(),
      precipitation: new Date(1_786_524_120 * 1000).toISOString(),
    });
  });

  it("réutilise uniquement une observation Netatmo persistée, validée, fraîche et dans le rayon", () => {
    const now = Date.parse("2026-08-13T08:00:00.000Z");
    const station = mapPersistedNetatmoObservation({
      station: {
        stationId: "netatmo-cache-1", source: "netatmo", name: "Station cache", lat: 50.76, lon: 2.52,
        altitude: 40, reliabilityScore: 72, updateFrequencyMin: 10, dataAvailability: 0.75,
        isActive: 1, qualificationStatus: "validated", sourceTier: 1,
      },
      observation: {
        observedAt: now - 10 * 60_000, temperature: 19.2, humidity: 63, pressure: 1018,
        windSpeed: 8, windGust: 13, windDirection: 140, precipitation: 0,
      },
    }, 50.7567, 2.5204, 20, now);

    expect(station).toMatchObject({
      stationId: "netatmo-cache-1", source: "netatmo", temperature: 19.2,
      isActive: true,
    });
    expect(station?.measurementTimes).toBeUndefined();
  });

  it("refuse une observation persistée expirée ou non qualifiée", () => {
    const now = Date.parse("2026-08-13T08:00:00.000Z");
    const base = {
      station: {
        stationId: "netatmo-cache-2", source: "netatmo", name: "Station cache", lat: 50.76, lon: 2.52,
        altitude: null, reliabilityScore: 72, updateFrequencyMin: 10, dataAvailability: 0.75,
        isActive: 1, qualificationStatus: "validated", sourceTier: 1,
      },
      observation: {
        observedAt: now - 31 * 60_000, temperature: 19.2, humidity: null, pressure: null,
        windSpeed: null, windGust: null, windDirection: null, precipitation: null,
      },
    };
    expect(mapPersistedNetatmoObservation(base, 50.7567, 2.5204, 20, now)).toBeNull();
    expect(mapPersistedNetatmoObservation({
      ...base,
      observation: { ...base.observation, observedAt: now - 5 * 60_000 },
      station: { ...base.station, qualificationStatus: "candidate" },
    }, 50.7567, 2.5204, 20, now)).toBeNull();
  });
});

import { describe, expect, it } from "vitest";
import {
  buildSingleRunRequestUrl,
  DIRECT_SINGLE_RUN_METADATA_MODEL_IDS,
  evaluateProviderRunForecasts,
  parseProviderRunHourlyResponse,
  resolveProviderRunSelection,
  SINGLE_RUN_AVAILABILITY_SAFETY_DELAY_MS,
  type ProviderRunForecastValue,
} from "./providerRunHorizon";
import { PROVIDER_RUN_MODEL_CAPABILITIES } from "./providerRunCapabilities";
import { parisLocalHourToUniqueEpochMs } from "./parisHourlyTime";

const locationKey = "50.123_2.456";
const runAt = Date.parse("2026-10-04T15:00:00.000Z");
const metadataAt = Date.parse("2026-10-04T17:00:00.000Z");
const requestStartedAt = Date.parse("2026-10-04T17:15:00.000Z");
const availableAt = Date.parse("2026-10-04T17:20:00.000Z");
const validTime = Date.parse("2026-10-04T19:00:00.000Z");

function value(overrides: Partial<ProviderRunForecastValue> = {}): ProviderRunForecastValue {
  return {
    id: 11,
    captureRunId: "capture-a",
    locationKey,
    targetDate: "2026-10-04",
    modelName: "AROME",
    modelId: DIRECT_SINGLE_RUN_METADATA_MODEL_IDS.AROME,
    metadataAvailableAt: metadataAt,
    providerRunAt: runAt,
    requestStartedAt,
    availableAt,
    validTime,
    forecastLeadTimeMilliseconds: validTime - runAt,
    collectionLatencyMilliseconds: availableAt - runAt,
    variable: "temperature",
    value: 19,
    unit: "°C",
    ...overrides,
  };
}

describe("provider-run horizon provenance", () => {
  it("décrit les sept modèles sans assimiler les alias GFS/GEM à d’autres IDs", () => {
    expect(PROVIDER_RUN_MODEL_CAPABILITIES).toHaveLength(7);
    expect(PROVIDER_RUN_MODEL_CAPABILITIES.map((capability) => capability.modelName))
      .toEqual(["AROME", "ARPEGE", "ICON", "ECMWF", "GFS", "GEM", "UKMET"]);
    expect(PROVIDER_RUN_MODEL_CAPABILITIES.every((capability) => capability.documentedCalibrationVariables.length === 10))
      .toBe(true);
    expect(Object.keys(DIRECT_SINGLE_RUN_METADATA_MODEL_IDS).sort())
      .toEqual(["AROME", "ARPEGE", "ECMWF", "ICON", "UKMET"]);
    expect(DIRECT_SINGLE_RUN_METADATA_MODEL_IDS).toMatchObject({
      AROME: "meteofrance_arome_france_hd",
      ARPEGE: "meteofrance_arpege_europe",
      ICON: "dwd_icon_eu",
      ECMWF: "ecmwf_ifs025",
      UKMET: "ukmo_seamless",
    });
    expect(PROVIDER_RUN_MODEL_CAPABILITIES.find((capability) => capability.modelName === "GFS"))
      .toMatchObject({
        forecastModelId: "gfs_seamless",
        openMeteoModelId: "ncep_gfs_seamless",
        appIdMatchesDocumentedId: false,
        singleRunEndpointSupportedForDocumentedId: true,
        metadataMappingVerified: true,
      });
    expect(PROVIDER_RUN_MODEL_CAPABILITIES.find((capability) => capability.modelName === "GEM"))
      .toMatchObject({
        forecastModelId: "gem_seamless",
        openMeteoModelId: "cmc_gem_seamless",
        appIdMatchesDocumentedId: false,
        singleRunEndpointSupportedForDocumentedId: true,
        metadataMappingVerified: true,
      });
  });

  it("sélectionne le dernier cycle publié à partir des métadonnées, après le délai prudent de 10 minutes", () => {
    const selected = resolveProviderRunSelection({
      modelName: "AROME",
      modelId: DIRECT_SINGLE_RUN_METADATA_MODEL_IDS.AROME,
      metadata: {
        last_run_initialisation_time: runAt / 1000,
        last_run_availability_time: metadataAt / 1000,
        update_interval_seconds: 21_600,
      },
      now: requestStartedAt,
    });
    expect(selected.status).toBe("selected");
    expect(selected.providerRunAt).toBe(runAt);
    expect(selected.metadataAvailableAt).toBe(metadataAt);
    expect(selected.runParameter).toBe("2026-10-04T15:00");
    expect(selected.metadataUrl).toContain("/meteofrance_arome_france_hd/static/meta.json");

    const ukmet = resolveProviderRunSelection({
      modelName: "UKMET",
      modelId: DIRECT_SINGLE_RUN_METADATA_MODEL_IDS.UKMET,
      locationKey: "50.757_2.520",
      metadata: {components: ["ukmo_global_deterministic_10km", "ukmo_uk_deterministic_2km"].map(modelId => ({modelId, metadata: {
        last_run_initialisation_time: runAt / 1000, last_run_availability_time: metadataAt / 1000,
        update_interval_seconds: 21_600, data_end_time: (validTime + 86400000) / 1000,
      }}))},
      now: requestStartedAt,
    });
    expect(ukmet.status).toBe("selected");
    expect(ukmet.metadataUrl).toContain("/ukmo_global_deterministic_10km/static/meta.json");
  });

  it("n’envoie aucune requête pour un cycle pas encore répliqué, des métadonnées périmées ou un alias non mappé", () => {
    const common = { modelName: "AROME", modelId: DIRECT_SINGLE_RUN_METADATA_MODEL_IDS.AROME };
    const metadata = {
      last_run_initialisation_time: runAt / 1000,
      last_run_availability_time: metadataAt / 1000,
      update_interval_seconds: 21_600,
    };
    expect(resolveProviderRunSelection({ ...common, metadata, now: metadataAt + SINGLE_RUN_AVAILABILITY_SAFETY_DELAY_MS - 1 }).status)
      .toBe("availability_wait");
    expect(resolveProviderRunSelection({ ...common, metadata, now: metadataAt + 43_201_000 }).status)
      .toBe("metadata_stale");
    const futureRun = resolveProviderRunSelection({
      ...common,
      metadata: {
        last_run_initialisation_time: Date.parse("2026-10-04T19:00:00Z") / 1000,
        last_run_availability_time: Date.parse("2026-10-04T20:00:00Z") / 1000,
        update_interval_seconds: 21_600,
      },
      now: requestStartedAt,
    });
    expect(futureRun.status).toBe("metadata_invalid");
    expect(futureRun.providerRunAt).toBeNull();
    for (const [modelName, modelId] of [["GFS", "gfs_seamless"], ["GEM", "gem_seamless"]]) {
      expect(resolveProviderRunSelection({ modelName, modelId, metadata, now: requestStartedAt }).status)
        .toBe("unmapped_model_id");
    }
  });

  it("garde sans changement l’ID Forecast dans l’URL exacte Single Runs et son run UTC", () => {
    for (const [modelName, modelId] of Object.entries(DIRECT_SINGLE_RUN_METADATA_MODEL_IDS)) {
      const url = new URL(buildSingleRunRequestUrl({ modelName, modelId, latitude: 50.7567, longitude: 2.5204, providerRunAt: runAt }));
      expect(url.origin + url.pathname).toBe("https://single-runs-api.open-meteo.com/v1/forecast");
      expect(url.searchParams.get("models")).toBe(modelId);
      expect(url.searchParams.get("run")).toBe("2026-10-04T15:00");
      expect(url.searchParams.get("timezone")).toBe("UTC");
      expect(url.searchParams.get("forecast_days")).toBe("2");
    }
    for (const [modelName, modelId] of [["GFS", "gfs_seamless"], ["GEM", "gem_seamless"]]) {
      expect(() => buildSingleRunRequestUrl({ modelName, modelId, latitude: 50, longitude: 2, providerRunAt: runAt }))
        .toThrow(/not verified/i);
    }
  });

  it("archive seulement les validTime encore futurs et calcule séparément lead fournisseur et latence de collecte", () => {
    const seconds = (iso: string) => Date.parse(iso) / 1000;
    const parsed = parseProviderRunHourlyResponse({
      responseData: {
        hourly_units: {
          temperature_2m: "°C", precipitation: "mm", wind_speed_10m: "m/s",
          wind_gusts_10m: "km/h", relative_humidity_2m: "%", surface_pressure: "Pa",
        },
        hourly: {
          time: [seconds("2026-10-04T16:00:00Z"), seconds("2026-10-04T17:00:00Z"), seconds("2026-10-04T19:00:00Z")],
          temperature_2m: [16, 17, 19], precipitation: [0.1, 0.2, 0.3],
          wind_speed_10m: [2, 3, 4], wind_gusts_10m: [15, 16, 17],
          relative_humidity_2m: [80, 81, 82], surface_pressure: [101200, 101250, 101325],
        },
      },
      captureRunId: "capture-a",
      locationKey,
      modelName: "AROME",
      modelId: DIRECT_SINGLE_RUN_METADATA_MODEL_IDS.AROME,
      metadataAvailableAt: metadataAt,
      providerRunAt: runAt,
      requestStartedAt,
      availableAt,
    });
    expect(parsed.values).toHaveLength(10);
    expect(new Set(parsed.values.map((row) => row.validTime))).toEqual(new Set([validTime]));
    expect(parsed.nonNullValueCount).toBe(6);
    expect(parsed.values.find((row) => row.variable === "temperature")?.forecastLeadTimeMilliseconds).toBe(4 * 60 * 60_000);
    expect(parsed.values.find((row) => row.variable === "temperature")?.collectionLatencyMilliseconds).toBe(2 * 60 * 60_000 + 20 * 60_000);
    expect(parsed.values.find((row) => row.variable === "pressure")?.value).toBe(1013.25);
    expect(parsed.values[0].targetDate).toBe("2026-10-04");
    const archivedHourly = (parsed.responsePayload as { hourly: Record<string, unknown> }).hourly;
    expect(archivedHourly.time).toEqual([seconds("2026-10-04T19:00:00Z")]);
    expect(archivedHourly.temperature_2m).toEqual([19]);
  });

  it("sépare la pression MSL et les composantes liquides", () => {
    const parsed=parseProviderRunHourlyResponse({responseData:{hourly_units:{pressure_msl:'hPa',surface_pressure:'hPa',precipitation:'mm',rain:'mm',showers:'mm',snowfall:'cm'},hourly:{time:[validTime/1000],pressure_msl:[1015],surface_pressure:[998],precipitation:[.7],rain:[.5],showers:[.2],snowfall:[0]}},captureRunId:'capture-components',locationKey,modelName:'AROME',modelId:DIRECT_SINGLE_RUN_METADATA_MODEL_IDS.AROME,metadataAvailableAt:metadataAt,providerRunAt:runAt,requestStartedAt,availableAt});
    const get=(name:string)=>parsed.values.find(row=>row.variable===name);
    expect(get('pressure_msl')).toMatchObject({value:1015,unit:'hPa'});
    expect(get('pressure')).toMatchObject({value:998,unit:'hPa'});
    expect(get('rain')).toMatchObject({value:.5,unit:'mm'});
    expect(get('showers')).toMatchObject({value:.2,unit:'mm'});
    expect(get('snowfall')).toMatchObject({value:0,unit:'cm'});
    expect(parsed.nonNullValueCount).toBe(6);
  });

  it("ne note pas de futur lorsque tous les validTime sont déjà échus à la réception", () => {
    const parsed = parseProviderRunHourlyResponse({
      responseData: { hourly_units: { temperature_2m: "°C" }, hourly: { time: [Date.parse("2026-10-04T17:00:00Z") / 1000], temperature_2m: [18] } },
      captureRunId: "capture-a", locationKey, modelName: "AROME", modelId: DIRECT_SINGLE_RUN_METADATA_MODEL_IDS.AROME,
      metadataAvailableAt: metadataAt, providerRunAt: runAt, requestStartedAt, availableAt,
    });
    expect(parsed.values).toEqual([]);
    expect((parsed.responsePayload as { hourly: { time: unknown[] } }).hourly.time).toEqual([]);
  });

  it("archive explicitement les nulls et champs absents sans fabriquer une prévision", () => {
    const parsed = parseProviderRunHourlyResponse({
      responseData: {
        hourly_units: { temperature_2m: "°C" },
        hourly: { time: [validTime / 1000], temperature_2m: [null] },
      },
      captureRunId: "capture-null",
      locationKey,
      modelName: "AROME",
      modelId: DIRECT_SINGLE_RUN_METADATA_MODEL_IDS.AROME,
      metadataAvailableAt: metadataAt,
      providerRunAt: runAt,
      requestStartedAt,
      availableAt,
    });
    expect(parsed.values).toHaveLength(10);
    expect(parsed.nonNullValueCount).toBe(0);
    expect(parsed.values.every((row) => row.value === null)).toBe(true);
  });

  it("calcule l’erreur brute à l’heure exacte, déduplique les relectures et exclut tout reçu à l’heure d’observation ou après", () => {
    const observationAt = parisLocalHourToUniqueEpochMs("2026-10-04", 21)!;
    expect(observationAt).toBe(validTime);
    const snapshot = {
      id: 902,
      locationKey,
      date: "2026-10-04",
      hour: 21,
      stationCount: 2,
      temperature: 20,
      precipitation: 0.2,
      windSpeed: 14.4,
      windGust: 17,
      humidity: 82,
      pressure: 1013.25,
      confidenceScore: 0.9,
      stationsUsed: ["station-a", "station-b"],
      collectedAt: observationAt + 10 * 60_000,
    };
    const evaluation = evaluateProviderRunForecasts([snapshot], [
      value(),
      value({ id: 12, captureRunId: "capture-replay", availableAt: availableAt + 5 * 60_000, requestStartedAt: requestStartedAt + 5 * 60_000 }),
      value({ id: 13, captureRunId: "capture-leak-equal", availableAt: observationAt, requestStartedAt: observationAt - 5 * 60_000 }),
      value({ id: 14, captureRunId: "capture-leak-after", availableAt: observationAt + 1, requestStartedAt: observationAt - 5 * 60_000 }),
      value({ id: 15, captureRunId: "capture-wrong-lead", forecastLeadTimeMilliseconds: 60 * 60_000 }),
      value({ id: 17, captureRunId: "capture-unmapped-model", modelName: "GFS", modelId: "gfs_seamless" }),
      value({ id: 18, captureRunId: "capture-mismatched-model-id", modelName: "AROME", modelId: "ecmwf_ifs025" }),
      value({
        id: 16,
        captureRunId: "capture-null-opportunity",
        providerRunAt: Date.parse("2026-10-04T16:00:00.000Z"),
        forecastLeadTimeMilliseconds: 3 * 60 * 60_000,
        collectionLatencyMilliseconds: availableAt - Date.parse("2026-10-04T16:00:00.000Z"),
        value: null,
      }),
    ]);

    const temperatureAtFourHours = evaluation.scores.find((score) => score.variable === "temperature" && score.forecastLeadTimeMilliseconds === 4 * 60 * 60_000);
    expect(evaluation.comparisons).toHaveLength(1);
    expect(evaluation.comparisons[0].leadBasis).toBe("provider_run");
    expect(evaluation.comparisons[0].providerRunAt).toBe(runAt);
    expect(evaluation.comparisons[0].availableAt).toBe(availableAt);
    expect(evaluation.comparisons[0].signedError).toBe(-1);
    expect(temperatureAtFourHours).toMatchObject({ observationCount: 1, evaluableObservationCount: 1, sampleSize: 1, mae: 1, rmse: 1, bias: -1 });
    expect(evaluation.scores.find((score) => score.variable === "temperature" && score.forecastLeadTimeMilliseconds === 3 * 60 * 60_000))
      .toMatchObject({ sampleSize: 0, evaluableObservationCount: 1, mae: null });
  });

  it("n’évalue pas une heure locale répétée au changement d’heure sans validTime unique", () => {
    const fallValidTime = Date.parse("2026-10-25T00:00:00.000Z");
    const fallRunAt = Date.parse("2026-10-24T18:00:00.000Z");
    const fallMetadataAt = Date.parse("2026-10-24T20:00:00.000Z");
    const fallRequestAt = fallMetadataAt + SINGLE_RUN_AVAILABILITY_SAFETY_DELAY_MS;
    const fallAvailableAt = fallRequestAt + 60_000;
    const evaluation = evaluateProviderRunForecasts([{
      id: 99,
      locationKey,
      date: "2026-10-25",
      hour: 2,
      stationCount: 1,
      temperature: 12,
    }], [value({
      id: 98,
      captureRunId: "capture-fall-back",
      targetDate: "2026-10-25",
      providerRunAt: fallRunAt,
      metadataAvailableAt: fallMetadataAt,
      requestStartedAt: fallRequestAt,
      availableAt: fallAvailableAt,
      validTime: fallValidTime,
      forecastLeadTimeMilliseconds: fallValidTime - fallRunAt,
      collectionLatencyMilliseconds: fallAvailableAt - fallRunAt,
    })]);
    expect(evaluation.comparisons).toEqual([]);
    expect(evaluation.scores).toEqual([]);
  });

  it("diagnostique Single Runs selon ses horodatages propres, sans seuil measurementTime des stations", () => {
    const snapshot = {
      id: 902,
      locationKey,
      date: "2026-10-04",
      hour: 21,
      stationCount: 2,
      temperature: 20,
      precipitation: 0.2,
      windSpeed: 14.4,
      windGust: 17,
      humidity: 82,
      pressure: 1013.25,
      stationsUsed: ["station-a", "station-b"],
    };
    const earlierRunAt = runAt - 60 * 60_000;
    const evaluation = evaluateProviderRunForecasts([snapshot], [
      value(),
      value({
        id: 19,
        captureRunId: "null-single-run-value",
        providerRunAt: earlierRunAt,
        forecastLeadTimeMilliseconds: validTime - earlierRunAt,
        collectionLatencyMilliseconds: availableAt - earlierRunAt,
        value: null,
      }),
      value({ id: 20, captureRunId: "received-at-valid-time", availableAt: validTime }),
    ]);
    const diagnostic = evaluation.diagnostics.find(({ variable }) => variable === "temperature");

    expect(diagnostic).toMatchObject({
      path: "single_runs",
      archivedForecasts: 3,
      opportunitiesAtSameLocationAndValidTime: 2,
      qualifiedPhysicalObservationsPresent: 2,
      temporallyAdmissible: 2,
      admissiblePairs: 1,
      retainedComparisons: 1,
      firstRejectionCounts: {
        FORECAST_AVAILABLE_AT_OR_AFTER_VALID_TIME: 1,
        FORECAST_VALUE_MISSING_OR_NONFINITE: 1,
      },
    });
    expect(diagnostic?.temporalRule).toContain("station measurementTime is not an input");
    expect(evaluation.comparisons).toHaveLength(1);
    expect(evaluation.comparisons[0]).toMatchObject({ leadBasis: "provider_run", providerRunAt: runAt });
  });
});

import { describe, expect, it } from "vitest";
import { loadDetailedForecastSources } from "./detailedForecastLoading";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

type Hour = { validAt: number; temp: number };

describe("chargement des sources des prévisions détaillées", () => {
  it("démarre les lectures indépendantes ensemble et conserve leurs résultats", async () => {
    const snapshotRequest = deferred<{ hourly: Hour[]; daily: string[] }>();
    const extendedRequest = deferred<Hour[]>();
    const metadataRequest = deferred<{ regime: string }>();
    const fallbackRequest = deferred<{ hours: Hour[]; diagnostics: string[] }>();
    const calls: string[] = [];
    let fallbackInput: Hour[] | undefined;

    const resultPromise = loadDetailedForecastSources({
      loadSnapshot: () => { calls.push("snapshot"); return snapshotRequest.promise; },
      includeExtendedPeriods: true,
      loadExtendedPeriods: () => { calls.push("extended"); return extendedRequest.promise; },
      loadMetadata: () => { calls.push("metadata"); return metadataRequest.promise; },
      loadHourlyFallback: (hours) => {
        calls.push("fallback");
        fallbackInput = hours;
        return fallbackRequest.promise;
      },
    });

    expect(calls).toEqual(["snapshot", "extended", "metadata"]);

    const officialHours = [{ validAt: 1, temp: 12 }];
    const snapshot = { hourly: officialHours, daily: ["day"] };
    snapshotRequest.resolve(snapshot);
    await Promise.resolve();
    expect(calls).toEqual(["snapshot", "extended", "metadata", "fallback"]);
    expect(fallbackInput).toBe(officialHours);

    const extendedHours = [{ validAt: 2, temp: 13 }];
    const metadata = { regime: "stable" };
    const fallback = { hours: [{ validAt: 1, temp: 12 }], diagnostics: ["unchanged"] };
    extendedRequest.resolve(extendedHours);
    metadataRequest.resolve(metadata);
    fallbackRequest.resolve(fallback);

    await expect(resultPromise).resolves.toEqual({
      snapshot,
      periodHours: extendedHours,
      metadata,
      hourlyFallback: fallback,
    });
  });

  it("n’ajoute pas un second tableau d’heures lorsque les périodes étendues sont désactivées", async () => {
    const officialHours = [{ validAt: 1, temp: 12 }];
    let extendedCalled = false;

    const result = await loadDetailedForecastSources({
      loadSnapshot: async () => ({ hourly: officialHours }),
      includeExtendedPeriods: false,
      loadExtendedPeriods: async () => { extendedCalled = true; return []; },
      loadMetadata: async () => null,
      loadHourlyFallback: async (hours) => ({ hours }),
    });

    expect(extendedCalled).toBe(false);
    expect(result).not.toHaveProperty("periodHours");
    expect(result.hourlyFallback).toEqual({ hours: officialHours });
  });

  it("propage une erreur de source sans la masquer", async () => {
    const sourceError = new Error("source indisponible");
    const resultPromise = loadDetailedForecastSources({
      loadSnapshot: async () => ({ hourly: [] as Hour[] }),
      includeExtendedPeriods: true,
      loadExtendedPeriods: async () => { throw sourceError; },
      loadMetadata: async () => null,
      loadHourlyFallback: async (hours) => ({ hours }),
    });

    await expect(resultPromise).rejects.toBe(sourceError);
  });
});

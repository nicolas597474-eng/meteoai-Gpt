import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  archiveRows: vi.fn(),
  archiveHistory: vi.fn(),
  current: vi.fn(),
  daily: vi.fn(),
  hourly: vi.fn(),
  reconstruct: vi.fn(),
  compute: vi.fn(),
}));

vi.mock("./db", () => ({
  makeLocationKey: (lat: number, lon: number) => `${lat.toFixed(3)},${lon.toFixed(3)}`,
  getHourlyForecastRunValues: mocks.archiveRows,
  getHourlyForecastEvaluationHistory: mocks.archiveHistory,
  getDailyFusionPerformanceEvidence: vi.fn(),
}));

vi.mock("./weatherTime", () => ({
  getParisDate: () => "2026-10-12",
  getParisDateDaysAgo: () => "2026-10-11",
  getParisHour: () => 12,
}));

vi.mock("./weatherServices", () => ({
  collectCurrentWeatherSnapshot: mocks.current,
  collect15DayForecast: mocks.daily,
}));

vi.mock("./officialHourlyForecast", () => ({
  OFFICIAL_HOURLY_HISTORY_DAYS: 365,
  OFFICIAL_HOURLY_MODEL_NAMES: ["AROME", "ARPEGE", "ICON", "ECMWF", "GFS", "GEM", "UKMET"],
  collectOfficialHourlyForecast: mocks.hourly,
  reconstructOfficialHourlyModelsFromArchive: mocks.reconstruct,
  computeOfficialHourlyForecast: mocks.compute,
}));

vi.mock("./officialForecast", () => ({
  computeOfficialDailyForecastWithDiagnostics: vi.fn(),
}));

import { resolveOfficialWeatherSnapshot, resolveOfficialDailyForecastSnapshot } from "./officialWeatherSnapshot";

const weighting = {
  status: "unavailable" as const,
  availabilityStatus: "UNAVAILABLE" as const,
  calibrationStatus: "UNAVAILABLE" as const,
  historyStatus: "unavailable" as const,
  historyWindowDays: 365,
  minimumComparisons: 30,
  minimumComparableDays: 7,
  bestMatchIncluded: false as const,
  modelsConsidered: [],
  modelsWithData: [],
  horizons: [],
};

const currentSnapshot = {
  sourceKind: "model_current_snapshot" as const,
  source: "open-meteo" as const,
  capturedAt: "2026-10-12T12:00:00.000Z",
  temp: 18,
  apparentTemp: 18,
  precipitation: 0,
  windSpeed: 5,
  windGust: 7,
  windDirection: 180,
  cloudCover: 20,
  humidity: 60,
  weatherCode: 1,
  condition: "Ensoleillé",
};

const hourlyPoint = {
  date: "2026-10-12",
  hour: "14:00",
  validAt: Date.parse("2026-10-12T12:00:00.000Z"),
  temp: 18,
  apparentTemp: 18,
  precipitation: 0,
  windSpeed: 5,
  windGust: 7,
  windDirection: 180,
  cloudCover: 20,
  humidity: 60,
  uvIndex: 2,
  condition: "Ensoleillé",
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

beforeEach(() => {
  vi.useFakeTimers({ now: new Date("2026-10-12T12:00:00.000Z") });
  mocks.archiveRows.mockReset();
  mocks.archiveHistory.mockReset();
  mocks.current.mockReset();
  mocks.daily.mockReset();
  mocks.hourly.mockReset();
  mocks.reconstruct.mockReset();
  mocks.compute.mockReset();
  mocks.compute.mockReturnValue({ hours: [], weighting });
});

afterEach(() => vi.useRealTimers());

describe("resolveOfficialWeatherSnapshot interactive budget", () => {
  it("returns an explicit not_ready empty hourly response before 7.5s when archive DB and current snapshot stall", async () => {
    mocks.archiveRows.mockImplementation(() => new Promise(() => undefined));
    mocks.archiveHistory.mockImplementation(() => new Promise(() => undefined));
    mocks.current.mockImplementation(() => new Promise(() => undefined));
    mocks.hourly.mockImplementation(() => new Promise(() => undefined));

    const pending = resolveOfficialWeatherSnapshot({ lat: 51.001, lon: 2.001 }, { includeDaily: false });
    await vi.advanceTimersByTimeAsync(7_100);
    const snapshot = await pending;

    expect(Date.now() - Date.parse("2026-10-12T12:00:00.000Z")).toBeLessThan(7_500);
    expect(snapshot).toMatchObject({
      snapshotStatus: "live",
      hourlyStatus: "not_ready",
      hourly: [],
      currentSnapshot: null,
      validAt: null,
    });
    // The deadline is established before archive I/O: a late provider must not
    // publish values after the response budget was already spent.
    expect(mocks.hourly).toHaveBeenCalledWith(expect.any(String), expect.anything(), expect.objectContaining({
      deadlineAt: Date.parse("2026-10-12T12:00:07.000Z"),
    }));
  });

  it("keeps real current values when both historical I/O and the hourly provider stall", async () => {
    mocks.archiveRows.mockImplementation(() => new Promise(() => undefined));
    mocks.archiveHistory.mockImplementation(() => new Promise(() => undefined));
    mocks.current.mockResolvedValue(currentSnapshot);
    mocks.hourly.mockImplementation(() => new Promise(() => undefined));

    const pending = resolveOfficialWeatherSnapshot({ lat: 51.004, lon: 2.004 }, { includeDaily: false });
    await vi.advanceTimersByTimeAsync(7_100);

    await expect(pending).resolves.toMatchObject({
      hourlyStatus: "not_ready",
      hourly: [],
      validAt: null,
      currentSnapshot,
    });
  });

  it("returns before 7.5s when the live hourly provider stalls, without inventing hourly values", async () => {
    mocks.archiveRows.mockResolvedValue([]);
    mocks.archiveHistory.mockResolvedValue({ available: true, rows: [], exactAvailable: false, exactRows: [] });
    mocks.reconstruct.mockReturnValue([]);
    mocks.current.mockImplementation(() => new Promise(() => undefined));
    mocks.hourly.mockImplementation(() => new Promise(() => undefined));

    const pending = resolveOfficialWeatherSnapshot({ lat: 51.005, lon: 2.005 }, { includeDaily: false });
    await vi.advanceTimersByTimeAsync(7_100);

    await expect(pending).resolves.toMatchObject({
      snapshotStatus: "live",
      hourlyStatus: "not_ready",
      hourly: [],
      validAt: null,
      currentSnapshot: null,
    });
  });

  it("keeps a proven archived hourly series explicitly stale while a refresh is pending", async () => {
    mocks.archiveRows.mockResolvedValue([{}]);
    mocks.archiveHistory.mockResolvedValue({ available: true, rows: [], exactAvailable: false, exactRows: [] });
    mocks.current.mockResolvedValue(currentSnapshot);
    mocks.reconstruct.mockReturnValue([{ modelName: "AROME", availableAt: Date.now(), hours: [hourlyPoint] }]);
    mocks.compute.mockReturnValue({ hours: [hourlyPoint], weighting });
    const refresh = deferred<{ hours: typeof hourlyPoint[]; weighting: typeof weighting; modelForecasts: [] }>();
    mocks.hourly.mockReturnValue(refresh.promise);

    const snapshot = await resolveOfficialWeatherSnapshot({ lat: 51.002, lon: 2.002 }, { includeDaily: false });

    expect(snapshot).toMatchObject({
      snapshotStatus: "stale",
      staleReason: "archived_hourly_run",
      hourlyStatus: "ready",
      hourly: [expect.objectContaining({ temp: 18 })],
    });
    expect(mocks.hourly).toHaveBeenCalledTimes(1);
    refresh.resolve({ hours: [hourlyPoint], weighting, modelForecasts: [] });
  });

  it("rejects an aborted consumer immediately but lets another consumer receive the same bounded singleflight", async () => {
    mocks.archiveRows.mockResolvedValue([]);
    mocks.archiveHistory.mockResolvedValue({ available: true, rows: [], exactAvailable: false, exactRows: [] });
    mocks.reconstruct.mockReturnValue([]);
    mocks.current.mockResolvedValue(currentSnapshot);
    const provider = deferred<{ hours: typeof hourlyPoint[]; weighting: typeof weighting; modelForecasts: [] }>();
    mocks.hourly.mockImplementation((_date: string, _coords: unknown, options: { signal?: AbortSignal }) => {
      expect(options.signal?.aborted).not.toBe(true);
      return provider.promise;
    });
    const controller = new AbortController();
    const first = resolveOfficialWeatherSnapshot({ lat: 51.003, lon: 2.003 }, { includeDaily: false, signal: controller.signal });
    const second = resolveOfficialWeatherSnapshot({ lat: 51.003, lon: 2.003 }, { includeDaily: false });

    controller.abort();
    await expect(first).rejects.toMatchObject({ name: "AbortError" });
    provider.resolve({ hours: [hourlyPoint], weighting, modelForecasts: [] });

    await expect(second).resolves.toMatchObject({
      hourlyStatus: "ready",
      hourly: [expect.objectContaining({ temp: 18 })],
      currentSnapshot,
    });
    expect(mocks.hourly).toHaveBeenCalledTimes(1);
  });
  it("serves live hourly values without waiting for a stalled archive", async () => {
    mocks.archiveRows.mockImplementation(() => new Promise(() => undefined));
    mocks.archiveHistory.mockImplementation(() => new Promise(() => undefined));
    mocks.current.mockResolvedValue(currentSnapshot);
    mocks.hourly.mockResolvedValue({hours: [hourlyPoint], weighting, modelForecasts: []});
    await expect(resolveOfficialWeatherSnapshot({lat: 52.2, lon: 3.2})).resolves.toMatchObject({hourlyStatus: "ready", hourly: [expect.objectContaining({temp: 18})]});
    expect(mocks.hourly).toHaveBeenCalledTimes(1);
  });
  it("retains real daily results arriving after the first display deadline", async () => {
    const late = deferred<{ days: Array<{date: string}>; modelsUsed: string[] }>();
    mocks.daily.mockReturnValue(late.promise);
    const first = resolveOfficialDailyForecastSnapshot({lat: 52.1, lon: 3.1});
    await vi.advanceTimersByTimeAsync(7_100);
    await expect(first).resolves.toMatchObject({dailyStatus: "not_ready", daily: []});
    late.resolve({days: [{date: "2026-10-12"}], modelsUsed: ["AROME"]});
    await vi.advanceTimersByTimeAsync(0);
    await expect(resolveOfficialDailyForecastSnapshot({lat: 52.1, lon: 3.1})).resolves.toMatchObject({dailyStatus: "ready", daily: [{date: "2026-10-12"}]});
    expect(mocks.daily).toHaveBeenCalledTimes(1);
  });
});

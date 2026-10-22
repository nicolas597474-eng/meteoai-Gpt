import { describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ current: vi.fn(), stations: vi.fn(), official: vi.fn(), build: vi.fn() }));
vi.mock("../weatherServices", async () => ({ ...(await vi.importActual<typeof import("../weatherServices")>("../weatherServices")), collectCurrentWeatherSnapshot: mocks.current }));
vi.mock("../stationService", async () => ({ ...(await vi.importActual<typeof import("../stationService")>("../stationService")), collectNearbyStations: mocks.stations }));
vi.mock("../officialWeatherSnapshot", async () => ({ ...(await vi.importActual<typeof import("../officialWeatherSnapshot")>("../officialWeatherSnapshot")), resolveOfficialWeatherSnapshot: mocks.official }));
vi.mock("../currentDashboardWeather", () => ({ buildCurrentDashboardWeatherState: mocks.build }));
import { favoritesRouter } from "./favorites";

describe("present conditions short read path", () => {
 it("does not wait for full hourly fusion and keeps provenance without raw diagnostics", async () => {
  const snapshot = { temperature: 12, observedAt: "2026-10-12T07:00:00Z" };
  mocks.current.mockResolvedValue(snapshot);
  mocks.stations.mockResolvedValue([]);
  mocks.build.mockReturnValue({ computedAt: "2026-10-12T07:00:00Z", fields: { temperature: { value: 12, observations: [{ value: 12 }], provenance: { kind: "open_meteo_snapshot", label: "Open-Meteo" } } } });
  const caller = favoritesRouter.createCaller({ user: null, req: {} as any, res: {} as any });
  const result = await caller.getCurrentDashboardWeather({ lat: 50.76, lon: 2.52 });
  expect(mocks.current).toHaveBeenCalledWith({ lat: 50.76, lon: 2.52 });
  expect(mocks.official).not.toHaveBeenCalled();
  expect(mocks.build).toHaveBeenCalledWith(expect.objectContaining({ snapshot }));
  expect(result.fields.temperature.value).toBe(12);
  expect(result.fields.temperature.provenance.kind).toBe("open_meteo_snapshot");
  expect(result.fields.temperature).not.toHaveProperty("observations");
 });
});

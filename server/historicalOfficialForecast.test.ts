import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ reconstruct: vi.fn(), compute: vi.fn() }));
vi.mock("./officialHourlyForecast", () => ({ reconstructOfficialHourlyModelsFromArchive: mocks.reconstruct, computeOfficialHourlyForecast: mocks.compute }));
import { reconstructHistoricalOfficialTemperatures } from "./historicalOfficialForecast";
const at = Date.parse("2026-10-12T08:00:00Z");
const readings = [{ stationId: "synthetic", observedAt: at + 10 * 60000, temperature: 10, distanceKm: 1, reliabilityScore: 90 }];

beforeEach(() => {
 vi.clearAllMocks();
 mocks.reconstruct.mockImplementation((rows: any[]) => [{ availableAt: Math.max(...rows.map(r => r.availableAt)) }]);
 mocks.compute.mockReturnValue({ hours: [{ validAt: at, temp: 11 }] });
});
describe("historical official reconstruction", () => {
 it("rejects captures after validity and scores calculated after the forecast receipt", () => {
  const before = { validTime: at, availableAt: at - 60000 };
  const after = { validTime: at, availableAt: at + 60000 };
  const scores = [ { computedAt: new Date(at - 120000) }, { computedAt: new Date(at) } ];
  const result = reconstructHistoricalOfficialTemperatures(readings, [before, after] as any, scores as any);
  expect(mocks.reconstruct.mock.calls[0][0]).toEqual([before]);
  expect(mocks.compute.mock.calls[0][1]).toEqual([scores[0]]);
  expect(result).toEqual([{ validAt: at, temperature: 11, availableAt: before.availableAt }]);
 });
 it("returns no retrospective value when all runs are late, equal or unknown", () => {
  for (const availableAt of [at, at + 1, NaN]) {
   expect(reconstructHistoricalOfficialTemperatures(readings, [{ validTime: at, availableAt }] as any, [])).toEqual([]);
  }
  expect(mocks.compute).not.toHaveBeenCalled();
 });
 it("does not replace missing availability or unknown score availability", () => {
  mocks.reconstruct.mockReturnValue([{ availableAt: undefined }]);
  expect(reconstructHistoricalOfficialTemperatures(readings, [{ validTime: at, availableAt: at - 1 }] as any, [])).toEqual([]);
  expect(mocks.compute).not.toHaveBeenCalled();
 });
});

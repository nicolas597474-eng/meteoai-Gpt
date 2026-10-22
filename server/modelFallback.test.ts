import { describe, expect, it } from "vitest";
import { buildOfficialModelFallback } from "./modelFallback";

describe("buildOfficialModelFallback", () => {
  const references = [
    { name: "AROME", temperature: 29.4 },
    { name: "ARPEGE", temperature: 31.3 },
    { name: "ICON", temperature: 29.6 },
  ];

  it("utilise les seuls poids de température présents dans la trace officielle", () => {
    const result = buildOfficialModelFallback(references, {
      trace: { parameterSources: { temperature: [
        { name: "AROME", finalWeight: 0.2 },
        { name: "ARPEGE", finalWeight: 0.7 },
        { name: "ICON", finalWeight: 0.1 },
      ] } },
    });
    expect(result).toEqual(expect.objectContaining({ temperature: 30.8, modelCount: 3, method: "official_trace_temperature_weights" }));
    expect(result?.contributors.map((source) => source.weight)).toEqual([0.2, 0.7, 0.1]);
  });

  it("refuse de fabriquer un consensus sans poids officiels exploitables", () => {
    expect(buildOfficialModelFallback(references, null)).toBeNull();
    expect(buildOfficialModelFallback(references, { trace: { parameterSources: { temperature: [{ name: "AROME", finalWeight: 1 }] } } })).toBeNull();
  });
});

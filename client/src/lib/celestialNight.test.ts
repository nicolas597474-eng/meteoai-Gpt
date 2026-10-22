import { describe, expect, it } from "vitest";
import { isNightAtLocalMinutes } from "./celestialNight";

describe("isNightAtLocalMinutes", () => {
  const sunrise = "2026-08-16T06:39";
  const sunset = "2026-08-16T21:09";

  it("active le thème nocturne avant le lever et à partir du coucher", () => {
    expect(isNightAtLocalMinutes(sunrise, sunset, 6 * 60 + 38)).toBe(true);
    expect(isNightAtLocalMinutes(sunrise, sunset, 12 * 60)).toBe(false);
    expect(isNightAtLocalMinutes(sunrise, sunset, 21 * 60 + 9)).toBe(true);
  });

  it("conserve le thème de jour lorsque les horaires réels manquent", () => {
    expect(isNightAtLocalMinutes(null, sunset, 23 * 60)).toBe(false);
  });
});

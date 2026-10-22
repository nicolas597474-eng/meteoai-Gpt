import { describe, expect, it } from "vitest";
import { isEclipseInProgress } from "./eclipseStatus";

describe("isEclipseInProgress", () => {
  const start = "2026-08-28T02:00:00.000Z";
  const end = "2026-08-28T05:00:00.000Z";

  it("reste inactif avant et après la fenêtre d’éclipse", () => {
    expect(isEclipseInProgress(start, end, Date.parse("2026-08-28T01:59:59.000Z"))).toBe(false);
    expect(isEclipseInProgress(start, end, Date.parse("2026-08-28T05:00:01.000Z"))).toBe(false);
  });

  it("s’active exactement pendant la fenêtre locale", () => {
    expect(isEclipseInProgress(start, end, Date.parse("2026-08-28T03:30:00.000Z"))).toBe(true);
  });

  it("ne déclenche pas d’animation sans circonstances complètes", () => {
    expect(isEclipseInProgress(null, end)).toBe(false);
    expect(isEclipseInProgress(start, null)).toBe(false);
  });
});

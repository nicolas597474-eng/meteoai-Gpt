import { describe, expect, it } from "vitest";
import { isEclipseStartDue } from "./eclipseStartAlert";

describe("isEclipseStartDue", () => {
  const start = "2026-08-28T02:00:00.000Z";
  const end = "2026-08-28T05:00:00.000Z";

  it("ne signale rien avant le début exact", () => {
    expect(isEclipseStartDue(start, end, Date.parse("2026-08-28T01:59:59.000Z"))).toBe(false);
  });

  it("autorise une alerte unique pendant la fenêtre locale de l’éclipse", () => {
    expect(isEclipseStartDue(start, end, Date.parse("2026-08-28T02:00:00.000Z"))).toBe(true);
    expect(isEclipseStartDue(start, end, Date.parse("2026-08-28T03:00:00.000Z"))).toBe(true);
  });

  it("reste silencieux sans circonstances complètes ou après la fin", () => {
    expect(isEclipseStartDue(null, end)).toBe(false);
    expect(isEclipseStartDue(start, null)).toBe(false);
    expect(isEclipseStartDue(start, end, Date.parse("2026-08-28T05:00:01.000Z"))).toBe(false);
  });
});

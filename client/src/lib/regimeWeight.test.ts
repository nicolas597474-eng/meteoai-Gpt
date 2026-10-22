import { describe, expect, it } from "vitest";

describe("pondérations de régime incomplètes", () => {
  it("doit pouvoir être indiquée sans erreur lorsque les poids sont absents", () => {
    const weights: Record<string, number> | undefined = undefined;
    const format = (value: unknown) => typeof value === "number" && Number.isFinite(value) ? `${Math.round(value * 100)}%` : "—";

    expect(format(weights?.temp)).toBe("—");
    expect(format(0.25)).toBe("25%");
  });
});

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

describe("TooltipContent", () => {
  it("préserve une marge de collision par défaut autour des bords d’écran", () => {
    const source = readFileSync(new URL("./tooltip.tsx", import.meta.url), "utf8");
    expect(source).toContain("collisionPadding = 12");
    expect(source).toContain("collisionPadding={collisionPadding}");
    expect(source).toContain("w-[min(18rem,calc(100vw-1.5rem))]");
    expect(source).toContain("rounded-xl border border-slate-600");
  });
});

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const styles = readFileSync(new URL("./index.css", import.meta.url), "utf8");

describe("surface 3D des graphiques", () => {
  it("préserve un fond sombre et un contour net sans halo lumineux", () => {
    expect(styles).toContain("linear-gradient(145deg, rgba(11, 19, 32, 0.99), rgba(5, 9, 16, 0.99))");
    expect(styles).toContain("rgba(96, 165, 250, 0.58)");
    expect(styles).toContain("0 0 0 1px rgba(2, 6, 23, 0.88)");
    expect(styles).not.toContain("0 0 26px rgba(37, 99, 235, 0.09)");
  });
});

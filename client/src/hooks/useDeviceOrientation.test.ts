import { describe, expect, it } from "vitest";
import { useDeviceOrientation } from "./useDeviceOrientation";

describe("useDeviceOrientation hook", () => {
  it("est défini et exporte le hook useDeviceOrientation", () => {
    expect(typeof useDeviceOrientation).toBe("function");
  });
});

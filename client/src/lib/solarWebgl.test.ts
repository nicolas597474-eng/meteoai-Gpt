import { describe, expect, it } from "vitest";
import { createSolarSphereVertices, getSolarOrthographicUv, isSolarObservedFace, SOLAR_TEXTURE_MAX_EDGE, SOLAR_TEXTURE_URL } from "./solarWebgl";

const closeVector = (actual: readonly number[], expected: readonly number[], digits = 6) => {
  expect(actual).toHaveLength(expected.length);
  actual.forEach((value, index) => expect(value).toBeCloseTo(expected[index], digits));
};

describe("géométrie solaire WebGL HMI", () => {
  it("mappe les huit directions de la face observée sans seam ni coordonnées hors texture", () => {
    for (let direction = 0; direction < 8; direction += 1) {
      const angle = direction * Math.PI / 4;
      const radius = 0.98;
      const normal = [radius * Math.cos(angle), radius * Math.sin(angle), Math.sqrt(1 - radius * radius)] as const;
      const uv = getSolarOrthographicUv(normal);
      expect(isSolarObservedFace(normal)).toBe(true);
      expect(uv[0]).toBeGreaterThanOrEqual(0);
      expect(uv[0]).toBeLessThanOrEqual(1);
      expect(uv[1]).toBeGreaterThanOrEqual(0);
      expect(uv[1]).toBeLessThanOrEqual(1);
      closeVector(uv, [0.5 + normal[0] / 2, 0.5 + normal[1] / 2]);
    }
  });

  it("centre la projection au centre du disque et ne considère pas l’arrière comme observé", () => {
    closeVector(getSolarOrthographicUv([0, 0, 1]), [0.5, 0.5]);
    expect(isSolarObservedFace([0, 0, 1])).toBe(true);
    expect(isSolarObservedFace([0, 0, -1])).toBe(false);
    expect(isSolarObservedFace([1, 0, 0])).toBe(false);
  });

  it("construit une vraie sphère à normales unitaires et triangles orientés vers l’extérieur", () => {
    const vertices = createSolarSphereVertices();
    expect(vertices.length).toBe(64 * 32 * 6 * 3);

    for (let index = 0; index < vertices.length; index += 3) {
      expect(Math.hypot(vertices[index], vertices[index + 1], vertices[index + 2])).toBeCloseTo(1, 5);
    }

    for (let index = 0; index < vertices.length; index += 9) {
      const a = [vertices[index], vertices[index + 1], vertices[index + 2]];
      const b = [vertices[index + 3], vertices[index + 4], vertices[index + 5]];
      const c = [vertices[index + 6], vertices[index + 7], vertices[index + 8]];
      const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
      const ac = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
      const cross = [ab[1] * ac[2] - ab[2] * ac[1], ab[2] * ac[0] - ab[0] * ac[2], ab[0] * ac[1] - ab[1] * ac[0]];
      const center = [(a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3, (a[2] + b[2] + c[2]) / 3];
      const facing = cross[0] * center[0] + cross[1] * center[1] + cross[2] * center[2];
      if (Math.hypot(...cross) > 1e-8) expect(facing).toBeGreaterThan(0);
    }
  });

  it("borne la texture mobile à 1024 px et utilise uniquement la source HMI approuvée", () => {
    expect(SOLAR_TEXTURE_MAX_EDGE).toBe(1024);
    expect(SOLAR_TEXTURE_URL).toBe("/assets/solar/nasa-hmi-solar-disc-2011.webp");
  });
});

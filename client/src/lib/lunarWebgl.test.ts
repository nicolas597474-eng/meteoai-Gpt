import { describe, expect, it } from "vitest";
import {
  createLunarSphereVertices,
  getLunarEquirectangularCoordinates,
  getLunarSunDirection,
  getLunarTextureBasis,
  projectCameraNormalToLunarBody,
} from "./lunarWebgl";

const closeVector = (actual: readonly number[], expected: readonly number[], digits = 6) => {
  expect(actual).toHaveLength(expected.length);
  actual.forEach((value, index) => expect(value).toBeCloseTo(expected[index], digits));
};

describe("géométrie du globe lunaire WebGL", () => {
  it("pointe la lumière vers le limbe local et respecte la fraction calculée", () => {
    closeVector(getLunarSunDirection(0, 41.3), [0, 0, -1]);
    closeVector(getLunarSunDirection(0.5, 0), [0, 1, 0]);
    closeVector(getLunarSunDirection(0.5, 90), [-1, 0, 0]);
    closeVector(getLunarSunDirection(1, 225), [0, 0, 1]);

    const waxing = getLunarSunDirection(0.15, 42);
    const waning = getLunarSunDirection(0.85, 42);
    expect(waxing[2]).toBeCloseTo(-0.7, 6);
    expect(waning[2]).toBeCloseTo(0.7, 6);
    expect(Math.hypot(...waning)).toBeCloseTo(1, 6);
    expect(waning[0]).toBeLessThan(0);
    expect(waning[1]).toBeGreaterThan(0);
  });

  it("centre la carte sur la face terrestre, longitude zéro, lorsque la libration est nulle", () => {
    const basis = getLunarTextureBasis(0, 0, 0);
    const center = projectCameraNormalToLunarBody([0, 0, 1], basis);
    const centerUv = getLunarEquirectangularCoordinates(center);
    closeVector(center, [1, 0, 0]);
    closeVector(centerUv, [0.5, 0.5]);

    const right = getLunarEquirectangularCoordinates(projectCameraNormalToLunarBody([1, 0, 0], basis));
    const top = getLunarEquirectangularCoordinates(projectCameraNormalToLunarBody([0, 1, 0], basis));
    closeVector(right, [0.75, 0.5]);
    closeVector(top, [0.5, 1]);
  });

  it("déplace le centre de la face selon la libration et oriente le nord lunaire local", () => {
    const basis = getLunarTextureBasis(5, -4, 0);
    const centerUv = getLunarEquirectangularCoordinates(projectCameraNormalToLunarBody([0, 0, 1], basis));
    closeVector(centerUv, [0.5 + 5 / 360, 0.5 - 4 / 180]);

    const rolledNorth = getLunarTextureBasis(0, 0, 90);
    const northUv = getLunarEquirectangularCoordinates(projectCameraNormalToLunarBody([-1, 0, 0], rolledNorth));
    expect(northUv[1]).toBeCloseTo(1, 6);
  });

  it("construit un maillage de sphère à normales unitaires et triangles orientés", () => {
    const vertices = createLunarSphereVertices();
    expect(vertices.length).toBe(48 * 24 * 6 * 3);
    for (let index = 0; index < vertices.length; index += 3) {
      expect(Math.hypot(vertices[index], vertices[index + 1], vertices[index + 2])).toBeCloseTo(1, 5);
    }
    expect(Array.from(vertices).some((_, index) => index % 3 === 2 && vertices[index] > 0.9)).toBe(true);
    expect(Array.from(vertices).some((_, index) => index % 3 === 2 && vertices[index] < -0.9)).toBe(true);
  });
});

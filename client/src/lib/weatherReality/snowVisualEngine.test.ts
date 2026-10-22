import { describe, expect, it } from "vitest";
import {
  createSnowParticles,
  createSnowVisualState,
  getSnowCanvasPixelSize,
  getSnowParticleCount,
  getSnowWindDrift,
  updateSnowParticles,
  writeSnowVertices,
} from "./snowVisualEngine";

describe("snow visual engine", () => {
  it("keeps snow category separate from unknown precipitation amounts", () => {
    const state = createSnowVisualState({
      isSnowCategory: true,
      category: "steady",
      windSpeedKmh: null,
      windDirectionDegrees: null,
    });

    expect(state.isSnowCategory).toBe(true);
    expect(state.windSpeedKmh).toBeNull();
    expect(state.windDirectionDegrees).toBeNull();
    expect(getSnowWindDrift(state)).toBe(0);
  });

  it("bounds the particle load for full, reduced and disabled modes", () => {
    const light = createSnowVisualState({
      isSnowCategory: true,
      category: "light",
    });
    const heavy = createSnowVisualState({
      isSnowCategory: true,
      category: "heavy",
    });
    const absent = createSnowVisualState({
      isSnowCategory: false,
      category: "steady",
    });

    expect(getSnowParticleCount(light, "full", 390)).toBe(16);
    expect(getSnowParticleCount(heavy, "reduced", 390)).toBe(10);
    expect(getSnowParticleCount(heavy, "full", 1200)).toBeLessThanOrEqual(48);
    expect(getSnowParticleCount(heavy, "off", 390)).toBe(0);
    expect(getSnowParticleCount(absent, "full", 390)).toBe(0);
  });

  it("uses deterministic depth, size, speed and rotation variation", () => {
    const first = createSnowParticles(24, "steady");
    const second = createSnowParticles(24, "steady");

    expect(first).toEqual(second);
    expect(new Set(first.map(particle => particle.depth)).size).toBeGreaterThan(
      1
    );
    expect(new Set(first.map(particle => particle.size)).size).toBeGreaterThan(
      1
    );
    expect(
      new Set(first.map(particle => particle.rotationSpeed)).size
    ).toBeGreaterThan(1);
    expect(
      first.every(particle => particle.fallSpeed > 0 && particle.opacity > 0)
    ).toBe(true);
  });

  it("tilts drift with the validated wind direction and ignores invalid values", () => {
    const easterly = createSnowVisualState({
      isSnowCategory: true,
      category: "steady",
      windSpeedKmh: 40,
      windDirectionDegrees: 90,
    });
    const northerly = createSnowVisualState({
      isSnowCategory: true,
      category: "steady",
      windSpeedKmh: 40,
      windDirectionDegrees: 0,
    });
    const invalid = createSnowVisualState({
      isSnowCategory: true,
      category: "steady",
      windSpeedKmh: -1,
      windDirectionDegrees: 361,
    });

    expect(getSnowWindDrift(easterly)).toBeLessThan(0);
    expect(getSnowWindDrift(northerly)).toBeCloseTo(0);
    expect(invalid.windSpeedKmh).toBeNull();
    expect(invalid.windDirectionDegrees).toBeNull();
    expect(getSnowWindDrift(invalid)).toBe(0);
  });

  it("moves and wraps flakes while writing finite GPU point attributes", () => {
    const state = createSnowVisualState({
      isSnowCategory: true,
      category: "steady",
      windSpeedKmh: 28,
      windDirectionDegrees: 100,
    });
    const particles = createSnowParticles(2, "steady");
    const initialX = particles[0].x;
    const initialY = particles[0].y;
    updateSnowParticles(particles, 0.04, 0.04, state);
    expect(particles[0].x).not.toBe(initialX);
    expect(particles[0].y).toBeGreaterThan(initialY);

    particles[1].y = 1.1;
    updateSnowParticles(particles, 0.04, 0.08, state);
    expect(particles[1].y).toBeLessThan(0);

    const vertices = new Float32Array(particles.length * 5);
    writeSnowVertices(particles, vertices);
    expect(vertices).toHaveLength(10);
    expect([...vertices].every(Number.isFinite)).toBe(true);
  });

  it("caps the shared mobile canvas resolution", () => {
    const size = getSnowCanvasPixelSize(390, 844, 3);
    expect(size.width * size.height).toBeLessThanOrEqual(1_200_000);
    expect(size.width).toBeLessThan(390 * 3);
  });
});

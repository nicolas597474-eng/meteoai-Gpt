import { describe, expect, it } from "vitest";
import {
  createHailParticles,
  createHailVisualState,
  getHailParticleCount,
  getHailWindDrift,
  updateHailParticles,
  writeHailVertices,
  HAIL_VISUAL_CONFIG,
} from "./hailVisualEngine";

describe("hailVisualEngine", () => {
  it("valide les valeurs de vent et distingue une direction manquante de zéro", () => {
    const missing = createHailVisualState({
      isHailCategory: true,
      category: "steady",
      windSpeedKmh: null,
      windDirectionDegrees: null,
      windGustKmh: null,
    });
    const reportedNorth = createHailVisualState({
      isHailCategory: true,
      category: "steady",
      windSpeedKmh: 70,
      windDirectionDegrees: 0,
      windGustKmh: 90,
    });
    const invalid = createHailVisualState({
      isHailCategory: true,
      category: "steady",
      windSpeedKmh: 999,
      windDirectionDegrees: 361,
      windGustKmh: -1,
    });
    const gustOnly = createHailVisualState({
      isHailCategory: true,
      category: "steady",
      windSpeedKmh: null,
      windDirectionDegrees: 90,
      windGustKmh: 90,
    });

    expect(missing.windDirectionDegrees).toBeNull();
    expect(getHailWindDrift(missing)).toBe(0);
    expect(getHailWindDrift(reportedNorth)).toBe(0);
    expect(getHailWindDrift(gustOnly)).toBeLessThan(0);
    expect(invalid.windSpeedKmh).toBeNull();
    expect(invalid.windDirectionDegrees).toBeNull();
    expect(invalid.windGustKmh).toBeNull();
  });

  it("borne le nombre de sphères et réduit leur densité sur petits écrans", () => {
    const heavy = createHailVisualState({
      isHailCategory: true,
      category: "heavy",
    });
    const light = createHailVisualState({
      isHailCategory: true,
      category: "light",
    });
    const disabled = createHailVisualState({
      isHailCategory: false,
      category: "heavy",
    });

    expect(getHailParticleCount(heavy, "full", 1200)).toBe(34);
    expect(getHailParticleCount(heavy, "reduced", 390)).toBe(9);
    expect(getHailParticleCount(light, "reduced", 390)).toBe(4);
    expect(getHailParticleCount(heavy, "off", 390)).toBe(0);
    expect(getHailParticleCount(disabled, "full", 1200)).toBe(0);
    expect(getHailParticleCount(heavy, "full", 1200)).toBeLessThanOrEqual(
      HAIL_VISUAL_CONFIG.maxParticles
    );
  });

  it("produit des trajectoires reproductibles et actualise des sphères avec la gravité", () => {
    const first = createHailParticles(5, "steady");
    const second = createHailParticles(5, "steady");
    expect(first).toEqual(second);
    const startY = first[0].y;
    updateHailParticles(first, 0.05, 0.05, {
      isHailCategory: true,
      category: "steady",
      windSpeedKmh: null,
      windDirectionDegrees: null,
      windGustKmh: null,
    });
    expect(first[0].y).toBeGreaterThan(startY);
    expect(first[0].rotation).not.toBe(second[0].rotation);
  });

  it("écrit un buffer GPU borné avec coordonnées et profondeur normalisées", () => {
    const particles = createHailParticles(2, "light");
    const vertices = new Float32Array(particles.length * 5);
    writeHailVertices(particles, vertices);
    expect(vertices).toHaveLength(10);
    expect([...vertices].every(Number.isFinite)).toBe(true);
    expect(vertices[0]).toBeGreaterThanOrEqual(-1);
    expect(vertices[0]).toBeLessThanOrEqual(1);
    expect(vertices[4]).toBeGreaterThanOrEqual(0);
    expect(vertices[4]).toBeLessThanOrEqual(1);
  });
});

import { describe, expect, it } from "vitest";
import {
  createRainParticles,
  createWeatherVisualState,
  getRainCanvasPixelSize,
  getRainParticleCount,
  getRainWindSlope,
  updateRainParticles,
  writeRainVertices,
} from "./rainVisualEngine";

describe("Weather Reality Engine — pilote pluie", () => {
  it("conserve le débit de pluie inconnu et ne lit que les qualificatifs catégoriels", () => {
    const light = createWeatherVisualState({
      isRainCategory: true,
      condition: "Bruine faible",
      windSpeedKmh: 12,
    });
    const heavy = createWeatherVisualState({
      isRainCategory: true,
      condition: "Pluie forte",
      windSpeedKmh: 12,
    });

    expect(light.precipitationRateMmPerHour).toBeNull();
    expect(light.precipitationType).toBe("rain");
    expect(light.rainCategory).toBe("light");
    expect(heavy.rainCategory).toBe("heavy");
  });

  it("distingue l’absence de déclencheur pluie d’une mesure nulle ou inconnue", () => {
    const state = createWeatherVisualState({ isRainCategory: false });
    expect(state.precipitationType).toBe("unknown");
    expect(state.precipitationRateMmPerHour).toBeNull();
    expect(getRainParticleCount(state, "full", 390)).toBe(0);
  });

  it("limite les particules sur mobile et applique le mode réduit ou désactivé", () => {
    const state = createWeatherVisualState({ isRainCategory: true, condition: "Pluie forte" });
    expect(getRainParticleCount(state, "full", 390)).toBe(42);
    expect(getRainParticleCount(state, "reduced", 390)).toBe(12);
    expect(getRainParticleCount(state, "off", 390)).toBe(0);
    expect(getRainParticleCount(state, "full", 1280)).toBe(63);
  });

  it("incline les gouttes selon la direction du vent et garde la verticale si la direction manque", () => {
    const eastWind = createWeatherVisualState({
      isRainCategory: true,
      windSpeedKmh: 40,
      windDirectionDegrees: 90,
    });
    const westWind = createWeatherVisualState({
      isRainCategory: true,
      windSpeedKmh: 40,
      windDirectionDegrees: 270,
    });
    const unknownDirection = createWeatherVisualState({ isRainCategory: true, windSpeedKmh: 40 });

    expect(getRainWindSlope(eastWind, 1)).toBeLessThan(0);
    expect(getRainWindSlope(westWind, 1)).toBeGreaterThan(0);
    expect(getRainWindSlope(unknownDirection, 1)).toBe(0);
    expect(createWeatherVisualState({ isRainCategory: true, windSpeedKmh: -5 }).windSpeedKmh).toBeNull();
  });

  it("génère des particules déterministes et les fait progresser sans débordement", () => {
    const first = createRainParticles(8, "moderate");
    const second = createRainParticles(8, "moderate");
    const state = createWeatherVisualState({ isRainCategory: true, windSpeedKmh: 20, windDirectionDegrees: 90 });
    const vertices = new Float32Array(first.length * 6 * 3);

    expect(first).toEqual(second);
    updateRainParticles(first, 0.016, 0.5, state, 390, 844);
    writeRainVertices(first, 390, 844, 0.5, state, vertices);
    expect(vertices).toHaveLength(8 * 6 * 3);
    expect([...vertices].every(Number.isFinite)).toBe(true);
    expect(first.every((particle) => particle.x >= 0 && particle.x <= 1)).toBe(true);
  });

  it("borne la résolution du canvas pour préserver le budget GPU mobile", () => {
    const size = getRainCanvasPixelSize(390, 844, 3);
    expect(size.width).toBeLessThan(390 * 3);
    expect(size.height).toBeLessThan(844 * 3);
    expect(size.width * size.height).toBeLessThanOrEqual(1_200_000);
  });
});

import {
  getRainCanvasPixelSize,
  type WeatherEffectsMode,
} from "./rainVisualEngine";

export type SnowVisualCategory = "light" | "steady" | "heavy";

export type SnowVisualState = Readonly<{
  isSnowCategory: boolean;
  category: SnowVisualCategory;
  windSpeedKmh: number | null;
  windDirectionDegrees: number | null;
}>;

export type SnowVisualInput = Readonly<{
  isSnowCategory: boolean;
  category: SnowVisualCategory;
  windSpeedKmh?: number | null;
  windDirectionDegrees?: number | null;
}>;

export type SnowParticle = {
  x: number;
  y: number;
  depth: number;
  size: number;
  fallSpeed: number;
  opacity: number;
  phase: number;
  rotation: number;
  rotationSpeed: number;
  windResponse: number;
  wraps: number;
};

export const SNOW_VISUAL_CONFIG = Object.freeze({
  maxWindSpeedKmh: 80,
  maxHorizontalDriftPerSecond: 0.11,
  maxFrameDeltaSeconds: 0.05,
  maxParticles: 48,
});

const PARTICLE_COUNTS: Record<
  SnowVisualCategory,
  { full: number; reduced: number }
> = {
  light: { full: 16, reduced: 6 },
  steady: { full: 26, reduced: 8 },
  heavy: { full: 38, reduced: 10 },
};

function finiteInRange(
  value: number | null | undefined,
  min: number,
  max: number
): number | null {
  return typeof value === "number" &&
    Number.isFinite(value) &&
    value >= min &&
    value <= max
    ? value
    : null;
}

export function createSnowVisualState(input: SnowVisualInput): SnowVisualState {
  return {
    isSnowCategory: input.isSnowCategory,
    category: input.category,
    windSpeedKmh: finiteInRange(input.windSpeedKmh, 0, 250),
    windDirectionDegrees: finiteInRange(input.windDirectionDegrees, 0, 360),
  };
}

export function getSnowParticleCount(
  state: SnowVisualState,
  mode: WeatherEffectsMode,
  viewportWidth: number
): number {
  if (mode === "off" || !state.isSnowCategory) return 0;
  const compactViewport =
    !Number.isFinite(viewportWidth) || viewportWidth < 600;
  const baseCount = PARTICLE_COUNTS[state.category][mode];
  const count = compactViewport ? baseCount : Math.round(baseCount * 1.25);
  return Math.min(SNOW_VISUAL_CONFIG.maxParticles, count);
}

function createSeededRandom(seed: number): () => number {
  let value = seed >>> 0 || 1;
  return () => {
    value ^= value << 13;
    value ^= value >>> 17;
    value ^= value << 5;
    return (value >>> 0) / 0x1_0000_0000;
  };
}

function categorySeed(category: SnowVisualCategory): number {
  if (category === "light") return 0x4c494748;
  if (category === "heavy") return 0x48454156;
  return 0x53544541;
}

export function createSnowParticles(
  count: number,
  category: SnowVisualCategory
): SnowParticle[] {
  const safeCount = Math.max(
    0,
    Math.min(SNOW_VISUAL_CONFIG.maxParticles, Math.floor(count))
  );
  const random = createSeededRandom(
    0x534e4f57 ^ (safeCount * 37) ^ categorySeed(category)
  );
  return Array.from({ length: safeCount }, () => {
    const depth = random();
    return {
      x: random(),
      y: random(),
      depth,
      size: 0.9 + depth * 3.4,
      fallSpeed: 0.05 + (1 - depth) * 0.035,
      opacity: 0.2 + depth * 0.32,
      phase: random() * Math.PI * 2,
      rotation: random() * Math.PI * 2,
      rotationSpeed: (random() - 0.5) * (0.42 + depth * 0.32),
      windResponse: 0.55 + depth * 0.45,
      wraps: 0,
    };
  });
}

export function getSnowWindDrift(state: SnowVisualState): number {
  if (state.windSpeedKmh == null || state.windDirectionDegrees == null)
    return 0;
  const speed = Math.min(
    state.windSpeedKmh,
    SNOW_VISUAL_CONFIG.maxWindSpeedKmh
  );
  const directionRadians = (state.windDirectionDegrees * Math.PI) / 180;
  return (
    -Math.sin(directionRadians) *
    (speed / SNOW_VISUAL_CONFIG.maxWindSpeedKmh) *
    SNOW_VISUAL_CONFIG.maxHorizontalDriftPerSecond
  );
}

export function updateSnowParticles(
  particles: SnowParticle[],
  deltaSeconds: number,
  elapsedSeconds: number,
  state: SnowVisualState
): void {
  const delta = Math.max(
    0,
    Math.min(deltaSeconds, SNOW_VISUAL_CONFIG.maxFrameDeltaSeconds)
  );
  const windDrift = getSnowWindDrift(state);

  for (const particle of particles) {
    const gentleSway = Math.sin(elapsedSeconds * 0.72 + particle.phase) * 0.006;
    particle.x += (windDrift * particle.windResponse + gentleSway) * delta;
    particle.y += particle.fallSpeed * delta;
    particle.rotation += particle.rotationSpeed * delta;

    if (particle.y > 1.06) {
      particle.wraps += 1;
      particle.y = -0.04 - (particle.phase / (Math.PI * 2)) * 0.16;
      particle.x = (particle.x + 0.38196601125 * particle.wraps) % 1;
    }
    if (particle.x < -0.08 || particle.x > 1.08) {
      particle.x = ((particle.x % 1) + 1) % 1;
    }
  }
}

/** Writes point position, opacity, pixel size and rotation into a reusable GPU buffer. */
export function writeSnowVertices(
  particles: readonly SnowParticle[],
  vertices: Float32Array
): void {
  let offset = 0;
  for (const particle of particles) {
    vertices[offset++] = particle.x * 2 - 1;
    vertices[offset++] = 1 - particle.y * 2;
    vertices[offset++] = particle.opacity;
    vertices[offset++] = particle.size;
    vertices[offset++] = particle.rotation;
  }
}

export { getRainCanvasPixelSize as getSnowCanvasPixelSize };

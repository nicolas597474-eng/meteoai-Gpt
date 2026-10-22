import {
  getRainCanvasPixelSize,
  type WeatherEffectsMode,
} from "./rainVisualEngine";

export type HailVisualCategory = "light" | "steady" | "heavy";

export type HailVisualState = Readonly<{
  isHailCategory: boolean;
  category: HailVisualCategory;
  windSpeedKmh: number | null;
  windDirectionDegrees: number | null;
  windGustKmh: number | null;
}>;

export type HailVisualInput = Readonly<{
  isHailCategory: boolean;
  category: HailVisualCategory;
  windSpeedKmh?: number | null;
  windDirectionDegrees?: number | null;
  windGustKmh?: number | null;
}>;

export type HailParticle = {
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

export const HAIL_VISUAL_CONFIG = Object.freeze({
  maxParticles: 36,
  maxWindSpeedKmh: 120,
  maxHorizontalDriftPerSecond: 0.14,
  maxFrameDeltaSeconds: 0.05,
});

const PARTICLE_COUNTS: Record<
  HailVisualCategory,
  { full: number; reduced: number }
> = {
  light: { full: 12, reduced: 4 },
  steady: { full: 20, reduced: 7 },
  heavy: { full: 28, reduced: 9 },
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

export function createHailVisualState(input: HailVisualInput): HailVisualState {
  return {
    isHailCategory: input.isHailCategory,
    category: input.category,
    windSpeedKmh: finiteInRange(input.windSpeedKmh, 0, 250),
    windDirectionDegrees: finiteInRange(input.windDirectionDegrees, 0, 360),
    windGustKmh: finiteInRange(input.windGustKmh, 0, 300),
  };
}

export function getHailParticleCount(
  state: HailVisualState,
  mode: WeatherEffectsMode,
  viewportWidth: number
): number {
  if (mode === "off" || !state.isHailCategory) return 0;
  const compactViewport =
    !Number.isFinite(viewportWidth) || viewportWidth < 600;
  const baseCount = PARTICLE_COUNTS[state.category][mode];
  return Math.min(
    HAIL_VISUAL_CONFIG.maxParticles,
    compactViewport ? baseCount : Math.round(baseCount * 1.2)
  );
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

function categorySeed(category: HailVisualCategory): number {
  if (category === "light") return 0x4841494c;
  if (category === "heavy") return 0x48454156;
  return 0x53544541;
}

export function createHailParticles(
  count: number,
  category: HailVisualCategory
): HailParticle[] {
  const safeCount = Math.max(
    0,
    Math.min(HAIL_VISUAL_CONFIG.maxParticles, Math.floor(count))
  );
  const random = createSeededRandom(
    0x47524149 ^ (safeCount * 43) ^ categorySeed(category)
  );
  const speedScale =
    category === "heavy" ? 1.25 : category === "light" ? 0.78 : 1;

  return Array.from({ length: safeCount }, () => {
    const depth = random();
    return {
      x: random(),
      y: random(),
      depth,
      size: 2.2 + depth * 5.4,
      fallSpeed: (0.34 + depth * 0.38) * speedScale,
      opacity: 0.34 + depth * 0.38,
      phase: random() * Math.PI * 2,
      rotation: random() * Math.PI * 2,
      rotationSpeed: (random() - 0.5) * (1.2 + depth * 1.6),
      windResponse: 0.62 + depth * 0.38,
      wraps: 0,
    };
  });
}

export function getHailWindDrift(state: HailVisualState): number {
  if (state.windDirectionDegrees == null) return 0;
  const speed = Math.min(
    state.windSpeedKmh ?? state.windGustKmh ?? 0,
    HAIL_VISUAL_CONFIG.maxWindSpeedKmh
  );
  const gustExcess = Math.max(0, (state.windGustKmh ?? speed) - speed);
  const effectiveSpeed = Math.min(
    HAIL_VISUAL_CONFIG.maxWindSpeedKmh,
    speed + Math.min(gustExcess * 0.18, 18)
  );
  const directionRadians = (state.windDirectionDegrees * Math.PI) / 180;
  const drift = (
    -Math.sin(directionRadians) *
    (effectiveSpeed / HAIL_VISUAL_CONFIG.maxWindSpeedKmh) *
    HAIL_VISUAL_CONFIG.maxHorizontalDriftPerSecond
  );
  return Math.abs(drift) < 1e-12 ? 0 : drift;
}

export function updateHailParticles(
  particles: HailParticle[],
  deltaSeconds: number,
  elapsedSeconds: number,
  state: HailVisualState
): void {
  const delta = Math.max(
    0,
    Math.min(deltaSeconds, HAIL_VISUAL_CONFIG.maxFrameDeltaSeconds)
  );
  const windDrift = getHailWindDrift(state);

  for (const particle of particles) {
    const smallTumble =
      Math.sin(elapsedSeconds * 2.1 + particle.phase) *
      0.004 *
      particle.windResponse;
    particle.x += (windDrift * particle.windResponse + smallTumble) * delta;
    particle.y += particle.fallSpeed * delta;
    particle.rotation += particle.rotationSpeed * delta;

    if (particle.y > 1.08) {
      particle.wraps += 1;
      particle.y = -0.04 - (particle.phase / (Math.PI * 2)) * 0.14;
      particle.x = (particle.x + 0.38196601125 * particle.wraps) % 1;
    }
    if (particle.x < -0.08 || particle.x > 1.08) {
      particle.x = ((particle.x % 1) + 1) % 1;
    }
  }
}

/** One GPU point per ice sphere: normalized position, alpha, diameter, depth. */
export function writeHailVertices(
  particles: readonly HailParticle[],
  vertices: Float32Array
): void {
  let offset = 0;
  for (const particle of particles) {
    vertices[offset++] = particle.x * 2 - 1;
    vertices[offset++] = 1 - particle.y * 2;
    vertices[offset++] = particle.opacity;
    vertices[offset++] = particle.size;
    vertices[offset++] = particle.depth;
  }
}

export { getRainCanvasPixelSize as getHailCanvasPixelSize };

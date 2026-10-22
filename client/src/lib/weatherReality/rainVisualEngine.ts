export type RainVisualCategory = "light" | "moderate" | "heavy" | "unspecified";
export type WeatherEffectsMode = "full" | "reduced" | "off";

/**
 * State consommé uniquement par le rendu. Le dépôt n’expose pas de débit de
 * pluie courant avec une période documentée : precipitationRateMmPerHour reste
 * donc explicitement null pour ce pilote.
 */
export type WeatherVisualState = Readonly<{
  precipitationType: "rain" | "unknown";
  precipitationRateMmPerHour: null;
  rainCategory: RainVisualCategory;
  windSpeedKmh: number | null;
  windDirectionDegrees: number | null;
  windGustKmh: number | null;
}>;

export type WeatherVisualInput = Readonly<{
  isRainCategory: boolean;
  condition?: string | null;
  regime?: string | null;
  windSpeedKmh?: number | null;
  windDirectionDegrees?: number | null;
  windGustKmh?: number | null;
}>;

export const RAIN_VISUAL_CONFIG = Object.freeze({
  maxDevicePixelRatio: 1.25,
  maxCanvasPixels: 1_200_000,
  maxWindSlope: 0.46,
  maxWindSpeedKmh: 80,
  maxFrameDeltaSeconds: 0.05,
});

function finiteInRange(value: number | null | undefined, min: number, max: number): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= min && value <= max
    ? value
    : null;
}

function normalizeLabel(value?: string | null): string {
  return (value ?? "")
    .trim()
    .toLocaleLowerCase("fr-FR")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[_-]+/g, " ");
}

function getCategoricalRainLevel(condition?: string | null, regime?: string | null): RainVisualCategory {
  const label = `${normalizeLabel(condition)} ${normalizeLabel(regime)}`;
  if (/(forte?|intense|violente?|heavy|torrential)/.test(label)) return "heavy";
  if (/(faible|leger|bruine|fine|light)/.test(label)) return "light";
  if (/(moderee?|moderate)/.test(label)) return "moderate";
  return "unspecified";
}

/**
 * Convertit les informations visuelles déjà sélectionnées par MeteoAI.
 * isRainCategory provient du classifieur décoratif existant (libellé ou repli
 * de présence). Aucun nombre de précipitation n’entre ici : ce signal
 * catégoriel ne devient jamais une intensité physique.
 */
export function createWeatherVisualState(input: WeatherVisualInput): WeatherVisualState {
  return {
    precipitationType: input.isRainCategory ? "rain" : "unknown",
    precipitationRateMmPerHour: null,
    rainCategory: input.isRainCategory
      ? getCategoricalRainLevel(input.condition, input.regime)
      : "unspecified",
    windSpeedKmh: finiteInRange(input.windSpeedKmh, 0, 250),
    windDirectionDegrees: finiteInRange(input.windDirectionDegrees, 0, 360),
    windGustKmh: finiteInRange(input.windGustKmh, 0, 300),
  };
}

const PARTICLE_COUNTS: Record<RainVisualCategory, { full: number; reduced: number }> = {
  light: { full: 18, reduced: 8 },
  moderate: { full: 30, reduced: 10 },
  heavy: { full: 42, reduced: 12 },
  unspecified: { full: 22, reduced: 9 },
};

export function getRainParticleCount(
  state: WeatherVisualState,
  mode: WeatherEffectsMode,
  viewportWidth: number
): number {
  if (mode === "off" || state.precipitationType !== "rain") return 0;
  const compactViewport = !Number.isFinite(viewportWidth) || viewportWidth < 600;
  const count = PARTICLE_COUNTS[state.rainCategory][mode];
  return compactViewport ? count : Math.round(count * 1.5);
}

/** Horizontal displacement / vertical displacement, using meteorological wind-from direction. */
export function getRainWindSlope(
  state: WeatherVisualState,
  elapsedSeconds: number,
  phase = 0
): number {
  if (state.windDirectionDegrees == null) return 0;
  const baseSpeed = state.windSpeedKmh ?? 0;
  const gustExcess = Math.max(0, (state.windGustKmh ?? baseSpeed) - baseSpeed);
  const gustPulse = Math.sin(elapsedSeconds * 1.35 + phase) * Math.min(gustExcess * 0.28, 12);
  const effectiveSpeed = Math.max(0, Math.min(
    RAIN_VISUAL_CONFIG.maxWindSpeedKmh,
    baseSpeed + gustPulse
  ));
  const radians = (state.windDirectionDegrees * Math.PI) / 180;
  const signedCrossWind = -Math.sin(radians) * effectiveSpeed;
  return Math.max(
    -RAIN_VISUAL_CONFIG.maxWindSlope,
    Math.min(RAIN_VISUAL_CONFIG.maxWindSlope,
      (signedCrossWind / RAIN_VISUAL_CONFIG.maxWindSpeedKmh) * RAIN_VISUAL_CONFIG.maxWindSlope)
  );
}

export function getRainCanvasPixelSize(
  cssWidth: number,
  cssHeight: number,
  devicePixelRatio: number
): { width: number; height: number } {
  const width = Number.isFinite(cssWidth) && cssWidth > 0 ? cssWidth : 1;
  const height = Number.isFinite(cssHeight) && cssHeight > 0 ? cssHeight : 1;
  const requestedRatio = Number.isFinite(devicePixelRatio) && devicePixelRatio > 0
    ? devicePixelRatio
    : 1;
  const pixelBudgetRatio = Math.sqrt(RAIN_VISUAL_CONFIG.maxCanvasPixels / (width * height));
  const ratio = Math.max(0.1, Math.min(
    requestedRatio,
    RAIN_VISUAL_CONFIG.maxDevicePixelRatio,
    pixelBudgetRatio
  ));
  return {
    width: Math.max(1, Math.round(width * ratio)),
    height: Math.max(1, Math.round(height * ratio)),
  };
}

export type RainParticle = {
  x: number;
  y: number;
  depth: number;
  fallSpeed: number;
  length: number;
  width: number;
  opacity: number;
  phase: number;
  wraps: number;
};

function createSeededRandom(seed: number): () => number {
  let value = seed >>> 0 || 1;
  return () => {
    value ^= value << 13;
    value ^= value >>> 17;
    value ^= value << 5;
    return (value >>> 0) / 0x1_0000_0000;
  };
}

export function createRainParticles(count: number, category: RainVisualCategory): RainParticle[] {
  const random = createSeededRandom(0x4d455445 + count * 31);
  const baseSpeed = category === "heavy" ? 0.76
    : category === "moderate" ? 0.61
      : category === "light" ? 0.43
        : 0.52;
  return Array.from({ length: Math.max(0, Math.floor(count)) }, () => {
    const depth = random();
    return {
      x: random(),
      y: random(),
      depth,
      fallSpeed: baseSpeed + depth * 0.48,
      length: 7 + depth * 18,
      width: 0.45 + depth * 0.9,
      opacity: 0.16 + depth * 0.22,
      phase: random() * Math.PI * 2,
      wraps: 0,
    };
  });
}

export function updateRainParticles(
  particles: RainParticle[],
  deltaSeconds: number,
  elapsedSeconds: number,
  state: WeatherVisualState,
  viewportWidth: number,
  viewportHeight: number
): void {
  const delta = Math.max(0, Math.min(deltaSeconds, RAIN_VISUAL_CONFIG.maxFrameDeltaSeconds));
  const aspect = viewportHeight / Math.max(1, viewportWidth);
  for (const particle of particles) {
    const slope = getRainWindSlope(state, elapsedSeconds, particle.phase);
    const verticalDelta = particle.fallSpeed * delta;
    particle.y += verticalDelta;
    particle.x += slope * verticalDelta * aspect;
    if (particle.y > 1.08) {
      particle.wraps += 1;
      particle.y = -0.04 - ((particle.phase / (Math.PI * 2)) * 0.18);
      // Golden-ratio offset avoids returning every drop to the same lane.
      particle.x = (particle.x + 0.38196601125 * particle.wraps) % 1;
    }
    if (particle.x < -0.15 || particle.x > 1.15) {
      particle.x = ((particle.x % 1) + 1) % 1;
    }
  }
}

/** Write tapered six-vertex rain streaks into a reusable WebGL buffer. */
export function writeRainVertices(
  particles: readonly RainParticle[],
  viewportWidth: number,
  viewportHeight: number,
  elapsedSeconds: number,
  state: WeatherVisualState,
  vertices: Float32Array
): void {
  const width = Math.max(1, viewportWidth);
  const height = Math.max(1, viewportHeight);
  let offset = 0;
  const push = (x: number, y: number, alpha: number) => {
    vertices[offset++] = (x / width) * 2 - 1;
    vertices[offset++] = 1 - (y / height) * 2;
    vertices[offset++] = alpha;
  };

  for (const particle of particles) {
    const slope = getRainWindSlope(state, elapsedSeconds, particle.phase);
    const directionLength = Math.hypot(slope, 1);
    const unitX = slope / directionLength;
    const unitY = 1 / directionLength;
    const startX = particle.x * width;
    const startY = particle.y * height;
    const middleX = startX + unitX * particle.length * 0.52;
    const middleY = startY + unitY * particle.length * 0.52;
    const endX = startX + unitX * particle.length;
    const endY = startY + unitY * particle.length;
    const perpendicularX = -unitY * particle.width * 0.5;
    const perpendicularY = unitX * particle.width * 0.5;
    const leftX = middleX + perpendicularX;
    const leftY = middleY + perpendicularY;
    const rightX = middleX - perpendicularX;
    const rightY = middleY - perpendicularY;
    const bright = particle.opacity;

    push(startX, startY, bright * 0.08);
    push(leftX, leftY, bright);
    push(rightX, rightY, bright);
    push(leftX, leftY, bright);
    push(endX, endY, bright * 0.05);
    push(rightX, rightY, bright);
  }
}

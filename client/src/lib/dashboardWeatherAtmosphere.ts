export type DashboardWeatherAtmosphereKind =
  | "rain"
  | "storm"
  | "snow"
  | "hail"
  | "ice"
  | "fog"
  | "dust"
  | "clouds"
  | "sun"
  | "cold-sun"
  | "heat"
  | "wind"
  | "night"
  | "none";

export type DashboardWeatherAtmosphereIntensity = "light" | "steady" | "heavy";

export type DashboardWeatherAtmosphereInput = {
  condition?: string | null;
  regime?: string | null;
  weatherCode?: number | null;
  temperature?: number | null;
  visibilityKm?: number | null;
  /** Champ numérique sans période garantie : jamais converti en débit ou signal pluie. */
  precipitation?: number | null;
  cloudCover?: number | null;
  windSpeed?: number | null;
};

export type DashboardWeatherAtmosphere = {
  kind: DashboardWeatherAtmosphereKind;
  intensity: DashboardWeatherAtmosphereIntensity;
};

function normalizeCondition(condition?: string | null) {
  return (condition ?? "")
    .trim()
    .toLocaleLowerCase("fr-FR")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[_-]+/g, " ");
}

function finiteValue(value?: number | null): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function finiteVisibilityKm(value?: number | null): number | null {
  const visibilityKm = finiteValue(value);
  return visibilityKm != null && visibilityKm >= 0 && visibilityKm <= 100
    ? visibilityKm
    : null;
}

function finitePercent(value?: number | null): number | null {
  const percent = finiteValue(value);
  return percent != null && percent >= 0 && percent <= 100 ? percent : null;
}

function finiteWeatherCode(value?: number | null): number | null {
  const code = finiteValue(value);
  return code != null && Number.isInteger(code) && code >= 0 && code <= 99
    ? code
    : null;
}

function normalizedSignals(input: DashboardWeatherAtmosphereInput): string {
  return `${normalizeCondition(input.condition)} ${normalizeCondition(input.regime)}`.trim();
}

/** WMO 96/99 and explicit labels are the only additional hail signals. */
export function hasDashboardHail(
  input: DashboardWeatherAtmosphereInput
): boolean {
  const code = finiteWeatherCode(input.weatherCode);
  return (
    code === 96 ||
    code === 99 ||
    /\b(grele|hail|gresil|graupel)\b/.test(normalizedSignals(input))
  );
}

/** Freezing drizzle/rain uses explicit phase labels or its selected WMO code. */
export function isDashboardFreezingPrecipitation(
  input: DashboardWeatherAtmosphereInput
): boolean {
  const code = finiteWeatherCode(input.weatherCode);
  return (
    code === 56 ||
    code === 57 ||
    code === 66 ||
    code === 67 ||
    /(pluie vergla|bruine vergla|freezing rain|freezing drizzle|freezing precipitation)/.test(
      normalizedSignals(input)
    )
  );
}

export function getDashboardWeatherHailIntensity(
  input: DashboardWeatherAtmosphereInput
): DashboardWeatherAtmosphereIntensity {
  const code = finiteWeatherCode(input.weatherCode);
  if (code === 99) return "heavy";
  if (code === 96) return "steady";
  const hailText = normalizedSignals(input);
  if (/(fort|intense|violent|heavy|large)/.test(hailText)) return "heavy";
  if (/(faible|leger|light|fine)/.test(hailText)) return "light";
  return "steady";
}

export type DashboardWeatherCloudOpacity = Readonly<{
  far: number;
  near: number;
}>;

/** Returns null for unknown cloud cover; a reported zero remains a real zero. */
export function getDashboardWeatherCloudOpacity(
  cloudCover?: number | null
): DashboardWeatherCloudOpacity | null {
  const cover = finitePercent(cloudCover);
  if (cover == null) return null;
  const density = cover / 100;
  return {
    far: Number((density * 0.24).toFixed(3)),
    near: Number((density * 0.17).toFixed(3)),
  };
}

/** Diffuse daylight only: this deliberately does not place a synthetic sun disk. */
export function getDashboardWeatherSunlightOpacity(
  cloudCover?: number | null
): number {
  const cover = finitePercent(cloudCover);
  if (cover == null) return 0.14;
  return Number((0.2 - (cover / 100) * 0.15).toFixed(3));
}

export type DashboardWeatherWindMotion = Readonly<{
  directionAngleDeg: number | null;
  driftX: string;
  driftY: string;
  durationSeconds: number;
  opacity: number;
}>;

/** Missing wind inputs stay neutral; reported direction drives a bounded drift. */
export function getDashboardWeatherWindMotion(
  windSpeed?: number | null,
  windDirection?: number | null,
  windGust?: number | null
): DashboardWeatherWindMotion {
  const speedCandidate = finiteValue(windSpeed);
  const gustCandidate = finiteValue(windGust);
  const speed =
    speedCandidate != null && speedCandidate >= 0 && speedCandidate <= 250
      ? speedCandidate
      : null;
  const gust =
    gustCandidate != null && gustCandidate >= 0 && gustCandidate <= 300
      ? gustCandidate
      : null;
  const direction = finiteValue(windDirection);
  const validDirection =
    direction != null && direction >= 0 && direction <= 360 ? direction : null;
  const effectiveSpeed = Math.min(120, Math.max(speed ?? 0, gust ?? 0));
  const strength = effectiveSpeed / 120;
  const driftDistanceVw = effectiveSpeed === 0 ? 0 : 3 + strength * 8;
  const driftDistanceVh = effectiveSpeed === 0 ? 0 : 1 + strength * 4;
  const directionRadians =
    validDirection == null ? null : (validDirection * Math.PI) / 180;
  const cssDistance = (distance: number, unit: "vw" | "vh") => {
    const rounded = Number(distance.toFixed(2));
    return `${rounded === 0 ? 0 : rounded}${unit}`;
  };
  return {
    directionAngleDeg:
      validDirection == null ? null : (validDirection + 90) % 360,
    driftX:
      directionRadians == null
        ? "0vw"
        : cssDistance(-Math.sin(directionRadians) * driftDistanceVw, "vw"),
    driftY:
      directionRadians == null
        ? "0vh"
        : cssDistance(Math.cos(directionRadians) * driftDistanceVh, "vh"),
    durationSeconds:
      effectiveSpeed === 0 ? 11 : Number((15 - strength * 8).toFixed(1)),
    opacity:
      effectiveSpeed === 0 ? 0.12 : Number((0.1 + strength * 0.14).toFixed(3)),
  };
}

const FOG_VISUAL_CONFIG = Object.freeze({
  opacityRangeKm: 1,
  farOpacityMin: 0.14,
  farOpacityMax: 0.32,
  nearOpacityMin: 0.1,
  nearOpacityMax: 0.23,
});

export type DashboardWeatherFogOpacity = Readonly<{
  far: number;
  near: number;
}>;

/** Visibility is a reported distance in km; null stays unknown, not zero. */
export function getDashboardWeatherFogOpacity(
  visibilityKm?: number | null
): DashboardWeatherFogOpacity | null {
  const visibility = finiteVisibilityKm(visibilityKm);
  if (visibility == null) return null;

  const density = Math.max(
    0,
    Math.min(1, 1 - visibility / FOG_VISUAL_CONFIG.opacityRangeKm)
  );
  return {
    far: Number(
      (
        FOG_VISUAL_CONFIG.farOpacityMin +
        density *
          (FOG_VISUAL_CONFIG.farOpacityMax - FOG_VISUAL_CONFIG.farOpacityMin)
      ).toFixed(3)
    ),
    near: Number(
      (
        FOG_VISUAL_CONFIG.nearOpacityMin +
        density *
          (FOG_VISUAL_CONFIG.nearOpacityMax - FOG_VISUAL_CONFIG.nearOpacityMin)
      ).toFixed(3)
    ),
  };
}

function classifyCondition(
  condition: string
): DashboardWeatherAtmosphereKind | null {
  if (/(orage|thunderstorm)/.test(condition)) return "storm";
  if (/(grele|hail|gresil|graupel)/.test(condition)) return "hail";
  if (
    /(verglas|vergla|givre|gele|gel|frost|freezing|ice|glace)/.test(condition)
  )
    return "ice";
  if (/(neige|snow|sleet)/.test(condition)) return "snow";
  if (/(brume seche|poussiere|dust|haze)/.test(condition)) return "dust";
  if (/(brouillard|brume|fog|mist)/.test(condition)) return "fog";
  if (/(pluie|rain|averse|bruine|drizzle)/.test(condition)) return "rain";
  if (/(canicule|chaleur|heat)/.test(condition)) return "heat";
  if (/(vent|wind)/.test(condition)) return "wind";
  if (/(nuit|night)/.test(condition)) return "night";
  if (/(grand soleil|soleil froid|cold sun)/.test(condition)) return "cold-sun";
  if (/(nuage|cloud|couvert|overcast|variable)/.test(condition))
    return "clouds";
  if (/(soleil|sunny|ensoleill|degag|clair|clear)/.test(condition))
    return "sun";
  return null;
}

function getIntensity(
  kind: DashboardWeatherAtmosphereKind,
  condition: string,
  input: DashboardWeatherAtmosphereInput
): DashboardWeatherAtmosphereIntensity {
  if (kind === "storm" || kind === "heat") return "heavy";

  if (kind === "snow") {
    if (/(fort|intense|heavy|violent)/.test(condition)) return "heavy";
    if (/(faible|leger|light|fine)/.test(condition)) return "light";
    return "steady";
  }

  if (kind === "hail") {
    return getDashboardWeatherHailIntensity(input);
  }

  if (kind === "rain") {
    if (/(fort|intense|heavy|violent)/.test(condition)) {
      return "heavy";
    }
    if (/(bruine|faible|light|fine)/.test(condition)) return "light";
    return "steady";
  }

  if (kind === "ice") {
    const weatherCode = finiteWeatherCode(input.weatherCode);
    if (weatherCode === 56 || weatherCode === 66) return "light";
    if (weatherCode === 57 || weatherCode === 67) return "heavy";
    if (/(fort|intense|heavy|violent)/.test(condition)) return "heavy";
    if (/(faible|leger|light)/.test(condition)) return "light";
    return "steady";
  }

  if (kind === "dust") {
    if (/(dense|fort|intense|heavy|violent)/.test(condition)) return "heavy";
    if (/(leger|faible|light)/.test(condition)) return "light";
    return "steady";
  }

  if (kind === "fog") {
    const visibilityKm = finiteVisibilityKm(input.visibilityKm);
    return visibilityKm != null && visibilityKm < 0.2 ? "heavy" : "steady";
  }

  if (kind === "wind") {
    const windSpeed = finiteValue(input.windSpeed);
    return (windSpeed != null && windSpeed >= 65) ||
      /(fort|strong|rafale)/.test(condition)
      ? "heavy"
      : "steady";
  }

  if (kind === "clouds") {
    const cloudCover = finitePercent(input.cloudCover);
    return cloudCover != null && cloudCover >= 85 ? "heavy" : "steady";
  }

  return "steady";
}

/**
 * Choisit un habillage décoratif à partir des signaux catégoriels explicitement
 * sélectionnés. Un nombre de précipitations sans période garantie ne déclenche
 * ni pluie ni intensité. Aucun phénomène n’est déduit d’une donnée absente.
 */
export function getDashboardWeatherAtmosphere(
  input: DashboardWeatherAtmosphereInput
): DashboardWeatherAtmosphere {
  const condition = normalizeCondition(input.condition);
  const regime = normalizeCondition(input.regime);
  const displayedWeather = condition || regime;
  const weatherCode = finiteWeatherCode(input.weatherCode);
  const explicitKind = isDashboardFreezingPrecipitation(input)
    ? "ice"
    : weatherCode === 95 || weatherCode === 96 || weatherCode === 99
      ? "storm"
      : classifyCondition(displayedWeather);
  const cloudCover = finitePercent(input.cloudCover);
  const windSpeed = finiteValue(input.windSpeed);
  const temperature = finiteValue(input.temperature);
  const visibilityKm = finiteVisibilityKm(input.visibilityKm);

  // Les mesures restent des replis pour leurs propres effets, jamais pour inférer la pluie.
  const kind =
    explicitKind ??
    (windSpeed != null && windSpeed >= 40 ? "wind" : null) ??
    (visibilityKm != null && visibilityKm < 1 ? "fog" : null) ??
    (temperature != null && temperature > 33 ? "heat" : null) ??
    (cloudCover != null && cloudCover > 20 ? "clouds" : null) ??
    "none";

  return {
    kind,
    intensity: getIntensity(kind, displayedWeather, input),
  };
}

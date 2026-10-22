import React, { useId } from "react";

/**
 * MeteoIcon — Pack d'icônes MeteoAI personnalisé
 * Style 3D illustré, volumes doux et phénomènes immédiatement reconnaissables, conçu pour MeteoAI.
 * Couvre : 30 régimes météo + paramètres + indicateurs + classement
 */

interface MeteoIconProps {
  name: string;
  size?: number;
  className?: string;
  ariaLabel?: string;
  /** Compact inline SVG avoids downloading large raster artwork in dense charts. */
  presentation?: "full" | "compact";
}

const PICTORIAL_WEATHER_ICONS: Record<string, string> = {
  sunny: "/manus-storage/meteo3d-sunny_9181afc4.png",
  stable: "/manus-storage/meteo3d-sunny_9181afc4.png",
  summer_heat: "/manus-storage/meteo3d-sunny_9181afc4.png",
  few_clouds: "/manus-storage/meteo3d-partly-cloudy_629434e4.png",
  partly_cloudy: "/manus-storage/meteo3d-partly-cloudy_629434e4.png",
  overcast: "/manus-storage/meteo3d-overcast_01db4212.png",
  cloud_cover: "/manus-storage/meteo3d-overcast_01db4212.png",
  variable: "/manus-storage/meteo3d-overcast_01db4212.png",
  maritime: "/manus-storage/meteo3d-overcast_01db4212.png",
  urban_heat: "/manus-storage/meteo3d-overcast_01db4212.png",
  mountain: "/manus-storage/meteo3d-overcast_01db4212.png",
  showers: "/manus-storage/meteo3d-rain_8854f8b7.png",
  rainy: "/manus-storage/meteo3d-rain_8854f8b7.png",
  heavy_rain: "/manus-storage/meteo3d-rain_8854f8b7.png",
  autumn_disturbed: "/manus-storage/meteo3d-rain_8854f8b7.png",
  thunderstorm: "/manus-storage/meteo3d-thunderstorm_20bf50ef.png",
  storm: "/manus-storage/meteo3d-thunderstorm_20bf50ef.png",
  snow: "/manus-storage/meteo3d-snow_c8da39d2.png",
  freezing_rain: "/manus-storage/meteo3d-snow_c8da39d2.png",
  sleet: "/manus-storage/meteo3d-snow_c8da39d2.png",
  frost: "/manus-storage/meteo3d-snow_c8da39d2.png",
  deep_frost: "/manus-storage/meteo3d-snow_c8da39d2.png",
  winter_anticyclonic: "/manus-storage/meteo3d-snow_c8da39d2.png",
  fog: "/manus-storage/meteo3d-fog_ffd3923a.png",
  clear_night: "/manus-storage/meteo3d-clear-night_9a98fab7.png",
  wind_moderate: "/manus-storage/meteo3d-wind_be1bd4dc.png",
  windy: "/manus-storage/meteo3d-wind_be1bd4dc.png",
  wind_param: "/manus-storage/meteo3d-wind_be1bd4dc.png",
  temperature: "/manus-storage/meteo3d-temperature_d834ebfe.png",
};

function getPictorialAnimationClass(name: string) {
  const key = name.toLowerCase();
  if (["sunny", "stable", "summer_heat"].includes(key)) return "meteo-icon-motion-sun";
  if (["few_clouds", "partly_cloudy", "overcast", "cloud_cover", "variable", "maritime", "urban_heat", "mountain"].includes(key)) return "meteo-icon-motion-cloud";
  if (["showers", "rainy", "heavy_rain", "autumn_disturbed"].includes(key)) return "meteo-icon-motion-rain";
  if (["thunderstorm", "storm"].includes(key)) return "meteo-icon-motion-storm";
  if (["snow", "freezing_rain", "sleet", "frost", "deep_frost", "winter_anticyclonic"].includes(key)) return "meteo-icon-motion-snow";
  if (key === "fog") return "meteo-icon-motion-fog";
  if (key === "clear_night") return "meteo-icon-motion-night";
  if (["wind_moderate", "windy", "wind_param"].includes(key)) return "meteo-icon-motion-wind";
  return "meteo-icon-motion-ambient";
}

function getInlineAnimationClass(name: string) {
  const key = name.toLowerCase();
  if (["wind_moderate", "windy", "wind_param"].includes(key)) return "meteo-icon-motion-wind";
  if (["humidity", "precipitation"].includes(key)) return "meteo-icon-motion-humidity";
  return "";
}

type WeatherEffectKind = "sun" | "cloud" | "rain" | "storm" | "snow" | "fog" | "night" | "wind" | "humidity" | "none";

function getWeatherEffectKind(name: string): WeatherEffectKind {
  const key = name.toLowerCase();
  if (["sunny", "stable", "summer_heat"].includes(key)) return "sun";
  if (["few_clouds", "partly_cloudy", "overcast", "cloud_cover", "variable", "maritime", "urban_heat", "mountain"].includes(key)) return "cloud";
  if (["showers", "rainy", "heavy_rain", "autumn_disturbed"].includes(key)) return "rain";
  if (["thunderstorm", "storm"].includes(key)) return "storm";
  if (["snow", "freezing_rain", "sleet", "frost", "deep_frost", "winter_anticyclonic"].includes(key)) return "snow";
  if (key === "fog") return "fog";
  if (key === "clear_night") return "night";
  if (["wind_moderate", "windy", "wind_param"].includes(key)) return "wind";
  if (["humidity", "precipitation"].includes(key)) return "humidity";
  return "none";
}

function WeatherEffects({ name }: { name: string }) {
  const kind = getWeatherEffectKind(name);
  if (kind === "none") return null;
  if (kind === "rain" || kind === "storm") {
    return <span className={`meteo-icon-effect meteo-icon-effect-${kind}`} aria-hidden="true"><i /><i /><i />{kind === "storm" ? <b /> : null}</span>;
  }
  if (kind === "snow") return <span className="meteo-icon-effect meteo-icon-effect-snow" aria-hidden="true"><i /><i /><i /><i /></span>;
  if (kind === "wind") return <span className="meteo-icon-effect meteo-icon-effect-wind" aria-hidden="true"><i /><i /><i /></span>;
  if (kind === "fog") return <span className="meteo-icon-effect meteo-icon-effect-fog" aria-hidden="true"><i /><i /></span>;
  if (kind === "night") return <span className="meteo-icon-effect meteo-icon-effect-night" aria-hidden="true"><i /><i /><i /></span>;
  return <span className={`meteo-icon-effect meteo-icon-effect-${kind}`} aria-hidden="true"><i /></span>;
}

function hasExplicitSizeClass(className: string) {
  return /(^|\s)(?:h|w)-[\w/.-]+/.test(className);
}

export function MeteoIcon({ name, size = 40, className = "", ariaLabel = `Icône météo : ${name}`, presentation = "full" }: MeteoIconProps) {
  const uniqueId = useId().replace(/:/g, "");
  const pictorialIcon = PICTORIAL_WEATHER_ICONS[name.toLowerCase()];
  const animationClass = getPictorialAnimationClass(name);
  const inlineAnimationClass = getInlineAnimationClass(name);
  const shellSizeStyle = hasExplicitSizeClass(className) ? undefined : { width: size, height: size };
  const effectKind = getWeatherEffectKind(name);
  if(name==='partly_cloudy_night')return <span className={`meteo-icon-shell meteo-icon-3d ${className}`} style={shellSizeStyle} role="img" aria-label={ariaLabel} data-weather-icon="cloud">
    <img src={PICTORIAL_WEATHER_ICONS.clear_night} alt="" className="absolute left-0 top-0 h-3/4 w-3/4 object-contain meteo-icon-motion-night" />
    <img src={PICTORIAL_WEATHER_ICONS.overcast} alt="" className="absolute bottom-0 right-0 h-2/3 w-full object-contain meteo-icon-motion-cloud" />
  </span>;
  if (pictorialIcon && presentation === "full") {
    return (
      <span
        className={`meteo-icon-shell meteo-icon-3d ${className}`}
        style={shellSizeStyle}
        role="img"
        aria-label={ariaLabel}
        data-weather-icon={effectKind}
      >
        <img
          src={pictorialIcon}
          width={size}
          height={size}
          className={`absolute inset-0 h-full w-full ${animationClass} object-contain transition-transform duration-200 hover:scale-[1.04]`}
          alt=""
          draggable={false}
        />
        <WeatherEffects name={name} />
      </span>
    );
  }
  const depthFilterId = `meteo-depth-${uniqueId}`;
  const glassGradientId = `meteo-glass-${uniqueId}`;
  const glassRimId = `meteo-glass-rim-${uniqueId}`;
  const cloudGradientId = `meteo-cloud-${uniqueId}`;
  const sunGradientId = `meteo-sun-${uniqueId}`;
  const rainGradientId = `meteo-rain-${uniqueId}`;
  const cyanGradientId = `meteo-cyan-${uniqueId}`;
  const violetGradientId = `meteo-violet-${uniqueId}`;
  const showGlass = size >= 18;
  return (
    <span
      className={`meteo-icon-shell meteo-icon-3d ${className}`}
      style={shellSizeStyle}
      role="img"
      aria-label={ariaLabel}
      data-weather-icon={effectKind}
    >
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={`absolute inset-0 h-full w-full ${inlineAnimationClass}`}
      role="presentation"
      aria-hidden="true"
    >
      <defs>
        <filter id={depthFilterId} x="-35%" y="-35%" width="170%" height="185%" colorInterpolationFilters="sRGB">
          <feDropShadow dx="0" dy="2.8" stdDeviation="1.6" floodColor="#020617" floodOpacity="0.84" />
          <feDropShadow dx="0" dy="0" stdDeviation="2.4" floodColor="#7dd3fc" floodOpacity="0.34" />
          <feDropShadow dx="0" dy="-0.4" stdDeviation="0.7" floodColor="#f8fafc" floodOpacity="0.5" />
        </filter>
        <radialGradient id={glassGradientId} cx="33%" cy="22%" r="78%">
          <stop offset="0%" stopColor="#f8fafc" stopOpacity="0.38" />
          <stop offset="36%" stopColor="#bae6fd" stopOpacity="0.18" />
          <stop offset="72%" stopColor="#1e40af" stopOpacity="0.12" />
          <stop offset="100%" stopColor="#020617" stopOpacity="0" />
        </radialGradient>
        <linearGradient id={glassRimId} x1="10" y1="8" x2="54" y2="58" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#f8fafc" stopOpacity="0.78" />
          <stop offset="44%" stopColor="#7dd3fc" stopOpacity="0.3" />
          <stop offset="100%" stopColor="#818cf8" stopOpacity="0.52" />
        </linearGradient>
        <linearGradient id={cloudGradientId} x1="14" y1="15" x2="48" y2="47" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#f8fafc" stopOpacity="0.82" />
          <stop offset="34%" stopColor="#bfdbfe" stopOpacity="0.68" />
          <stop offset="74%" stopColor="#64748b" stopOpacity="0.65" />
          <stop offset="100%" stopColor="#1e293b" stopOpacity="0.72" />
        </linearGradient>
        <radialGradient id={sunGradientId} cx="32%" cy="24%" r="74%">
          <stop offset="0%" stopColor="#fff7bf" />
          <stop offset="32%" stopColor="#facc15" />
          <stop offset="72%" stopColor="#f97316" />
          <stop offset="100%" stopColor="#be123c" />
        </radialGradient>
        <linearGradient id={rainGradientId} x1="18" y1="32" x2="43" y2="58" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#bae6fd" />
          <stop offset="45%" stopColor="#38bdf8" />
          <stop offset="100%" stopColor="#2563eb" />
        </linearGradient>
        <linearGradient id={cyanGradientId} x1="12" y1="12" x2="52" y2="52" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#a5f3fc" />
          <stop offset="46%" stopColor="#22d3ee" />
          <stop offset="100%" stopColor="#0e7490" />
        </linearGradient>
        <linearGradient id={violetGradientId} x1="14" y1="10" x2="52" y2="56" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#ddd6fe" />
          <stop offset="45%" stopColor="#a78bfa" />
          <stop offset="100%" stopColor="#5b21b6" />
        </linearGradient>
      </defs>
      {showGlass ? <><circle cx="32" cy="32" r="27" fill={`url(#${glassGradientId})`} /><circle cx="32" cy="32" r="25.5" fill="none" stroke={`url(#${glassRimId})`} strokeOpacity="0.62" strokeWidth="1" /><ellipse cx="24" cy="17" rx="11" ry="4" fill="#f8fafc" opacity="0.1" transform="rotate(-24 24 17)" /><circle cx="47" cy="46" r="2.2" fill="#c4b5fd" opacity="0.2" /></> : null}
      <g filter={`url(#${depthFilterId})`}><FuturisticGlyph name={name} ids={{ cloud: cloudGradientId, sun: sunGradientId, rain: rainGradientId, cyan: cyanGradientId, violet: violetGradientId }} /></g>
      {showGlass ? <path d="M21 11c6-3 16-3.5 23-.7" stroke="#f8fafc" strokeOpacity="0.24" strokeWidth="1.25" strokeLinecap="round" /> : null}
    </svg>
    {presentation === "full" ? <WeatherEffects name={name} /> : null}
    </span>
  );
}

// ─── Helper: map condition string / regime ID to icon name ──────────────────
export function getIconNameFromCondition(condition: string | null | undefined): string {
  if (!condition) return "partly_cloudy";
  const c = condition.toLowerCase();
  if(c === 'clear_night' || c === 'nuit dégagée')return 'clear_night';
  if(c === 'partly_cloudy_night' || c === 'nuit partiellement nuageuse')return 'partly_cloudy_night';
  
  // Exact regime ID matches
  if (c === "overcast" || c === "ciel couvert") return "overcast";
  if (c === "partly_cloudy" || c === "partiellement nuageux") return "partly_cloudy";
  if (c === "few_clouds" || c === "peu nuageux") return "few_clouds";
  if (c === "sunny" || c === "ensoleillé") return "sunny";
  if (c === "fog" || c === "brouillard") return "fog";
  if (c === "showers" || c === "averses") return "showers";
  if (c === "rainy" || c === "pluie") return "rainy";
  if (c === "thunderstorm" || c === "orages" || c === "orage") return "thunderstorm";
  if (c === "windy" || c === "vent fort") return "windy";
  if (c === "snow" || c === "neige") return "snow";
  if (c === "frost" || c === "gel") return "frost";
  if (c === "freezing_rain" || c === "pluie verglaçante" || c === "verglas") return "freezing_rain";
  if (c === "deep_frost" || c === "gel intense") return "deep_frost";
  if (c === "summer_heat" || c === "canicule") return "summer_heat";
  if (c === "storm" || c === "tempête") return "storm";
  if (c === "variable" || c === "temps variable") return "variable";
  if (c === "spring_unstable" || c === "printemps instable") return "spring_unstable";
  if (c === "stable" || c === "été stable") return "stable";
  if (c === "autumn_disturbed" || c === "automne perturbé") return "autumn_disturbed";
  
  // Fuzzy matches from condition text
  if (c.includes("orage")) return "thunderstorm";
  if (c.includes("tempête") || c.includes("storm")) return "storm";
  if (c.includes("neige")) return "snow";
  if (c.includes("vergla")) return "freezing_rain";
  if (c.includes("brouillard") || c.includes("brume")) return "fog";
  if (c.includes("pluie forte") || c.includes("forte pluie")) return "heavy_rain";
  if (c.includes("pluie") || c.includes("rain")) return "rainy";
  if (c.includes("averse")) return "showers";
  if (c.includes("bruine") || c.includes("drizzle")) return "showers";
  if (c.includes("nuageux") && c.includes("partiel")) return "partly_cloudy";
  if (c.includes("couvert") || c.includes("très nuageux")) return "overcast";
  if (c.includes("nuageux")) return "partly_cloudy";
  if (c.includes("soleil") || c.includes("ensoleillé") || c.includes("dégagé") || c.includes("clair")) return "sunny";
  if (c.includes("vent")) return "windy";
  if (c.includes("gel") || c.includes("givre")) return "frost";
  if (c.includes("canicule") || c.includes("chaleur")) return "summer_heat";
  
  return "partly_cloudy";
}

// ─── Helper: map regime ID to icon name (for Ranking grid) ──────────────────
export function getIconNameFromRegime(regimeId: string): string {
  if (ICONS[regimeId]) return regimeId;
  return getIconNameFromCondition(regimeId);
}

// ─── SVG Icon definitions ───────────────────────────────────────────────────

type GlyphIds = { cloud: string; sun: string; rain: string; cyan: string; violet: string };

/**
 * Produit une goutte avec des coordonnées absolues et arrondies. Les anciens
 * raccourcis SVG concaténaient des nombres négatifs flottants (par exemple
 * `0-5.699999…`) : Chromium pouvait alors rejeter l'attribut `d` entier.
 */
export function buildFuturisticRainDropPath(cx: number, cy: number, radius: number): string {
  const value = (number: number) => (Number.isFinite(number) ? number : 0).toFixed(2);
  const top = cy - radius * 2.2;
  const shoulder = cy - radius * 0.55;
  const lower = cy + radius * 1.95;
  const left = cx - radius * 1.55;
  const right = cx + radius * 1.55;
  const middle = cy + radius * 0.92;

  return `M ${value(cx)} ${value(top)} C ${value(left)} ${value(shoulder)} ${value(left)} ${value(middle)} ${value(cx)} ${value(lower)} C ${value(right)} ${value(middle)} ${value(right)} ${value(shoulder)} ${value(cx)} ${value(top)} Z`;
}

function FuturisticCloud({ ids, storm = false }: { ids: GlyphIds; storm?: boolean }) {
  const edge = storm ? "#94a3b8" : "#e2e8f0";
  return <><ellipse cx="32" cy="45.5" rx="21" ry="3.2" fill="#020617" opacity="0.3" /><g fill={`url(#${ids.cloud})`} stroke={edge} strokeOpacity="0.7" strokeWidth="0.8"><circle cx="18" cy="34" r="8.2" /><circle cx="27" cy="28.2" r="11.8" /><circle cx="39" cy="29.5" r="12.6" /><circle cx="48" cy="35" r="8.8" /><ellipse cx="32" cy="37.8" rx="22" ry="9.4" /></g><path d="M18 31c2.1-4.4 5.4-6.8 9.7-6.8 2.6 0 4.8.7 6.6 2.1" fill="none" stroke="#fff" strokeOpacity="0.53" strokeWidth="2.2" strokeLinecap="round" /><ellipse cx="40" cy="24" rx="4.3" ry="2.4" fill="#fff" opacity="0.24" /></>;
}

function FuturisticSun({ ids, hot = false }: { ids: GlyphIds; hot?: boolean }) {
  const ray = hot ? "#fb7185" : "#fde68a";
  return <><g fill={ray} stroke="#fef3c7" strokeOpacity="0.55" strokeWidth="0.6"><path d="m32 4 3.2 10h-6.4L32 4Z" /><path d="m32 58 3.2-10h-6.4L32 58Z" /><path d="m5 31 10-3.2v6.4L5 31Z" /><path d="m59 31-10-3.2v6.4L59 31Z" /><path d="m13 12 9.1 5.2-4.5 4.5L13 12Z" /><path d="m51 50-9.1-5.2 4.5-4.5L51 50Z" /><path d="m13 50 5.2-9.1 4.5 4.5L13 50Z" /><path d="m51 12-5.2 9.1-4.5-4.5L51 12Z" /></g><circle cx="32" cy="31" r="12.8" fill={`url(#${ids.sun})`} stroke="#fff7bf" strokeOpacity="0.88" strokeWidth="1.2" /><ellipse cx="27.2" cy="25.7" rx="4.9" ry="3.5" fill="#fff" opacity="0.52" /><path d="M23 35c3.8 4.2 13.5 5.1 18.3-.4" fill="none" stroke="#be123c" strokeOpacity="0.32" strokeWidth="1.5" strokeLinecap="round" /></>;
}

function FuturisticRain({ ids, dense = false }: { ids: GlyphIds; dense?: boolean }) {
  const drops = dense ? [[16, 47, 3.6], [26, 51, 4], [37, 47, 3.8], [48, 51, 4]] : [[21, 48, 3.8], [32, 52, 4.1], [44, 48, 3.8]];
  return <>{drops.map(([cx, cy, r]) => <g key={`${cx}-${cy}`}><path d={buildFuturisticRainDropPath(cx, cy, r)} fill={`url(#${ids.rain})`} stroke="#e0f2fe" strokeOpacity="0.48" strokeWidth="0.55" /><ellipse cx={cx - r * 0.35} cy={cy - r * 0.1} rx={r * 0.35} ry={r * 0.72} fill="#fff" opacity="0.38" /></g>)}</>;
}

function FuturisticGlyph({ name, ids }: { name: string; ids: GlyphIds }) {
  const key = name.toLowerCase();
  if (["sunny", "stable", "summer_heat"].includes(key)) return <FuturisticSun ids={ids} hot={key === "summer_heat"} />;
  if (["few_clouds", "partly_cloudy"].includes(key)) return <><g transform="translate(7 0) scale(.76)"><FuturisticSun ids={ids} /></g><g transform="translate(4 10) scale(.9)"><FuturisticCloud ids={ids} /></g></>;
  if (["overcast", "fog"].includes(key)) return <><FuturisticCloud ids={ids} />{key === "fog" ? <g stroke={`url(#${ids.cyan})`} strokeWidth="2.2" strokeLinecap="round" opacity="0.8"><path d="M12 47h38" /><path d="M18 53h26" /></g> : null}</>;
  if (["showers", "rainy", "heavy_rain", "autumn_disturbed"].includes(key)) return <><FuturisticCloud ids={ids} storm={key !== "showers"} /><FuturisticRain ids={ids} dense={["rainy", "heavy_rain"].includes(key)} /></>;
  if (["thunderstorm", "storm"].includes(key)) return <><FuturisticCloud ids={ids} storm /><path d="m35 38-9 14h7l-2 10 14-18h-8l3-6Z" fill="#facc15" stroke="#fff7bf" strokeWidth="1" strokeLinejoin="round" /><path d="m35 40-4 9h4" fill="none" stroke="#fff" strokeOpacity="0.45" strokeWidth="1.2" strokeLinecap="round" /><FuturisticRain ids={ids} /></>;
  if (["snow", "freezing_rain", "sleet", "frost", "deep_frost", "winter_anticyclonic"].includes(key)) return <><FuturisticCloud ids={ids} />{[[21, 47], [33, 52], [44, 47]].map(([x, y]) => <g key={`${x}-${y}`} stroke={`url(#${ids.cyan})`} strokeWidth="2" strokeLinecap="round"><path d={`M${x - 5} ${y}h10`} /><path d={`M${x} ${y - 5}v10`} /><path d={`m${x - 3.5} ${y - 3.5} 7 7m0-7-7 7`} /></g>)}</>;
  if (["wind_moderate", "windy", "wind_param"].includes(key)) return <><g fill="none" stroke="#e0f2fe" strokeOpacity="0.38" strokeLinecap="round"><path d="M9 22c9-5 17 2 26-2 7-3 11-5 19-2" strokeWidth="4.5" /><path d="M7 32c13-5 20 3 30-1 7-3 12-5 19-1" strokeWidth="5.4" /><path d="M12 43c8-3 15 2 22-1 5-2 9-4 15-2" strokeWidth="4.1" /></g><g fill="none" stroke={`url(#${ids.cyan})`} strokeLinecap="round"><path d="M9 22c9-5 17 2 26-2 7-3 11-5 19-2" strokeWidth="2.5" /><path d="M7 32c13-5 20 3 30-1 7-3 12-5 19-1" strokeWidth="3.3" /><path d="M12 43c8-3 15 2 22-1 5-2 9-4 15-2" strokeWidth="2.2" /></g></>;
  if (["temperature", "summer_heat", "deep_frost"].includes(key)) return <><rect x="25" y="9" width="14" height="38" rx="7" fill="#f8fafc" stroke="#cbd5e1" strokeWidth="1.1" /><rect x="28" y="16" width="8" height="31" rx="4" fill={`url(#${ids.sun})`} /><circle cx="32" cy="48" r="10.5" fill={`url(#${ids.sun})`} stroke="#fff7bf" strokeOpacity="0.7" strokeWidth="0.8" /><ellipse cx="29" cy="44.5" rx="2.5" ry="3.5" fill="#fff" opacity="0.42" /><path d="M32 20v25" stroke="#fff7bf" strokeOpacity="0.55" strokeWidth="2" strokeLinecap="round" /></>;
  if (["precipitation", "humidity"].includes(key)) return <><path d="M32 7C24 18 16 27 16 37c0 9.2 7.1 16 16 16s16-6.8 16-16C48 27 40 18 32 7Z" fill={`url(#${ids.rain})`} stroke="#e0f2fe" strokeWidth="1.2" /><ellipse cx="27" cy="31" rx="3.6" ry="6.5" fill="#fff" opacity="0.42" /><path d="M26 44c3 3 9 4 13 .5" fill="none" stroke="#1d4ed8" strokeOpacity="0.32" strokeWidth="1.4" strokeLinecap="round" /></>;
  if (key === "pressure") return <><circle cx="32" cy="33" r="20" fill="#e0e7ff" opacity="0.18" /><circle cx="32" cy="33" r="18" fill="#111827" stroke="#e0e7ff" strokeOpacity="0.72" strokeWidth="1.2" /><circle cx="32" cy="33" r="13" fill="none" stroke={`url(#${ids.violet})`} strokeWidth="2.5" /><path d="M32 33 43 24" stroke="#f8fafc" strokeWidth="3" strokeLinecap="round" /><circle cx="32" cy="33" r="3.5" fill={`url(#${ids.violet})`} /><circle cx="26" cy="22" r="1.3" fill="#fff" opacity="0.55" /></>;
  if (["confidence", "trophy", "medal"].includes(key)) return <><path d="M32 6 13 15v15c0 13 7.7 21.4 19 28 11.3-6.6 19-15 19-28V15L32 6Z" fill={`url(#${ids.cyan})`} stroke="#e0f2fe" strokeOpacity="0.86" strokeWidth="1.2" /><path d="M32 11 18 18v12c0 8.8 4.5 15.3 14 21" fill="none" stroke="#fff" strokeOpacity="0.34" strokeWidth="2" strokeLinecap="round" /><path d="m23 32 6 6 13-14" fill="none" stroke="#ecfeff" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" /></>;
  if (key === "location") return <><ellipse cx="32" cy="52" rx="9" ry="2.5" fill="#020617" opacity="0.28" /><path d="M32 8c-8.1 0-14.4 6.3-14.4 14.2C17.6 34.3 32 55 32 55s14.4-20.7 14.4-32.8C46.4 14.3 40.1 8 32 8Z" fill={`url(#${ids.violet})`} stroke="#f5f3ff" strokeOpacity="0.85" strokeWidth="1.1" /><circle cx="32" cy="22" r="6" fill="#f8fafc" /><circle cx="32" cy="22" r="2.7" fill="#7c3aed" /><ellipse cx="28.5" cy="16.5" rx="3" ry="2" fill="#fff" opacity="0.36" /></>;
  if (key === "stations") return <><path d="M13 44 28 29l8 7 13-18 5 27H13Z" fill="#94a3b8" opacity="0.32" /><g fill={`url(#${ids.cyan})`} stroke="#e0f2fe" strokeOpacity="0.8" strokeWidth="0.8"><circle cx="16" cy="42" r="5.3" /><circle cx="32" cy="31" r="6" /><circle cx="49" cy="20" r="5.3" /></g><g fill="#fff" opacity="0.45"><circle cx="14.5" cy="40" r="1.5" /><circle cx="29.8" cy="28.6" r="1.7" /><circle cx="47.3" cy="18.3" r="1.5" /></g><g stroke="#e0f2fe" strokeOpacity="0.7" strokeWidth="1.5" strokeLinecap="round"><path d="m20 39 8-6" /><path d="m36 28 9-6" /></g></>;
  if (key === "refresh") return <><circle cx="32" cy="32" r="20" fill="none" stroke={`url(#${ids.cyan})`} strokeWidth="3.2" strokeDasharray="40 15" /><path d="m43 12 7 3-4 6" fill="none" stroke="#cffafe" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" /></>;
  if (key === "chevron_right") return <><circle cx="32" cy="32" r="21" fill="#0f172a" stroke={`url(#${ids.cyan})`} strokeWidth="1.8" /><path d="m27 20 12 12-12 12" fill="none" stroke="#ecfeff" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" /></>;
  if (["trend_up", "trend_down"].includes(key)) return <g fill="none" stroke={`url(#${ids.cyan})`} strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round"><path d={key === "trend_down" ? "M10 17 25 32l8-8 19 22" : "M10 47 25 32l8 8 19-22"} /><path d={key === "trend_down" ? "M43 46h9v-9" : "M43 18h9v9"} /></g>;
  if (key === "clear_night") return <><circle cx="34" cy="30" r="17" fill={`url(#${ids.violet})`} /><circle cx="41" cy="23" r="17" fill="#07101d" /><circle cx="18" cy="16" r="1.7" fill="#e0f2fe" /><circle cx="48" cy="15" r="1.3" fill="#e0f2fe" /></>;
  if (["cloud_cover", "variable", "spring_unstable", "maritime", "urban_heat", "mountain"].includes(key)) return <><FuturisticCloud ids={ids} />{key === "variable" ? <FuturisticRain ids={ids} /> : null}</>;
  return <><FuturisticCloud ids={ids} /><FuturisticRain ids={ids} /></>;
}

const ICONS: Record<string, React.ReactNode> = {
  // ═══ RÉGIMES MÉTÉO ═══

  // Ciel couvert — nuages gris empilés
  overcast: (
    <>
      <path d="M14 34c-4 0-7-3-7-7s3-7 7-7c1-6 6-10 12-10 7 0 13 5 14 11 4 0 7 3 7 7s-3 7-7 7H14z" fill="#6b7280" opacity="0.9"/>
      <path d="M18 42c-3.5 0-6-2.5-6-5.5s2.5-5.5 6-5.5c1-5 5-8 10-8 6 0 11 4 12 9 3.5 0 6 2.5 6 5.5S49.5 42 46 42H18z" fill="#9ca3af"/>
    </>
  ),

  // Partiellement nuageux — soleil + nuage
  partly_cloudy: (
    <>
      <circle cx="24" cy="22" r="10" fill="#fbbf24"/>
      <path d="M18 22l-4-2M24 12v-4M30 22l4-2M18 16l-3-3M30 16l3-3" stroke="#fbbf24" strokeWidth="2" strokeLinecap="round"/>
      <path d="M20 40c-3.5 0-6-2.5-6-5.5 0-2.5 1.5-4.5 4-5.2C19 24 23 20 28 20c6 0 10 4 11 9 3.5.5 6 3 6 6s-2.5 5-6 5H20z" fill="#9ca3af"/>
    </>
  ),

  // Peu nuageux — grand soleil + petit nuage
  few_clouds: (
    <>
      <circle cx="28" cy="24" r="12" fill="#fbbf24"/>
      <path d="M20 24l-5-2M28 10v-5M36 24l5-2M20 16l-4-4M36 16l4-4M20 32l-4 4M36 32l4 4" stroke="#fbbf24" strokeWidth="2.5" strokeLinecap="round"/>
      <path d="M26 48c-2.5 0-4.5-2-4.5-4s2-4 4.5-4c.5-3.5 3.5-6 7-6 4 0 7 3 7.5 6.5 2.5.5 4 2 4 4s-1.5 3.5-4 3.5H26z" fill="#d1d5db" opacity="0.7"/>
    </>
  ),

  // Ensoleillé — grand soleil rayonnant
  sunny: (
    <>
      <circle cx="32" cy="32" r="13" fill="#fbbf24"/>
      <path d="M32 8v-4M32 60v-4M8 32H4M60 32h-4M14 14l-3-3M50 14l3-3M14 50l-3 3M50 50l3 3" stroke="#fbbf24" strokeWidth="3" strokeLinecap="round"/>
      <circle cx="32" cy="32" r="9" fill="#f59e0b" opacity="0.4"/>
    </>
  ),

  // Brouillard — lignes horizontales ondulées
  fog: (
    <>
      <path d="M10 24h44M10 32h44M10 40h44" stroke="#9ca3af" strokeWidth="3" strokeLinecap="round" opacity="0.5"/>
      <path d="M12 28h40M12 36h40M12 44h36" stroke="#d1d5db" strokeWidth="2.5" strokeLinecap="round" opacity="0.7"/>
      <path d="M16 20c0-6 5-10 10-10 4 0 8 2 9 6 3 0 6 2 6 5" stroke="#9ca3af" strokeWidth="2" strokeLinecap="round" fill="none" opacity="0.4"/>
    </>
  ),

  // Averses — nuage + gouttes espacées
  showers: (
    <>
      <path d="M16 30c-4 0-7-3-7-6.5S12 17 16 17c1-5.5 5.5-9 11-9 6.5 0 11.5 4.5 12 10 3.5.5 6 3 6 6s-2.5 6-6 6H16z" fill="#6b7280"/>
      <line x1="20" y1="36" x2="18" y2="44" stroke="#60a5fa" strokeWidth="2.5" strokeLinecap="round"/>
      <line x1="30" y1="36" x2="28" y2="44" stroke="#60a5fa" strokeWidth="2.5" strokeLinecap="round"/>
      <line x1="40" y1="36" x2="38" y2="44" stroke="#60a5fa" strokeWidth="2.5" strokeLinecap="round"/>
      <line x1="25" y1="44" x2="23" y2="52" stroke="#60a5fa" strokeWidth="2.5" strokeLinecap="round"/>
      <line x1="35" y1="44" x2="33" y2="52" stroke="#60a5fa" strokeWidth="2.5" strokeLinecap="round"/>
    </>
  ),

  // Pluie — nuage sombre + pluie dense
  rainy: (
    <>
      <path d="M14 28c-4 0-7-3-7-6.5S10 15 14 15c1-5.5 5.5-9 11-9 6.5 0 11.5 4.5 12 10 3.5.5 6 3 6 6s-2.5 6-6 6H14z" fill="#4b5563"/>
      <line x1="18" y1="34" x2="14" y2="46" stroke="#3b82f6" strokeWidth="2.5" strokeLinecap="round"/>
      <line x1="26" y1="34" x2="22" y2="46" stroke="#3b82f6" strokeWidth="2.5" strokeLinecap="round"/>
      <line x1="34" y1="34" x2="30" y2="46" stroke="#3b82f6" strokeWidth="2.5" strokeLinecap="round"/>
      <line x1="42" y1="34" x2="38" y2="46" stroke="#3b82f6" strokeWidth="2.5" strokeLinecap="round"/>
      <line x1="22" y1="46" x2="18" y2="58" stroke="#3b82f6" strokeWidth="2.5" strokeLinecap="round"/>
      <line x1="30" y1="46" x2="26" y2="58" stroke="#3b82f6" strokeWidth="2.5" strokeLinecap="round"/>
      <line x1="38" y1="46" x2="34" y2="58" stroke="#3b82f6" strokeWidth="2.5" strokeLinecap="round"/>
    </>
  ),

  // Pluie forte
  heavy_rain: (
    <>
      <path d="M12 26c-4 0-7-3-7-6.5S8 13 12 13c1-5.5 5.5-9 11-9 6.5 0 11.5 4.5 12 10 3.5.5 6 3 6 6s-2.5 6-6 6H12z" fill="#374151"/>
      <line x1="16" y1="32" x2="10" y2="50" stroke="#2563eb" strokeWidth="3" strokeLinecap="round"/>
      <line x1="24" y1="32" x2="18" y2="50" stroke="#2563eb" strokeWidth="3" strokeLinecap="round"/>
      <line x1="32" y1="32" x2="26" y2="50" stroke="#2563eb" strokeWidth="3" strokeLinecap="round"/>
      <line x1="40" y1="32" x2="34" y2="50" stroke="#2563eb" strokeWidth="3" strokeLinecap="round"/>
      <line x1="48" y1="32" x2="42" y2="50" stroke="#2563eb" strokeWidth="3" strokeLinecap="round"/>
      <line x1="20" y1="50" x2="14" y2="60" stroke="#2563eb" strokeWidth="3" strokeLinecap="round"/>
      <line x1="36" y1="50" x2="30" y2="60" stroke="#2563eb" strokeWidth="3" strokeLinecap="round"/>
    </>
  ),

  // Orages — nuage + éclair
  thunderstorm: (
    <>
      <path d="M14 28c-4 0-7-3-7-6.5S10 15 14 15c1-5.5 5.5-9 11-9 6.5 0 11.5 4.5 12 10 3.5.5 6 3 6 6s-2.5 6-6 6H14z" fill="#4b5563"/>
      <path d="M30 30l-6 12h8l-4 14 14-18h-9l5-8z" fill="#fbbf24"/>
      <line x1="18" y1="36" x2="16" y2="44" stroke="#60a5fa" strokeWidth="2" strokeLinecap="round"/>
      <line x1="44" y1="36" x2="42" y2="44" stroke="#60a5fa" strokeWidth="2" strokeLinecap="round"/>
    </>
  ),

  // Vent modéré — lignes courbes
  wind_moderate: (
    <>
      <path d="M8 24c8-2 16 2 24 0s12-4 20-2" stroke="#67e8f9" strokeWidth="2.5" strokeLinecap="round" fill="none"/>
      <path d="M8 32c8-2 16 2 24 0s12-4 20-2" stroke="#67e8f9" strokeWidth="3" strokeLinecap="round" fill="none"/>
      <path d="M8 40c8-2 16 2 24 0s12-4 20-2" stroke="#67e8f9" strokeWidth="2.5" strokeLinecap="round" fill="none"/>
      <path d="M12 28c6-1 12 1 18 0" stroke="#67e8f9" strokeWidth="2" strokeLinecap="round" fill="none" opacity="0.5"/>
    </>
  ),

  // Vent fort — lignes courbes + flèches
  windy: (
    <>
      <path d="M6 20c10-3 20 3 30 0s14-5 22-2" stroke="#06b6d4" strokeWidth="3" strokeLinecap="round" fill="none"/>
      <path d="M6 32c10-3 20 3 30 0s14-5 22-2" stroke="#06b6d4" strokeWidth="3.5" strokeLinecap="round" fill="none"/>
      <path d="M6 44c10-3 20 3 30 0s14-5 22-2" stroke="#06b6d4" strokeWidth="3" strokeLinecap="round" fill="none"/>
      <path d="M52 16l6 4-6 4" stroke="#06b6d4" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
      <path d="M52 28l6 4-6 4" stroke="#06b6d4" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
      <path d="M52 40l6 4-6 4" stroke="#06b6d4" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
    </>
  ),

  // Neige — flocons
  snow: (
    <>
      <path d="M16 26c-3.5 0-6-2.5-6-5.5s2.5-5.5 6-5.5c.5-4.5 4.5-8 9.5-8 5.5 0 10 4 10.5 8.5 3 .5 5.5 2.5 5.5 5.5s-2.5 5-5.5 5H16z" fill="#94a3b8"/>
      <path d="M20 34v10M15 39h10M17 36l6 6M23 36l-6 6" stroke="#bfdbfe" strokeWidth="2" strokeLinecap="round"/>
      <path d="M36 38v10M31 43h10M33 40l6 6M39 40l-6 6" stroke="#bfdbfe" strokeWidth="2" strokeLinecap="round"/>
      <path d="M28 48v8M25 52h6M26 50l4 4M30 50l-4 4" stroke="#93c5fd" strokeWidth="1.5" strokeLinecap="round"/>
    </>
  ),

  // Verglas / Gel — glace + gouttes
  freezing_rain: (
    <>
      <path d="M16 26c-3.5 0-6-2.5-6-5.5s2.5-5.5 6-5.5c.5-4.5 4.5-8 9.5-8 5.5 0 10 4 10.5 8.5 3 .5 5.5 2.5 5.5 5.5s-2.5 5-5.5 5H16z" fill="#6b7280"/>
      <line x1="18" y1="32" x2="16" y2="40" stroke="#60a5fa" strokeWidth="2" strokeLinecap="round"/>
      <line x1="28" y1="32" x2="26" y2="40" stroke="#60a5fa" strokeWidth="2" strokeLinecap="round"/>
      <line x1="38" y1="32" x2="36" y2="40" stroke="#60a5fa" strokeWidth="2" strokeLinecap="round"/>
      <path d="M20 44v8M17 48h6M18 46l4 4M22 46l-4 4" stroke="#67e8f9" strokeWidth="1.5" strokeLinecap="round"/>
      <path d="M34 44v8M31 48h6M32 46l4 4M36 46l-4 4" stroke="#67e8f9" strokeWidth="1.5" strokeLinecap="round"/>
    </>
  ),

  // Pluie verglaçante
  sleet: (
    <>
      <path d="M16 26c-3.5 0-6-2.5-6-5.5s2.5-5.5 6-5.5c.5-4.5 4.5-8 9.5-8 5.5 0 10 4 10.5 8.5 3 .5 5.5 2.5 5.5 5.5s-2.5 5-5.5 5H16z" fill="#6b7280"/>
      <line x1="18" y1="32" x2="16" y2="42" stroke="#60a5fa" strokeWidth="2.5" strokeLinecap="round"/>
      <line x1="30" y1="32" x2="28" y2="42" stroke="#60a5fa" strokeWidth="2.5" strokeLinecap="round"/>
      <path d="M40 34v8M37 38h6M38 36l4 4M42 36l-4 4" stroke="#67e8f9" strokeWidth="2" strokeLinecap="round"/>
      <line x1="22" y1="44" x2="20" y2="54" stroke="#60a5fa" strokeWidth="2" strokeLinecap="round"/>
      <path d="M34 46v6M32 49h4" stroke="#67e8f9" strokeWidth="1.5" strokeLinecap="round"/>
    </>
  ),

  // Gel — flocon + thermomètre froid
  frost: (
    <>
      <path d="M32 8v48M16 32h32M20 16l24 32M44 16L20 48" stroke="#93c5fd" strokeWidth="2" strokeLinecap="round" opacity="0.6"/>
      <path d="M32 8v48M16 32h32" stroke="#bfdbfe" strokeWidth="2.5" strokeLinecap="round"/>
      <circle cx="32" cy="8" r="3" fill="#bfdbfe"/>
      <circle cx="32" cy="56" r="3" fill="#bfdbfe"/>
      <circle cx="8" cy="32" r="3" fill="#bfdbfe" opacity="0.6"/>
      <circle cx="56" cy="32" r="3" fill="#bfdbfe" opacity="0.6"/>
      <circle cx="32" cy="32" r="5" fill="#60a5fa" opacity="0.3"/>
    </>
  ),

  // Canicule — soleil rouge/orange intense
  summer_heat: (
    <>
      <circle cx="32" cy="30" r="14" fill="#f97316"/>
      <circle cx="32" cy="30" r="10" fill="#fbbf24" opacity="0.6"/>
      <path d="M32 6v-2M32 58v-2M6 30H4M60 30h-2M12 12l-2-2M52 12l2-2M12 48l-2 2M52 48l2 2" stroke="#f97316" strokeWidth="3" strokeLinecap="round"/>
      <path d="M20 50c4 4 16 4 24 0" stroke="#ef4444" strokeWidth="2.5" strokeLinecap="round" fill="none"/>
      <path d="M24 54c3 2 10 2 16 0" stroke="#ef4444" strokeWidth="2" strokeLinecap="round" fill="none" opacity="0.6"/>
    </>
  ),

  // Gel intense — thermomètre bleu
  deep_frost: (
    <>
      <rect x="28" y="8" width="8" height="40" rx="4" fill="#1e3a5f" stroke="#60a5fa" strokeWidth="1.5"/>
      <circle cx="32" cy="48" r="8" fill="#3b82f6"/>
      <rect x="30" y="24" width="4" height="24" rx="2" fill="#3b82f6"/>
      <path d="M12 20v8M9 24h6M10 22l4 4M14 22l-4 4" stroke="#bfdbfe" strokeWidth="1.5" strokeLinecap="round"/>
      <path d="M50 16v8M47 20h6M48 18l4 4M52 18l-4 4" stroke="#bfdbfe" strokeWidth="1.5" strokeLinecap="round"/>
      <path d="M14 44v6M12 47h4" stroke="#93c5fd" strokeWidth="1.5" strokeLinecap="round"/>
    </>
  ),

  // Tempête — vent + pluie + éclair
  storm: (
    <>
      <path d="M12 24c-3.5 0-6-2.5-6-5.5s2.5-5.5 6-5.5c.5-4.5 4.5-8 9.5-8 5.5 0 10 4 10.5 8.5 3 .5 5.5 2.5 5.5 5.5s-2.5 5-5.5 5H12z" fill="#374151"/>
      <path d="M26 26l-4 8h6l-3 10 10-12h-6l4-6z" fill="#fbbf24"/>
      <path d="M6 34c8-2 14 2 20 0" stroke="#06b6d4" strokeWidth="2" strokeLinecap="round" fill="none"/>
      <path d="M6 40c8-2 14 2 20 0" stroke="#06b6d4" strokeWidth="2" strokeLinecap="round" fill="none"/>
      <line x1="42" y1="28" x2="38" y2="42" stroke="#3b82f6" strokeWidth="2.5" strokeLinecap="round"/>
      <line x1="50" y1="28" x2="46" y2="42" stroke="#3b82f6" strokeWidth="2.5" strokeLinecap="round"/>
      <line x1="46" y1="42" x2="42" y2="54" stroke="#3b82f6" strokeWidth="2" strokeLinecap="round"/>
    </>
  ),

  // Temps variable — soleil + nuage + goutte
  variable: (
    <>
      <circle cx="20" cy="18" r="8" fill="#fbbf24"/>
      <path d="M14 18l-3-1.5M20 8v-3M26 18l3-1.5M14 12l-2-2M26 12l2-2" stroke="#fbbf24" strokeWidth="2" strokeLinecap="round"/>
      <path d="M22 38c-3 0-5.5-2-5.5-4.5s2.5-4.5 5.5-4.5c.5-4 4-7 8.5-7 5 0 9 3.5 9.5 7.5 3 .5 5 2 5 4.5s-2 4.5-5 4.5H22z" fill="#9ca3af"/>
      <line x1="26" y1="42" x2="24" y2="50" stroke="#60a5fa" strokeWidth="2" strokeLinecap="round"/>
      <line x1="34" y1="42" x2="32" y2="50" stroke="#60a5fa" strokeWidth="2" strokeLinecap="round"/>
    </>
  ),

  // Printemps instable — fleurs + nuage
  spring_unstable: (
    <>
      <path d="M24 30c-2.5 0-4.5-2-4.5-4s2-4 4.5-4c.5-3.5 3.5-6 7-6 4 0 7 3 7.5 5.5 2.5.5 4 2 4 4s-1.5 3.5-4 3.5H24z" fill="#9ca3af" opacity="0.7"/>
      <circle cx="20" cy="48" r="3" fill="#f472b6"/>
      <circle cx="17" cy="45" r="2.5" fill="#f9a8d4"/>
      <circle cx="23" cy="45" r="2.5" fill="#f9a8d4"/>
      <circle cx="17" cy="51" r="2.5" fill="#f9a8d4"/>
      <circle cx="23" cy="51" r="2.5" fill="#f9a8d4"/>
      <circle cx="20" cy="48" r="2" fill="#fbbf24"/>
      <line x1="20" y1="54" x2="20" y2="60" stroke="#22c55e" strokeWidth="2" strokeLinecap="round"/>
      <path d="M18 58c2-2 4 0 4 0" stroke="#22c55e" strokeWidth="1.5" fill="none"/>
      <line x1="36" y1="34" x2="34" y2="42" stroke="#60a5fa" strokeWidth="2" strokeLinecap="round"/>
      <line x1="42" y1="34" x2="40" y2="42" stroke="#60a5fa" strokeWidth="2" strokeLinecap="round"/>
    </>
  ),

  // Été stable — soleil + ciel dégagé
  stable: (
    <>
      <circle cx="32" cy="28" r="14" fill="#fbbf24"/>
      <path d="M32 6v-3M32 56v-3M6 28H3M61 28h-3M12 10l-2-2M52 10l2-2" stroke="#fbbf24" strokeWidth="2.5" strokeLinecap="round"/>
      <circle cx="32" cy="28" r="9" fill="#f59e0b" opacity="0.3"/>
      <path d="M18 50c5 4 18 4 28 0" stroke="#fbbf24" strokeWidth="2" strokeLinecap="round" fill="none" opacity="0.5"/>
    </>
  ),

  // Automne perturbé — feuille + nuage
  autumn_disturbed: (
    <>
      <path d="M20 32c-2.5 0-4.5-2-4.5-4s2-4 4.5-4c.5-3.5 3.5-6 7-6 4 0 7 3 7.5 5.5 2.5.5 4 2 4 4s-1.5 3.5-4 3.5H20z" fill="#6b7280"/>
      <line x1="24" y1="36" x2="22" y2="44" stroke="#60a5fa" strokeWidth="2" strokeLinecap="round"/>
      <line x1="32" y1="36" x2="30" y2="44" stroke="#60a5fa" strokeWidth="2" strokeLinecap="round"/>
      <path d="M44 40c-2 8-10 14-10 14s8-2 12-6c4-4 4-10 2-14-2-4-6-4-8-2s-2 6 0 8c1 1 4 0 4 0z" fill="#f97316" opacity="0.9"/>
      <line x1="44" y1="40" x2="38" y2="52" stroke="#92400e" strokeWidth="1.5" strokeLinecap="round"/>
    </>
  ),

  // Hiver anticyclonique — thermomètre froid + soleil pâle
  winter_anticyclonic: (
    <>
      <circle cx="40" cy="20" r="10" fill="#94a3b8" opacity="0.5"/>
      <path d="M40 6v-2M52 20h2M28 20h-2M40 34v2M48 12l1.5-1.5M48 28l1.5 1.5M32 12l-1.5-1.5M32 28l-1.5 1.5" stroke="#94a3b8" strokeWidth="1.5" strokeLinecap="round" opacity="0.5"/>
      <rect x="14" y="24" width="6" height="30" rx="3" fill="#1e3a5f" stroke="#60a5fa" strokeWidth="1"/>
      <circle cx="17" cy="50" r="5" fill="#3b82f6"/>
      <rect x="15.5" y="36" width="3" height="14" rx="1.5" fill="#3b82f6"/>
    </>
  ),

  // Influence maritime — vagues
  maritime: (
    <>
      <path d="M4 32c4-4 8 0 12-4s8 0 12-4 8 0 12-4 8 0 12-4" stroke="#3b82f6" strokeWidth="3" strokeLinecap="round" fill="none"/>
      <path d="M4 42c4-4 8 0 12-4s8 0 12-4 8 0 12-4 8 0 12-4" stroke="#60a5fa" strokeWidth="2.5" strokeLinecap="round" fill="none"/>
      <path d="M4 52c4-4 8 0 12-4s8 0 12-4 8 0 12-4 8 0 12-4" stroke="#93c5fd" strokeWidth="2" strokeLinecap="round" fill="none" opacity="0.6"/>
      <circle cx="32" cy="16" r="6" fill="#94a3b8" opacity="0.3"/>
    </>
  ),

  // Îlot de chaleur urbain — bâtiments + chaleur
  urban_heat: (
    <>
      <rect x="10" y="30" width="12" height="24" fill="#475569"/>
      <rect x="26" y="22" width="12" height="32" fill="#334155"/>
      <rect x="42" y="34" width="12" height="20" fill="#475569"/>
      <rect x="13" y="34" width="3" height="4" fill="#fbbf24" opacity="0.6"/>
      <rect x="13" y="42" width="3" height="4" fill="#fbbf24" opacity="0.6"/>
      <rect x="30" y="26" width="3" height="4" fill="#fbbf24" opacity="0.6"/>
      <rect x="30" y="34" width="3" height="4" fill="#fbbf24" opacity="0.6"/>
      <path d="M8 28c2-4 4-2 6-6s4-2 6-6" stroke="#f97316" strokeWidth="1.5" strokeLinecap="round" fill="none" opacity="0.6"/>
      <path d="M40 20c2-4 4-2 6-6s4-2 6-6" stroke="#f97316" strokeWidth="1.5" strokeLinecap="round" fill="none" opacity="0.6"/>
    </>
  ),

  // Influence montagneuse — montagnes
  mountain: (
    <>
      <path d="M4 54l20-36 20 36H4z" fill="#475569"/>
      <path d="M24 18l-6 10h12l-6-10z" fill="#e2e8f0" opacity="0.8"/>
      <path d="M30 54l16-28 14 28H30z" fill="#334155"/>
      <path d="M46 26l-4 7h8l-4-7z" fill="#e2e8f0" opacity="0.7"/>
    </>
  ),

  // ═══ PARAMÈTRES MÉTÉO ═══

  // Température — thermomètre
  temperature: (
    <>
      <rect x="26" y="8" width="12" height="38" rx="6" fill="#1e293b" stroke="#ef4444" strokeWidth="2"/>
      <circle cx="32" cy="48" r="9" fill="#ef4444"/>
      <rect x="29" y="20" width="6" height="28" rx="3" fill="#ef4444"/>
      <line x1="32" y1="16" x2="32" y2="12" stroke="#ef4444" strokeWidth="2" strokeLinecap="round"/>
    </>
  ),

  // Précipitations — gouttes
  precipitation: (
    <>
      <path d="M32 8c0 0-16 18-16 28 0 9 7 16 16 16s16-7 16-16c0-10-16-28-16-28z" fill="#3b82f6" opacity="0.8"/>
      <path d="M32 8c0 0-10 12-10 20 0 6 4 10 10 10" fill="#60a5fa" opacity="0.4"/>
      <ellipse cx="28" cy="36" rx="3" ry="4" fill="#bfdbfe" opacity="0.5"/>
    </>
  ),

  // Vent — icône vent paramètre
  wind_param: (
    <>
      <path d="M8 22h30c4 0 7-3 7-7s-3-7-7-7c-2 0-4 1-5 3" stroke="#67e8f9" strokeWidth="3" strokeLinecap="round" fill="none"/>
      <path d="M8 34h36c3 0 5-2 5-5s-2-5-5-5" stroke="#67e8f9" strokeWidth="3" strokeLinecap="round" fill="none"/>
      <path d="M8 46h24c4 0 7 3 7 7s-3 7-7 7c-2 0-4-1-5-3" stroke="#67e8f9" strokeWidth="3" strokeLinecap="round" fill="none"/>
    </>
  ),

  // Couverture nuageuse — nuage violet
  cloud_cover: (
    <>
      <path d="M16 38c-5 0-9-4-9-8s4-8 9-8c1-7 7-12 14-12 8 0 14 6 15 13 4 1 7 4 7 8s-3 7-7 7H16z" fill="#a78bfa" opacity="0.8"/>
      <path d="M20 38c-3 0-5.5-2.5-5.5-5.5 0-2 1-3.5 2.5-4.5" stroke="#c4b5fd" strokeWidth="1.5" fill="none" opacity="0.5"/>
    </>
  ),

  // Humidité — goutte
  humidity: (
    <>
      <path d="M32 10c0 0-14 16-14 24 0 8 6 14 14 14s14-6 14-14c0-8-14-24-14-24z" fill="#60a5fa"/>
      <path d="M32 10c0 0-8 10-8 18 0 5 3 8 8 8" fill="#93c5fd" opacity="0.4"/>
      <ellipse cx="27" cy="34" rx="3" ry="4" fill="#bfdbfe" opacity="0.6"/>
    </>
  ),

  // Pression — baromètre
  pressure: (
    <>
      <circle cx="32" cy="34" r="20" fill="none" stroke="#a78bfa" strokeWidth="2.5"/>
      <circle cx="32" cy="34" r="16" fill="none" stroke="#a78bfa" strokeWidth="1" opacity="0.4"/>
      <path d="M32 34l8-12" stroke="#c4b5fd" strokeWidth="3" strokeLinecap="round"/>
      <circle cx="32" cy="34" r="3" fill="#a78bfa"/>
      <text x="32" y="56" textAnchor="middle" fill="#a78bfa" fontSize="8" fontWeight="bold">hPa</text>
    </>
  ),

  // ═══ INDICATEURS & INTERFACE ═══

  // Confiance — bouclier vert
  confidence: (
    <>
      <path d="M32 6L12 16v14c0 14 8 22 20 28 12-6 20-14 20-28V16L32 6z" fill="#166534" opacity="0.6"/>
      <path d="M32 6L12 16v14c0 14 8 22 20 28 12-6 20-14 20-28V16L32 6z" fill="none" stroke="#22c55e" strokeWidth="2.5"/>
      <path d="M24 32l6 6 12-12" stroke="#4ade80" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"/>
    </>
  ),

  // Mise à jour — flèche circulaire
  refresh: (
    <>
      <path d="M32 10c12 0 22 10 22 22s-10 22-22 22" stroke="#6b7280" strokeWidth="3" strokeLinecap="round" fill="none"/>
      <path d="M32 54c-12 0-22-10-22-22s10-22 22-22" stroke="#9ca3af" strokeWidth="3" strokeLinecap="round" fill="none"/>
      <path d="M38 8l-6 4 6 4" stroke="#9ca3af" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
      <path d="M26 56l6-4-6-4" stroke="#6b7280" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
    </>
  ),

  // Voir détails — chevron
  chevron_right: (
    <>
      <circle cx="32" cy="32" r="22" fill="none" stroke="#6b7280" strokeWidth="2"/>
      <path d="M26 20l12 12-12 12" stroke="#9ca3af" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
    </>
  ),

  // ═══ CLASSEMENT & PERFORMANCE ═══

  // Meilleur modèle — trophée
  trophy: (
    <>
      <path d="M20 12h24v14c0 8-5 14-12 14s-12-6-12-14V12z" fill="#fbbf24"/>
      <path d="M20 16h-6c0 8 4 12 6 12" stroke="#f59e0b" strokeWidth="2.5" fill="none"/>
      <path d="M44 16h6c0 8-4 12-6 12" stroke="#f59e0b" strokeWidth="2.5" fill="none"/>
      <rect x="28" y="40" width="8" height="8" fill="#f59e0b"/>
      <rect x="24" y="48" width="16" height="4" rx="2" fill="#f59e0b"/>
    </>
  ),

  // Modèle sélectionné — médaille
  medal: (
    <>
      <path d="M24 8l8 16 8-16" stroke="#f97316" strokeWidth="2.5" fill="none"/>
      <circle cx="32" cy="36" r="14" fill="#f97316" opacity="0.8"/>
      <circle cx="32" cy="36" r="10" fill="#fbbf24"/>
      <path d="M28 36l3 3 6-6" stroke="#f97316" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
    </>
  ),

  // Tendance hausse — flèche verte montante
  trend_up: (
    <>
      <path d="M8 48L24 32l8 8L56 16" stroke="#22c55e" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
      <path d="M44 16h12v12" stroke="#22c55e" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
    </>
  ),

  // Tendance baisse — flèche rouge descendante
  trend_down: (
    <>
      <path d="M8 16L24 32l8-8L56 48" stroke="#ef4444" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
      <path d="M44 48h12v-12" stroke="#ef4444" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
    </>
  ),

  // Nuit claire — lune
  clear_night: (
    <>
      <path d="M38 12c-12 0-22 10-22 22s10 22 22 22c-8 0-14-6-14-14s6-14 14-14c-4 0-8-4-8-8s4-8 8-8z" fill="#fbbf24" opacity="0.8"/>
      <circle cx="44" cy="18" r="2" fill="#fbbf24" opacity="0.5"/>
      <circle cx="50" cy="28" r="1.5" fill="#fbbf24" opacity="0.4"/>
      <circle cx="48" cy="40" r="1" fill="#fbbf24" opacity="0.3"/>
    </>
  ),
};

export default MeteoIcon;

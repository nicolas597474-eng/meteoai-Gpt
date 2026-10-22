import { usePageReady } from "@/contexts/PageReadinessContext";
import * as React from "react";
import type { CSSProperties } from "react";
import {
  getDashboardWeatherAtmosphere,
  getDashboardWeatherCloudOpacity,
  getDashboardWeatherFogOpacity,
  getDashboardWeatherHailIntensity,
  getDashboardWeatherSunlightOpacity,
  getDashboardWeatherWindMotion,
  hasDashboardHail,
  isDashboardFreezingPrecipitation,
  type DashboardWeatherAtmosphereInput,
} from "@/lib/dashboardWeatherAtmosphere";
import type { DashboardWeatherEffectsMode } from "@/lib/dashboardWeatherEffects";
import { HailWebGLCanvas } from "@/components/weather/HailWebGLCanvas";
import type { HailVisualCategory } from "@/lib/weatherReality/hailVisualEngine";
import { RainWebGLCanvas } from "@/components/weather/RainWebGLCanvas";
import { SnowWebGLCanvas } from "@/components/weather/SnowWebGLCanvas";

const RAIN_DROPS = [
  { left: 3, delay: -1.3, duration: 1.8, length: 17, depth: "far", drift: "-1.2vw" },
  { left: 8, delay: -0.4, duration: 2.2, length: 24, depth: "mid", drift: "1.4vw" },
  { left: 14, delay: -1.9, duration: 1.6, length: 31, depth: "near", drift: "2.6vw" },
  { left: 19, delay: -0.9, duration: 2.4, length: 18, depth: "far", drift: "-0.7vw" },
  { left: 24, delay: -1.6, duration: 1.9, length: 27, depth: "mid", drift: "1.8vw" },
  { left: 30, delay: -0.2, duration: 2.1, length: 34, depth: "near", drift: "2.9vw" },
  { left: 36, delay: -1.1, duration: 1.7, length: 20, depth: "far", drift: "-0.9vw" },
  { left: 42, delay: -2.2, duration: 2.5, length: 29, depth: "mid", drift: "1.1vw" },
  { left: 47, delay: -0.7, duration: 1.8, length: 35, depth: "near", drift: "3.1vw" },
  { left: 53, delay: -1.7, duration: 2.3, length: 16, depth: "far", drift: "-0.6vw" },
  { left: 58, delay: -0.1, duration: 1.6, length: 26, depth: "mid", drift: "1.6vw" },
  { left: 64, delay: -1.4, duration: 2.4, length: 33, depth: "near", drift: "2.4vw" },
  { left: 70, delay: -0.8, duration: 1.9, length: 19, depth: "far", drift: "-1vw" },
  { left: 76, delay: -2.1, duration: 2.2, length: 30, depth: "mid", drift: "1.3vw" },
  { left: 81, delay: -0.5, duration: 1.7, length: 36, depth: "near", drift: "2.8vw" },
  { left: 87, delay: -1.8, duration: 2.5, length: 18, depth: "far", drift: "-0.8vw" },
  { left: 92, delay: -0.3, duration: 2.1, length: 28, depth: "mid", drift: "1.7vw" },
  { left: 97, delay: -1.2, duration: 1.8, length: 32, depth: "near", drift: "2.2vw" },
  { left: 11, delay: -2.4, duration: 2.3, length: 23, depth: "mid", drift: "1.2vw" },
  { left: 67, delay: -0.6, duration: 1.6, length: 34, depth: "near", drift: "2.7vw" },
] as const;

const SNOW_PARTICLES = [
  { left: 4, delay: -2.2, duration: 10, size: 4 },
  { left: 11, delay: -6.4, duration: 8, size: 3 },
  { left: 18, delay: -4.1, duration: 12, size: 5 },
  { left: 26, delay: -8.2, duration: 9, size: 3 },
  { left: 34, delay: -1.4, duration: 11, size: 4 },
  { left: 42, delay: -5.6, duration: 8, size: 5 },
  { left: 50, delay: -3.3, duration: 12, size: 3 },
  { left: 58, delay: -9.1, duration: 10, size: 4 },
  { left: 66, delay: -2.8, duration: 9, size: 3 },
  { left: 74, delay: -7.3, duration: 12, size: 5 },
  { left: 82, delay: -4.8, duration: 8, size: 4 },
  { left: 90, delay: -1.9, duration: 11, size: 3 },
  { left: 96, delay: -6.8, duration: 9, size: 5 },
] as const;

const HAIL_PARTICLES = [
  { left: 7, delay: -0.6, duration: 3.4, size: 5 },
  { left: 18, delay: -2.4, duration: 2.8, size: 4 },
  { left: 29, delay: -1.2, duration: 3.1, size: 6 },
  { left: 41, delay: -3.3, duration: 2.6, size: 4 },
  { left: 53, delay: -0.9, duration: 3.6, size: 5 },
  { left: 65, delay: -2.8, duration: 2.9, size: 6 },
  { left: 77, delay: -1.7, duration: 3.2, size: 4 },
  { left: 89, delay: -3.8, duration: 2.7, size: 5 },
] as const;

const ICE_CRYSTALS = [
  { left: 3, top: 9, size: 18 },
  { left: 94, top: 16, size: 22 },
  { left: 7, top: 82, size: 20 },
  { left: 91, top: 77, size: 17 },
  { left: 51, top: 95, size: 13 },
] as const;

const ICE_SPIKES = [
  { left: 8, width: 5, height: 20 },
  { left: 22, width: 7, height: 31 },
  { left: 48, width: 5, height: 17 },
  { left: 72, width: 8, height: 27 },
  { left: 89, width: 6, height: 22 },
] as const;

const DUST_PARTICLES = [
  { left: 5, top: 26, delay: -2.2, duration: 17, size: 3 },
  { left: 13, top: 68, delay: -8.1, duration: 20, size: 2 },
  { left: 22, top: 42, delay: -4.7, duration: 16, size: 4 },
  { left: 31, top: 83, delay: -11.4, duration: 22, size: 3 },
  { left: 39, top: 18, delay: -6.3, duration: 18, size: 2 },
  { left: 48, top: 58, delay: -1.8, duration: 21, size: 4 },
  { left: 57, top: 31, delay: -9.6, duration: 17, size: 3 },
  { left: 66, top: 73, delay: -3.4, duration: 23, size: 2 },
  { left: 75, top: 47, delay: -13.1, duration: 19, size: 4 },
  { left: 84, top: 88, delay: -5.2, duration: 16, size: 3 },
  { left: 93, top: 34, delay: -10.7, duration: 22, size: 2 },
] as const;

const STARS = [
  { left: 8, top: 18, delay: -1.2 },
  { left: 21, top: 42, delay: -2.8 },
  { left: 39, top: 13, delay: -0.6 },
  { left: 58, top: 35, delay: -3.3 },
  { left: 72, top: 16, delay: -2.1 },
  { left: 91, top: 47, delay: -0.2 },
] as const;

function sampleEvenly<T>(items: readonly T[], count: number): T[] {
  if (count >= items.length) return [...items];
  if (count <= 0) return [];
  if (count === 1) return [items[Math.floor(items.length / 2)]];
  return Array.from({ length: count }, (_, index) =>
    items[Math.round((index * (items.length - 1)) / (count - 1))]
  );
}

type RainRendererMode = "css" | "webgl";

type RainLayerProps = {
  drops: typeof RAIN_DROPS[number][];
  effectsMode: DashboardWeatherEffectsMode;
  reduced: boolean;
  condition?: string | null;
  regime?: string | null;
  windSpeed?: number | null;
  windDirection?: number | null;
  windGust?: number | null;
};

function RainLayer({
  drops,
  effectsMode,
  reduced,
  condition,
  regime,
  windSpeed,
  windDirection,
  windGust,
}: RainLayerProps) {
  const [rendererMode, setRendererMode] = React.useState<RainRendererMode>("css");

  return (
    <div
      className="dashboard-weather-atmosphere__rain-layer"
      data-rain-renderer={rendererMode}
    >
      {rendererMode === "css" ? drops.map((drop, index) => (
        <i
          key={`rain-${index}`}
          className={`dashboard-weather-atmosphere__rain-drop dashboard-weather-atmosphere__rain-drop--${drop.depth}`}
          style={{
            left: `${drop.left}%`,
            height: `${drop.length}px`,
            animationDelay: `${drop.delay}s`,
            animationDuration: `${drop.duration * (reduced ? 1.45 : 1)}s`,
            "--rain-drift": drop.drift,
          } as CSSProperties}
        />
      )) : null}
      <RainWebGLCanvas
        effectsMode={effectsMode}
        isRainCategory
        condition={condition}
        regime={regime}
        windSpeedKmh={windSpeed}
        windDirectionDegrees={windDirection}
        windGustKmh={windGust}
        onRendererChange={setRendererMode}
      />
      <span className="dashboard-weather-atmosphere__wet-sheen" />
    </div>
  );
}

type SnowRendererMode = "css" | "webgl";

type SnowLayerProps = {
  flakes: (typeof SNOW_PARTICLES)[number][];
  effectsMode: DashboardWeatherEffectsMode;
  reduced: boolean;
  category: "light" | "steady" | "heavy";
  windSpeed?: number | null;
  windDirection?: number | null;
};

function SnowLayer({
  flakes,
  effectsMode,
  reduced,
  category,
  windSpeed,
  windDirection,
}: SnowLayerProps) {
  const [rendererMode, setRendererMode] = React.useState<SnowRendererMode>("css");

  return (
    <div
      className="dashboard-weather-atmosphere__snow-layer"
      data-snow-renderer={rendererMode}
    >
      {rendererMode === "css"
        ? flakes.map((particle, index) => (
            <i
              key={`snow-${index}`}
              className="dashboard-weather-atmosphere__snowflake"
              style={{
                left: `${particle.left}%`,
                top: "-6%",
                width: `${particle.size}px`,
                height: `${particle.size}px`,
                animationDelay: `${particle.delay}s`,
                animationDuration: `${particle.duration * (reduced ? 1.5 : 1)}s`,
              }}
            />
          ))
        : null}
      <SnowWebGLCanvas
        effectsMode={effectsMode}
        category={category}
        windSpeedKmh={windSpeed}
        windDirectionDegrees={windDirection}
        onRendererChange={setRendererMode}
      />
    </div>
  );
}

type HailRendererMode = "css" | "webgl";

type HailLayerProps = {
  particles: (typeof HAIL_PARTICLES)[number][];
  effectsMode: DashboardWeatherEffectsMode;
  reduced: boolean;
  category: HailVisualCategory;
  windSpeed?: number | null;
  windDirection?: number | null;
  windGust?: number | null;
};

function HailLayer({
  particles,
  effectsMode,
  reduced,
  category,
  windSpeed,
  windDirection,
  windGust,
}: HailLayerProps) {
  const [rendererMode, setRendererMode] = React.useState<HailRendererMode>("css");

  return (
    <div
      className="dashboard-weather-atmosphere__hail-layer"
      data-hail-renderer={rendererMode}
    >
      {rendererMode === "css"
        ? particles.map((particle, index) => (
            <i
              key={`hail-${index}`}
              className="dashboard-weather-atmosphere__hailstone"
              style={{
                left: `${particle.left}%`,
                top: "-6%",
                width: `${particle.size}px`,
                height: `${particle.size}px`,
                animationDelay: `${particle.delay}s`,
                animationDuration: `${particle.duration * (reduced ? 1.5 : 1)}s`,
              }}
            />
          ))
        : null}
      <HailWebGLCanvas
        effectsMode={effectsMode}
        category={category}
        windSpeedKmh={windSpeed}
        windDirectionDegrees={windDirection}
        windGustKmh={windGust}
        onRendererChange={setRendererMode}
      />
    </div>
  );
}

type DashboardWeatherAtmosphereProps = DashboardWeatherAtmosphereInput & {
  effectsMode?: DashboardWeatherEffectsMode;
  windDirection?: number | null;
  windGust?: number | null;
};

export function DashboardWeatherAtmosphere({
  effectsMode = "full",
  windDirection = null,
  windGust = null,
  ...weather
}: DashboardWeatherAtmosphereProps) {
  const pageReady = usePageReady();
  if (!pageReady || effectsMode === "off") return null;
  const { kind, intensity } = getDashboardWeatherAtmosphere(weather);
  if (kind === "none") return null;

  const reduced = effectsMode === "reduced";
  const fogOpacity =
    kind === "fog"
      ? getDashboardWeatherFogOpacity(weather.visibilityKm)
      : null;
  const cloudOpacity =
    kind === "clouds"
      ? getDashboardWeatherCloudOpacity(weather.cloudCover)
      : null;
  const windMotion = getDashboardWeatherWindMotion(
    weather.windSpeed,
    windDirection,
    windGust
  );
  const sunlightOpacity =
    kind === "sun" || kind === "cold-sun"
      ? getDashboardWeatherSunlightOpacity(weather.cloudCover)
      : null;
  const freezingPrecipitation = isDashboardFreezingPrecipitation(weather);
  const hasHail = hasDashboardHail(weather);
  const hailIntensity = hasHail
    ? getDashboardWeatherHailIntensity(weather)
    : "steady";
  const stormRainSignal =
    kind === "storm" &&
    /pluie|rain|averse|bruine/i.test(
      `${weather.condition ?? ""} ${weather.regime ?? ""}`
    );
  const rainDropCount =
    intensity === "heavy"
      ? reduced ? 10 : RAIN_DROPS.length
      : intensity === "light"
        ? reduced ? 5 : 9
        : reduced ? 7 : 14;
  const isRain = kind === "rain" || stormRainSignal || freezingPrecipitation;
  const snowParticles = sampleEvenly(SNOW_PARTICLES, reduced ? 7 : SNOW_PARTICLES.length);
  const hailParticles = sampleEvenly(
    HAIL_PARTICLES,
    reduced
      ? hailIntensity === "heavy" ? 4 : 3
      : hailIntensity === "light" ? 5 : HAIL_PARTICLES.length
  );
  const dustParticles = sampleEvenly(DUST_PARTICLES, reduced ? 6 : DUST_PARTICLES.length);
  const rainDrops = sampleEvenly(RAIN_DROPS, rainDropCount);
  const cloudOpacityScale = reduced ? 0.72 : 1;
  const cloudFarOpacity = cloudOpacity?.far ?? (reduced ? 0.12 : 0.18);
  const cloudNearOpacity = cloudOpacity?.near ?? (reduced ? 0.09 : 0.14);
  const effectiveWindOpacity = windMotion.opacity * (reduced ? 0.72 : 1);
  const effectiveWindDuration = windMotion.durationSeconds * (reduced ? 1.8 : 1);
  const cloudDriftDuration = Math.max(
    reduced ? 54 : 28,
    windMotion.durationSeconds + (reduced ? 28 : 12)
  );
  const atmosphereStyle = {
    ...(fogOpacity == null
      ? {}
      : {
          "--fog-mist-far-opacity": String(fogOpacity.far),
          "--fog-mist-near-opacity": String(fogOpacity.near),
        }),
    ...(kind === "clouds"
      ? {
          "--cloud-far-opacity": String(cloudFarOpacity * cloudOpacityScale),
          "--cloud-near-opacity": String(cloudNearOpacity * cloudOpacityScale),
          "--cloud-drift-x": windMotion.driftX,
          "--cloud-drift-y": windMotion.driftY,
          "--cloud-animation-duration": `${cloudDriftDuration}s`,
        }
      : {}),
    ...(kind === "wind"
      ? {
          "--wind-direction-angle": `${windMotion.directionAngleDeg ?? 0}deg`,
          "--wind-drift-x": windMotion.driftX,
          "--wind-drift-y": windMotion.driftY,
          "--wind-animation-duration": `${effectiveWindDuration}s`,
          "--wind-opacity": String(effectiveWindOpacity),
        }
      : {}),
    ...(hasHail
      ? {
          "--hail-drift-x": windMotion.driftX,
          "--hail-drift-y": windMotion.driftY,
        }
      : {}),
    ...(sunlightOpacity == null
      ? {}
      : { "--sunlight-opacity": String(sunlightOpacity * (reduced ? 0.72 : 1)) }),
  } as CSSProperties;

  return (
    <div
      className="dashboard-weather-atmosphere"
      data-weather-atmosphere={kind}
      data-weather-intensity={intensity}
      data-effects-mode={effectsMode}
      data-hail-signal={hasHail ? "reported" : undefined}
      data-freezing-precipitation={
        freezingPrecipitation ? "reported" : undefined
      }
      data-cloud-cover={
        kind === "clouds"
          ? cloudOpacity == null
            ? "unknown"
            : "reported"
          : undefined
      }
      data-wind-direction={
        kind === "wind"
          ? windMotion.directionAngleDeg == null
            ? "unknown"
            : "reported"
          : undefined
      }
      data-fog-visibility={
        kind === "fog"
          ? fogOpacity == null
            ? "unknown"
            : "reported"
          : undefined
      }
      style={atmosphereStyle}
      aria-hidden="true"
    >
      <span className="dashboard-weather-atmosphere__wash" />

      {isRain ? (
        <RainLayer
          drops={rainDrops}
          effectsMode={effectsMode}
          reduced={reduced}
          condition={weather.condition}
          regime={weather.regime}
          windSpeed={weather.windSpeed}
          windDirection={windDirection}
          windGust={windGust}
        />
      ) : null}

      {kind === "clouds" ? (
        <>
          <span className="dashboard-weather-atmosphere__cloud dashboard-weather-atmosphere__cloud--far" />
          <span className="dashboard-weather-atmosphere__cloud dashboard-weather-atmosphere__cloud--near" />
        </>
      ) : null}

      {kind === "sun" || kind === "cold-sun" ? (
        <>
          {kind === "sun" ? (
            <span className="dashboard-weather-atmosphere__sun-glow" />
          ) : (
            <span className="dashboard-weather-atmosphere__cold-sun-glow" />
          )}
        </>
      ) : null}

      {kind === "storm" ? (
        <span className="dashboard-weather-atmosphere__lightning" />
      ) : null}

      {kind === "snow" ? (
        <>
          <SnowLayer
            flakes={snowParticles}
            effectsMode={effectsMode}
            reduced={reduced}
            category={intensity}
            windSpeed={weather.windSpeed}
            windDirection={windDirection}
          />
          <span className="dashboard-weather-atmosphere__frost-wash" />
        </>
      ) : null}

      {hasHail ? (
        <HailLayer
          particles={hailParticles}
          effectsMode={effectsMode}
          reduced={reduced}
          category={hailIntensity}
          windSpeed={weather.windSpeed}
          windDirection={windDirection}
          windGust={windGust}
        />
      ) : null}

      {kind === "ice" ? (
        <>
          <span className="dashboard-weather-atmosphere__ice-film" />
          {ICE_SPIKES.map((spike, index) => (
            <i
              key={`ice-spike-${index}`}
              className="dashboard-weather-atmosphere__ice-spike"
              style={{
                left: `${spike.left}%`,
                width: `${spike.width}px`,
                height: `${spike.height}px`,
                animationDelay: `${index * -1.4}s`,
              }}
            />
          ))}
          {ICE_CRYSTALS.map((crystal, index) => (
            <i
              key={`ice-crystal-${index}`}
              className="dashboard-weather-atmosphere__ice-crystal"
              style={{
                left: `${crystal.left}%`,
                top: `${crystal.top}%`,
                width: `${crystal.size}px`,
                height: `${crystal.size}px`,
                animationDelay: `${index * -1.1}s`,
              }}
            />
          ))}
        </>
      ) : null}

      {kind === "dust" ? (
        <>
          <span className="dashboard-weather-atmosphere__dust-haze dashboard-weather-atmosphere__dust-haze--far" />
          <span className="dashboard-weather-atmosphere__dust-haze dashboard-weather-atmosphere__dust-haze--near" />
          {dustParticles.map((particle, index) => (
            <i
              key={`dust-${index}`}
              className="dashboard-weather-atmosphere__dust-particle"
              style={{
                left: `${particle.left}%`,
                top: `${particle.top}%`,
                width: `${particle.size}px`,
                height: `${particle.size}px`,
                animationDelay: `${particle.delay}s`,
                animationDuration: `${particle.duration * (reduced ? 1.5 : 1)}s`,
              }}
            />
          ))}
        </>
      ) : null}

      {kind === "fog" ? (
        <>
          <span className="dashboard-weather-atmosphere__mist dashboard-weather-atmosphere__mist--far" />
          <span className="dashboard-weather-atmosphere__mist dashboard-weather-atmosphere__mist--near" />
        </>
      ) : null}

      {kind === "wind" ? (
        <>
          <span className="dashboard-weather-atmosphere__wind-ribbon dashboard-weather-atmosphere__wind-ribbon--one" />
          <span className="dashboard-weather-atmosphere__wind-ribbon dashboard-weather-atmosphere__wind-ribbon--two" />
          <span className="dashboard-weather-atmosphere__wind-ribbon dashboard-weather-atmosphere__wind-ribbon--three" />
        </>
      ) : null}

      {kind === "heat" ? (
        <>
          <span className="dashboard-weather-atmosphere__heat-glow" />
          <span className="dashboard-weather-atmosphere__heat-ripple dashboard-weather-atmosphere__heat-ripple--one" />
          <span className="dashboard-weather-atmosphere__heat-ripple dashboard-weather-atmosphere__heat-ripple--two" />
          <span className="dashboard-weather-atmosphere__heat-ripple dashboard-weather-atmosphere__heat-ripple--three" />
        </>
      ) : null}

      {kind === "night"
        ? STARS.map((star, index) => (
            <i
              key={`star-${index}`}
              className="dashboard-weather-atmosphere__star"
              style={
                {
                  left: `${star.left}%`,
                  top: `${star.top}%`,
                  animationDelay: `${star.delay}s`,
                } as CSSProperties
              }
            />
          ))
        : null}
    </div>
  );
}

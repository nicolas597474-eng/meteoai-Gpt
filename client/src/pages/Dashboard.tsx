import { trpc } from "@/lib/trpc";
import { lazy, Suspense, useEffect, useMemo, useRef, useState, type ComponentProps, type CSSProperties } from "react";
import { keepPreviousData } from "@tanstack/react-query";
import { Droplets, Wind, Activity, Clock, CalendarDays, Eye, Thermometer, Sun, Radio, ChevronDown, ChevronUp, LogIn, Sparkles, X } from "lucide-react";
import { FavoritesBar } from "@/components/FavoritesBar";
import { useAuth } from "@/_core/hooks/useAuth";
import { useLocation } from "@/contexts/LocationContext";
import { getDashboardWeatherImage } from "@/lib/weatherImages";
import { formatDashboardCompactDate } from "@/lib/dashboardDate";
import { AlertBadge, isDangerousRegime } from "@/components/AlertBadge";
import { MeteoIcon } from "@/components/MeteoIcon";
import {dashboardCurrentIcon} from '@/lib/dashboardCurrentIcon';
import {
  getDashboardWeatherEffectsMode,
  type DashboardWeatherEffectsMode,
} from "@/lib/dashboardWeatherEffects";
import { useDeviceOrientation } from "@/hooks/useDeviceOrientation";
import { useProvenanceDisplay } from "@/contexts/ProvenanceDisplayContext";
import { findNextConditionChange, getNextWeatherAlert } from "@/lib/weatherCondition";
import { LocalOfficialDeltaChart } from "@/components/LocalOfficialDeltaChart";
import { LocalModelContributionNotice } from "@/components/LocalModelContributionNotice";
import { AltitudeCorrectionNotice } from "@/components/AltitudeCorrectionNotice";
import { dashboardTemperatureLayout } from "@/lib/dashboardTemperatureLayout";
import { getExtremeTemperatureTone } from "@/lib/extremeTemperatureTone";
import { DASHBOARD_LOAD_TIMEOUT_MS, DASHBOARD_PREVIEW_MESSAGE } from "@/lib/dashboardLoadState";
import { getLoginUrl } from "@/const";
import { BackToTopButton } from "@/components/BackToTopButton";
import { WeatherStatusBadge } from "@/components/weather/WeatherStatusBadge";
import { DashboardFusionTrace } from '@/components/weather/DashboardFusionTrace';
import { DashboardObservationDetails, ObservationDetailButton } from '@/components/weather/DashboardObservationDetails';
import { observationForecastField, type ObservationDetailKey } from '@/lib/observationDetail';
import { dailyForecastForToday } from '@/lib/dailyDetail';
import type { DashboardFusionTrace as FusionTrace } from '@shared/dashboardFusionTrace';
import { HourlyWeightingNotice } from "@/components/weather/HourlyWeightingNotice";
import { formatCurrentStateProvenance, formatDashboardNumber, getRegimeProvenancePresentation, withCurrentSnapshotFallback, type CurrentStateFieldLike } from "@/lib/dashboardPresentation";
import { getDashboardWind } from "@/lib/dashboardWind";
import { getDashboardSky } from "@/lib/dashboardSky";
import {
  getApparentTempTone,
  getCloudCoverTone,
  getHumidityTone,
  getPrecipitationTone,
  getPressureTone,
  getVisibilityTone,
  WIND_VALUE_COLOR,
} from "@/lib/observationTone";
import { getCurrentStationTemperature, withCurrentStationTemperature } from "@/lib/currentStationTemperature";
import { formatOptionalForecastValue } from "@/lib/forecastTimeline";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DEFAULT_OFFICIAL_FORECAST_LOCATION, getActiveOfficialForecastHour, getOfficialForecastCoordinates } from "@/lib/officialForecast";
import { useOfficialForecast } from "@/hooks/useOfficialForecast";
import { OfficialForecastCalculationTimes } from "@/components/weather/OfficialForecastCalculationTimes";
import { WeatherAILoader } from "@/components/weather/WeatherAILoader";

const HourlyChart = lazy(() => import("@/components/HourlyChart"));
const FifteenDayChart = lazy(() => import("@/components/FifteenDayChart"));
const EnvironmentalPanels = lazy(() =>
  import("@/components/EnvironmentalPanels").then(({ EnvironmentalPanels: Component }) => ({ default: Component })),
);

function EnvironmentalPanelsPlaceholder() {
  return (
    <div className="grid min-w-0 w-full grid-cols-1 gap-3 sm:grid-cols-2" aria-hidden="true">
      <div className="h-64 animate-pulse rounded-[22px] bg-slate-800/40" />
      <div className="h-64 animate-pulse rounded-[22px] bg-slate-800/40" />
    </div>
  );
}

function DeferredEnvironmentalPanels({ coords }: { coords: { lat: number; lon: number } }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [shouldLoad, setShouldLoad] = useState(false);
  const {
    data,
    error,
    isError,
    isFetching,
    isLoading,
    refetch,
  } = trpc.weather.getEnvironmentalSnapshot.useQuery(coords, {
    // The query and the visual component share this exact intersection gate.
    // Nothing environment-related starts on an above-the-fold Dashboard.
    enabled: shouldLoad,
    staleTime: 10 * 60 * 1000,
    refetchOnWindowFocus: false,
    retry: 1,
  });

  useEffect(() => {
    const target = containerRef.current;
    if (!target || typeof IntersectionObserver === "undefined") {
      setShouldLoad(true);
      return;
    }

    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        setShouldLoad(true);
        observer.disconnect();
      }
    }, { rootMargin: "800px 0px" });
    observer.observe(target);
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={containerRef}>
      {shouldLoad ? (
        <Suspense fallback={<EnvironmentalPanelsPlaceholder />}>
          <EnvironmentalPanels
            data={data}
            error={error}
            isError={isError}
            isFetching={isFetching}
            isLoading={isLoading}
            onRetry={() => void refetch()}
          />
        </Suspense>
      ) : <EnvironmentalPanelsPlaceholder />}
    </div>
  );
}

// ─── Wind Rose ───────────────────────────────────────────────────────────────
// Boussole reproduisant fidèlement l'image de référence : vue de face (aucune
// inclinaison 3D), fond bleu nuit #0A1A2F, cerclage noir à reflets métalliques,
// lunette argentée segmentée, cadran bleu nuit, graduations lumineuses #00BFFF,
// libellés cardinaux blancs agrandis et très lisibles, aiguille fine bleu
// lumineux avec queue en métal chromé, moyeu métallique à point bleu brillant.
function WindRose({ direction }: { direction: number | null }) {
  const { deviceHeading, status: orientationStatus, requestPermission, stopTracking } = useDeviceOrientation({ autoStart: false });
  const [isRotationEnabled, setIsRotationEnabled] = useState(false);
  // Bascule rotation / fixe : 1er clic = rotation auto (cap téléphone),
  // 2e clic = retour en position fixe (nord en haut, cap 0°).
  const compassHeading = isRotationEnabled ? (deviceHeading ?? 0) : 0;
  const isOrientationActive = isRotationEnabled && orientationStatus === "tracking" && deviceHeading != null;
  const isActivating = isRotationEnabled && !isOrientationActive;

  // Si le capteur est refusé ou indisponible, on revient en position fixe.
  useEffect(() => {
    if (isRotationEnabled && (orientationStatus === "denied" || orientationStatus === "unsupported")) {
      setIsRotationEnabled(false);
    }
  }, [isRotationEnabled, orientationStatus]);

  const handleToggleRotation = () => {
    if (isRotationEnabled) {
      stopTracking();
      setIsRotationEnabled(false);
    } else {
      setIsRotationEnabled(true);
      void requestPermission().then((granted) => {
        if (!granted) setIsRotationEnabled(false);
      });
    }
  };

  const activatingHint =
    orientationStatus === "waiting" ? "En attente du capteur…"
    : orientationStatus === "no-data" ? "Aucun cap reçu"
    : orientationStatus === "denied" ? "Capteur refusé"
    : orientationStatus === "unsupported" ? "Capteur indisponible"
    : "Activation…";

  const cardinalDirections = ["N", "NE", "E", "SE", "S", "SO", "O", "NO"] as const;
  const cardinalNames = ["nord", "nord-est", "est", "sud-est", "sud", "sud-ouest", "ouest", "nord-ouest"] as const;

  const hasDirection = typeof direction === "number" && Number.isFinite(direction) && direction >= 0 && direction <= 360;
  const directionIndex = hasDirection ? Math.round((direction % 360) / 45) % cardinalDirections.length : null;
  const directionName = directionIndex == null ? null : cardinalNames[directionIndex];
  const readableDirection = directionName ? `${directionName[0].toLocaleUpperCase("fr-FR")}${directionName.slice(1)}` : null;
  const bearingLabel = hasDirection ? `${new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 1 }).format(direction)}°` : null;
  const directionDescription = readableDirection && bearingLabel ? `${readableDirection} · ${bearingLabel}` : "Direction indisponible";
  const pointAt = (radius: number, angleDegrees: number) => {
    const angle = (angleDegrees - 90) * Math.PI / 180;
    return { x: 80 + radius * Math.cos(angle), y: 80 + radius * Math.sin(angle) };
  };

  // 8-point star: 4 long cardinal points + 4 shorter intercardinal points
  const starPoints = Array.from({ length: 8 }, (_, i) => {
    const angle = i * 45;
    const tipRadius = i % 2 === 0 ? 30 : 22;
    const tip = pointAt(tipRadius, angle);
    const leftBase = pointAt(6, angle - 22);
    const rightBase = pointAt(6, angle + 22);
    return {
      index: i,
      path: `M80 80 L${leftBase.x.toFixed(2)} ${leftBase.y.toFixed(2)} L${tip.x.toFixed(2)} ${tip.y.toFixed(2)} L${rightBase.x.toFixed(2)} ${rightBase.y.toFixed(2)} Z`,
    };
  });

  // Front-facing label positions - horizontal text at fixed positions (vue de face).
  // Libellés agrandis (17/11) et lueur renforcée pour des directions bien visibles.
  const labelPositions: { label: string; x: number; y: number; size: number }[] = [
    { label: "N", x: 80, y: 28, size: 20 },
    { label: "NE", x: 118, y: 42, size: 12 },
    { label: "E", x: 132, y: 80, size: 20 },
    { label: "SE", x: 118, y: 118, size: 12 },
    { label: "S", x: 80, y: 132, size: 20 },
    { label: "SO", x: 42, y: 118, size: 12 },
    { label: "O", x: 28, y: 80, size: 20 },
    { label: "NO", x: 42, y: 42, size: 12 },
  ];

  return (
    <button
      type="button"
      onClick={handleToggleRotation}
      aria-pressed={isRotationEnabled}
      className="mx-auto flex max-w-full cursor-pointer flex-col items-center gap-0.5 rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-sky-300"
      aria-label={`Boussole du vent : huit directions, nord en haut. ${directionDescription}.${isOrientationActive ? ` Cap téléphone : ${Math.round(compassHeading)}°. Touchez pour figer la boussole.` : isActivating ? ` ${activatingHint} Touchez pour annuler et figer la boussole.` : " Touchez pour orienter la boussole. Second clic pour figer."}`}
      title={isOrientationActive ? `Boussole orientée · Cap ${Math.round(compassHeading)}° — Touchez pour figer` : isActivating ? `${activatingHint} — Touchez pour annuler` : "Touchez pour activer l'orientation par le téléphone"}
    >
      <div className={`relative isolate grid size-[5.5rem] place-items-center rounded-full bg-[#0A1A2F] shadow-[0_8px_18px_rgba(0,8,20,0.75),0_0_16px_rgba(0,191,255,0.28)] ring-1 transition sm:size-[6.5rem] ${isOrientationActive ? "ring-2 ring-sky-300/70" : isActivating ? "ring-amber-200/60" : "ring-sky-100/20"}`}>
        <svg viewBox="0 0 160 160" className="absolute inset-0 z-10 size-full overflow-visible" aria-hidden="true">
          <defs>
            <linearGradient id="wind-compass-bezel" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#f2f7fb" />
              <stop offset="20%" stopColor="#b9c9d8" />
              <stop offset="50%" stopColor="#6a8096" />
              <stop offset="80%" stopColor="#3a4f64" />
              <stop offset="100%" stopColor="#a7bac9" />
            </linearGradient>
            <linearGradient id="wind-compass-outer-reflection" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#3d5268" stopOpacity="0.9" />
              <stop offset="18%" stopColor="#101a26" stopOpacity="0.4" />
              <stop offset="50%" stopColor="#000000" stopOpacity="0" />
              <stop offset="82%" stopColor="#101a26" stopOpacity="0.4" />
              <stop offset="100%" stopColor="#3d5268" stopOpacity="0.9" />
            </linearGradient>
            <radialGradient id="wind-compass-case" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="#14304c" />
              <stop offset="50%" stopColor="#0A1A2F" />
              <stop offset="100%" stopColor="#04101f" />
            </radialGradient>
            <radialGradient id="wind-compass-dial" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="#0d2440" />
              <stop offset="55%" stopColor="#0A1A2F" />
              <stop offset="100%" stopColor="#081527" />
            </radialGradient>
            <radialGradient id="wind-compass-glass" cx="50%" cy="20%" r="60%">
              <stop offset="0%" stopColor="#c0f0ff" stopOpacity="0.08" />
              <stop offset="50%" stopColor="#60b0dd" stopOpacity="0.03" />
              <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
            </radialGradient>
            <linearGradient id="wind-compass-light" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#e6f9ff" />
              <stop offset="35%" stopColor="#00cfff" />
              <stop offset="100%" stopColor="#0077c8" />
            </linearGradient>
            <linearGradient id="wind-compass-star-blue" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#d6f4ff" />
              <stop offset="30%" stopColor="#00bfff" />
              <stop offset="70%" stopColor="#0068b8" />
              <stop offset="100%" stopColor="#003a68" />
            </linearGradient>
            <linearGradient id="wind-compass-star-steel" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#f4f8fc" />
              <stop offset="40%" stopColor="#93a7bb" />
              <stop offset="100%" stopColor="#22384e" />
            </linearGradient>
            <linearGradient id="wind-compass-needle" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#f4fcff" />
              <stop offset="18%" stopColor="#3fe4ff" />
              <stop offset="50%" stopColor="#00bfff" />
              <stop offset="100%" stopColor="#0072b8" />
            </linearGradient>
            <linearGradient id="wind-compass-needle-tail" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="#ffffff" />
              <stop offset="28%" stopColor="#dce2e8" />
              <stop offset="52%" stopColor="#9ba6b0" />
              <stop offset="72%" stopColor="#edf2f6" />
              <stop offset="100%" stopColor="#64707c" />
            </linearGradient>
            <linearGradient id="wind-compass-needle-tail-facet" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="#aab4be" />
              <stop offset="48%" stopColor="#35404b" />
              <stop offset="100%" stopColor="#8995a1" />
            </linearGradient>
            <radialGradient id="wind-compass-hub" cx="50%" cy="40%" r="55%">
              <stop offset="0%" stopColor="#f0f6fa" />
              <stop offset="25%" stopColor="#b9c9d8" />
              <stop offset="55%" stopColor="#5c7488" />
              <stop offset="100%" stopColor="#14263a" />
            </radialGradient>
            <filter id="wind-compass-neon" x="-60%" y="-60%" width="220%" height="220%">
              <feGaussianBlur stdDeviation="1.8" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
            <filter id="wind-compass-neon-soft" x="-40%" y="-40%" width="180%" height="180%">
              <feGaussianBlur stdDeviation="1" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>

          {/* Anneau extérieur noir avec reflets métalliques (vue de face) */}
          <circle cx="80" cy="80" r="78" fill="#000000" stroke="#02060b" strokeWidth="1" />
          <circle cx="80" cy="80" r="78" fill="url(#wind-compass-outer-reflection)" opacity="0.55" />

          {/* Lunette métallique argentée */}
          <circle cx="80" cy="80" r="75" fill="url(#wind-compass-bezel)" stroke="#aabfce" strokeWidth="0.8" />

          {/* Séparateurs fins de la lunette (8 segments) */}
          {Array.from({ length: 8 }, (_, i) => {
            const angle = i * 45;
            const inner = pointAt(70, angle);
            const outer = pointAt(75, angle);
            return (
              <line
                key={`bezel-sep-${i}`}
                x1={inner.x}
                y1={inner.y}
                x2={outer.x}
                y2={outer.y}
                stroke="rgba(180,200,220,0.55)"
                strokeWidth="1.2"
              />
            );
          })}

          {/* Cerclage intérieur bleu nuit */}
          <circle cx="80" cy="80" r="70" fill="url(#wind-compass-case)" stroke="#04121f" strokeWidth="2" />

          {/* Cadran bleu nuit #0A1A2F */}
          <circle cx="80" cy="80" r="64" fill="url(#wind-compass-dial)" stroke="rgba(0,191,255,0.9)" strokeWidth="1.2" />

          {/* Anneaux gradués subtils */}
          <circle cx="80" cy="80" r="60" fill="none" stroke="rgba(0,191,255,0.45)" strokeWidth="0.5" />
          <circle cx="80" cy="80" r="56" fill="none" stroke="rgba(0,191,255,0.4)" strokeWidth="0.5" />
          <circle cx="80" cy="80" r="50" fill="none" stroke="rgba(0,191,255,0.35)" strokeWidth="0.5" />
          <circle cx="80" cy="80" r="40" fill="rgba(2,16,31,0.4)" stroke="rgba(0,191,255,0.55)" strokeWidth="0.5" />
          <circle cx="80" cy="80" r="36" fill="none" stroke="rgba(0,191,255,0.3)" strokeWidth="0.4" strokeDasharray="0.8 2" />

          {/* Reflet de verre */}
          <circle cx="80" cy="80" r="63" fill="url(#wind-compass-glass)" />

          {/* Anneau de points lumineux #00BFFF (tourne avec le cap) */}
          <g transform={`rotate(${-compassHeading}, 80, 80)`}>
            {Array.from({ length: 72 }, (_, i) => {
              const p = pointAt(57, i * 5);
              const isEmphasized = i % 9 === 0;
              return (
                <circle
                  key={`dial-dot-${i}`}
                  cx={p.x}
                  cy={p.y}
                  r={isEmphasized ? 0.8 : 0.4}
                  fill={isEmphasized ? "#00e0ff" : "#0d9cd8"}
                  opacity={isEmphasized ? 0.9 : 0.6}
                />
              );
            })}
            {/* Graduations fines lumineuses alternées longues/courtes */}
            {Array.from({ length: 36 }, (_, i) => {
              const angle = i * 10;
              const isMajor = i % 9 === 0;
              const innerR = isMajor ? 51 : 55;
              const inner = pointAt(innerR, angle);
              const outer = pointAt(59.5, angle);
              return (
                <line
                  key={`dial-tick-${i}`}
                  x1={inner.x}
                  y1={inner.y}
                  x2={outer.x}
                  y2={outer.y}
                  stroke={isMajor ? "#00d8ff" : "rgba(0,191,255,0.55)"}
                  strokeWidth={isMajor ? 1.3 : 0.55}
                  strokeLinecap="round"
                  filter={isMajor ? "url(#wind-compass-neon)" : undefined}
                />
              );
            })}
            {/* Rose des vents à huit branches */}
            {starPoints.map(({ index, path }) => (
              <path
                key={`compass-star-${index}`}
                d={path}
                fill={index % 2 === 0 ? "url(#wind-compass-star-blue)" : "url(#wind-compass-star-steel)"}
                stroke="rgba(150,220,255,0.5)"
                strokeWidth="0.45"
                opacity="0.85"
              />
            ))}
          </g>

          {/* Aiguille de direction du vent : pointe triangulaire fine bleu lumineux, presque jusqu'au bord */}
          {hasDirection ? (
            <g transform={`rotate(${direction - compassHeading}, 80, 80)`}>
              {/* Moitié avant - flèche bleu lumineux */}
              <path
                d="M80 23 L88 79 L80 74 L72 79 Z"
                fill="url(#wind-compass-needle)"
                stroke="#d0f8ff"
                strokeWidth="0.7"
                filter="url(#wind-compass-neon)"
              />
              {/* Ligne centrale de surbrillance */}
              <line x1="80" y1="27" x2="80" y2="70" stroke="rgba(255,255,255,0.7)" strokeWidth="0.6" strokeLinecap="round" />
              {/* Moitié arrière chromée : face claire, facette grise et arête polie. */}
              <path
                d="M80 137 L88 81 L80 86 L72 81 Z"
                fill="url(#wind-compass-needle-tail)"
                stroke="#d5dde5"
                strokeWidth="0.5"
              />
              <path d="M80 86 L88 81 L80 137 Z" fill="url(#wind-compass-needle-tail-facet)" />
              <line x1="80" y1="87" x2="80" y2="134" stroke="#f5f8fb" strokeOpacity="0.85" strokeWidth="0.55" strokeLinecap="round" />
            </g>
          ) : null}

          {/* Libellés cardinaux et intercardinaux blancs, agrandis et lumineux (vue de face) */}
<g transform={`rotate(${-compassHeading}, 80, 80)`}>
            {labelPositions.map(({ label, x, y, size }) => {
              const isCardinal = label.length === 1;
              return (
                <text
                  key={label}
                  x={x}
                  y={y}
                  textAnchor="middle"
                  dominantBaseline="central"
                  fontSize={size}
                  fontWeight="900"
                  fill="#ffffff"
                  stroke="rgba(1,8,18,0.9)"
                  strokeWidth={isCardinal ? 1.2 : 0.8}
                  paintOrder="stroke"
                  filter={isCardinal ? "url(#wind-compass-neon)" : "url(#wind-compass-neon-soft)"}
                  style={{ userSelect: "none", pointerEvents: "none" }}
                >
                  {label}
                </text>
              );
            })}
          </g>


          {/* Moyeu métallique avec point bleu lumineux */}
          <circle cx="80" cy="80" r="11" fill="url(#wind-compass-hub)" stroke="#c6d4e0" strokeWidth="0.7" />
          <circle cx="80" cy="80" r="8" fill="#0A1A2F" stroke="rgba(0,191,255,0.7)" strokeWidth="0.5" />
          <circle cx="80" cy="80" r="5.5" fill="url(#wind-compass-light)" stroke="#dffaff" strokeWidth="0.65" filter="url(#wind-compass-neon)" />
          <circle cx="78.5" cy="78.2" r="1.4" fill="rgba(255,255,255,0.9)" />
        </svg>
      </div>
      <p className="min-h-5 max-w-full text-center text-[13px] font-bold leading-snug text-cyan-100 sm:text-sm">{directionDescription}</p>
      {isOrientationActive ? (
        <span className="text-[9px] font-medium leading-none text-cyan-200/90">
          Cap {Math.round(compassHeading)}° · Touchez pour figer
        </span>
      ) : isActivating ? (
        <span className="text-[9px] font-medium leading-none text-amber-200/90">
          {activatingHint}
        </span>
      ) : null}
    </button>
  );
}


function currentStateFieldTitle(field?: CurrentStateFieldLike | null, snapshotAt?: string | null): string {
  const provenance = field?.provenance;
  if (!provenance) return snapshotAt ? `Snapshot Open-Meteo · ${snapshotAt}` : "Aucune provenance courante disponible.";
  const measurements = provenance.measurements.map((measurement) =>
    `${measurement.stationName} (${measurement.source}) · ${measurement.observedAt} · ${measurement.ageMinutes} min`
  );
  return [provenance.label, ...measurements, provenance.reason].filter(Boolean).join("\n");
}

function currentNumber(field?: CurrentStateFieldLike | null): number | null {
  return typeof field?.value === "number" && Number.isFinite(field.value) ? field.value : null;
}

function currentString(field?: CurrentStateFieldLike | null): string | null {
  const value = typeof field?.value === "string" ? field.value.trim() : "";
  return value && !/^(?:conditions? indisponibles|indisponible)$/i.test(value) ? value : null;
}

function formatHourlyForecastValidAt(validAt?: number | null): string {
  if (typeof validAt !== "number" || !Number.isFinite(validAt)) return "Échéance indisponible";
  return new Date(validAt).toLocaleString("fr-FR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Paris",
  }) + " · Europe/Paris";
}

function formatHourlyForecastSource(source?: string | null): string {
  const normalized = source?.trim();
  if (!normalized) return "Source non documentée";
  return normalized.toLowerCase() === "open-meteo" ? "Open-Meteo" : normalized;
}

function formatHourlyForecastComputedAt(computedAt?: string | null): string {
  if (!computedAt) return "Calcul indisponible";
  const date = new Date(computedAt);
  if (!Number.isFinite(date.getTime())) return "Calcul indisponible";
  return `Calcul ${date.toLocaleString("fr-FR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Paris",
  })} · Europe/Paris`;
}

// ─── UV Index indicator ────────────────────────────────────────────────────────
function UVBadge({ uv }: { uv: number | null }) {
  if (uv == null) return <span className="text-lg font-semibold">—</span>;
  const level = uv <= 2 ? { label: "Faible", color: "text-green-400" }
    : uv <= 5 ? { label: "Modéré", color: "text-yellow-400" }
    : uv <= 7 ? { label: "Élevé", color: "text-orange-400" }
    : uv <= 10 ? { label: "Très élevé", color: "text-red-400" }
    : { label: "Extrême", color: "text-purple-400" };
  return (
    <div className="flex flex-col items-center">
      <span className={`text-lg font-bold sm:text-2xl ${level.color}`}>{Math.round(uv)}</span>
      <span className={`text-[11px] sm:text-sm ${level.color} opacity-80`}>{level.label}</span>
    </div>
  );
}

function getStoredLocalMode(): "standard" | "local" | "ultra-local" {
  try {
    const stored = localStorage.getItem("meteoai_local_mode");
    return stored === "local" || stored === "ultra-local" ? stored : "standard";
  } catch { return "standard"; }
}

function storeLocalMode(mode: "standard" | "local" | "ultra-local") {
  try { localStorage.setItem("meteoai_local_mode", mode); } catch {}
}

function formatRegimeWeight(value: unknown): string {
  return typeof value === "number" && Number.isFinite(value) ? `${Math.round(value * 100)}%` : "—";
}

const PERSONAL_CONDITION_OPTIONS = [
  { id: "sunny", label: "Ensoleillé" },
  { id: "few_clouds", label: "Quelques nuages" },
  { id: "partly_cloudy", label: "Partiellement nuageux" },
  { id: "very_cloudy", label: "Très nuageux" },
  { id: "overcast", label: "Ciel couvert" },
  { id: "fog", label: "Brouillard" },
  { id: "few_drops", label: "Quelques gouttes" },
  { id: "drizzle", label: "Bruine" },
  { id: "light_rain", label: "Pluie faible" },
  { id: "rain", label: "Pluie" },
  { id: "heavy_rain", label: "Forte pluie" },
  { id: "showers", label: "Averses" },
  { id: "storm", label: "Orage" },
  { id: "snow", label: "Neige" },
] as const;

const PERSONAL_PRECIPITATION_CONDITIONS = new Set(["few_drops", "drizzle", "light_rain", "rain", "heavy_rain", "showers", "storm"]);
const acceptsPersonalPrecipitation = (condition: string) => PERSONAL_PRECIPITATION_CONDITIONS.has(condition);

function DominantRegimePanel({
  regime,
  panelDate,
  regimeSourceLabel,
  regimeFreshnessLabel,
  regimeSourceUpdatedAt,
  showRegimeMenu,
  setShowRegimeMenu,
  regimeCatalogue,
  allRegimeIds,
  allRegimesExpanded,
  expandedRegimeIds,
  setExpandedRegimeIds,
  primaryRegimeId,
}: {
  regime: any;
  panelDate: string;
  regimeSourceLabel: string;
  regimeFreshnessLabel: string;
  regimeSourceUpdatedAt: string | null;
  showRegimeMenu: boolean;
  setShowRegimeMenu: any;
  regimeCatalogue: any[];
  allRegimeIds: string[];
  allRegimesExpanded: boolean;
  expandedRegimeIds: string[];
  setExpandedRegimeIds: any;
  primaryRegimeId: string;
}) {
  return (
    <section className="dashboard-sky-card rounded-xl border border-slate-600/50 bg-slate-900/65 px-2.5 py-1 sm:px-3 sm:py-1.5" aria-label="Régime de prévision dominant">
      <div className="mb-1 flex justify-center sm:mb-1.5">
        <p className="text-lg font-bold tracking-tight text-slate-50 sm:text-xl">{panelDate}</p>
      </div>
      <div className="flex items-center gap-1.5 sm:gap-2">
        <button
          type="button"
          onClick={() => setShowRegimeMenu((open: boolean) => !open)}
          aria-expanded={showRegimeMenu}
          aria-controls="regime-catalogue"
          className="-mx-1 flex min-w-0 flex-1 items-center gap-2 rounded-lg px-1 py-0.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
        >
          <span className="grid h-6 w-6 shrink-0 place-items-center rounded-md bg-slate-950/35 text-sm sm:h-7 sm:w-7 sm:text-base">{regime.emoji}</span>
          <div className="min-w-0">
            <p className="text-[8px] font-semibold uppercase tracking-[0.12em] text-sky-200/75 sm:text-[9px] sm:tracking-[0.14em]">État du ciel</p>
            <p className="flex items-center gap-1 text-[11px] font-semibold text-white sm:text-xs">{regime.label} {showRegimeMenu ? <ChevronUp className="h-3.5 w-3.5 text-primary" /> : <ChevronDown className="h-3.5 w-3.5 text-slate-300" />}</p>
            <p className="hidden text-xs leading-tight text-muted-foreground sm:block">{regime.description}</p>
            {regimeSourceLabel && regimeFreshnessLabel ? <p className="text-[9px] leading-tight text-sky-200/80 sm:mt-0.5 sm:text-[10px]">{regimeSourceLabel} · {regimeFreshnessLabel}</p> : null}
            <span className="sr-only">Voir les 20 régimes</span>
          </div>
        </button>
      </div>
      <div className="mt-0.5 flex flex-wrap gap-1 sm:mt-1">
        <span className="rounded-full border border-orange-500/30 bg-orange-500/20 px-1.5 py-px text-[11px] font-medium text-orange-300 sm:px-2 sm:py-0.5 sm:text-xs">🌡 {Math.round(regime.weights.temp * 100)}%</span>
        <span className="rounded-full border border-blue-500/30 bg-blue-500/20 px-1.5 py-px text-[11px] font-medium text-blue-300 sm:px-2 sm:py-0.5 sm:text-xs">🌧 {Math.round(regime.weights.precip * 100)}%</span>
        <span className="rounded-full border border-cyan-500/30 bg-cyan-500/20 px-1.5 py-px text-[11px] font-medium text-cyan-300 sm:px-2 sm:py-0.5 sm:text-xs">💨 {Math.round(regime.weights.wind * 100)}%</span>
        <span className="rounded-full border border-purple-500/30 bg-purple-500/20 px-1.5 py-px text-[11px] font-medium text-purple-300 sm:px-2 sm:py-0.5 sm:text-xs">☁ {Math.round(regime.weights.condition * 100)}%</span>
      </div>
      {showRegimeMenu && (
        <div id="regime-catalogue" className="mt-2 rounded-lg border border-slate-600/35 bg-slate-950/30 p-2" aria-label="Tous les régimes météo possibles">
          <div className="mb-2 flex items-center justify-between gap-2 px-1">
            <p className="text-[10px] font-medium uppercase tracking-[0.12em] text-slate-400">Tous les régimes</p>
            <div className="flex items-center gap-1.5">
              <button type="button" onClick={() => setExpandedRegimeIds(allRegimesExpanded ? [] : allRegimeIds)} aria-label={allRegimesExpanded ? "Tout réduire les régimes" : "Tout développer les régimes"} className="min-h-7 rounded-md border border-primary/30 bg-primary/10 px-2 text-[9px] font-semibold text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
                {allRegimesExpanded ? "Tout réduire" : "Tout développer"}
              </button>
              <span className="rounded-full border border-slate-600/50 bg-slate-900/60 px-1.5 py-0.5 text-[9px] text-slate-400">{regimeCatalogue.length || 20}</span>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-1 sm:grid-cols-2">
            {regimeCatalogue.map((candidate: any) => {
              const isActive = candidate.id === primaryRegimeId;
              const isExpanded = expandedRegimeIds.includes(candidate.id);
              const detailsId = `regime-weights-${candidate.id}`;
              const weights = candidate?.weights && typeof candidate.weights === "object" ? candidate.weights : null;
              const weightRows = [
                { label: "Temp.", value: weights?.temp, color: "bg-orange-400" },
                { label: "Pluie", value: weights?.precip, color: "bg-blue-400" },
                { label: "Vent", value: weights?.wind, color: "bg-cyan-400" },
                { label: "Cond.", value: weights?.condition, color: "bg-violet-400" },
              ];
              return (
                <div key={candidate.id} className={`min-w-0 rounded-md text-[10px] ${isActive ? "bg-primary/15 text-primary ring-1 ring-primary/25" : "bg-slate-900/25 text-slate-300"}`}>
                  <button type="button" onClick={() => setExpandedRegimeIds((current: string[]) => current.includes(candidate.id) ? current.filter((id) => id !== candidate.id) : [...current, candidate.id])} aria-expanded={isExpanded} aria-controls={detailsId} aria-label={`${isExpanded ? "Replier" : "Afficher"} les pondérations de ${candidate.label}`} className="flex w-full min-w-0 items-start gap-1.5 px-1.5 py-1.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
                    <span className="pt-px">{candidate.emoji}</span>
                    <span className="min-w-0 flex-1"><strong className="block truncate">{candidate.label}{isActive ? " · actif" : ""}</strong><span className="mt-0.5 hidden leading-snug text-slate-400 sm:block">{candidate.description}</span></span>
                    {isExpanded ? <ChevronUp className="mt-px h-3 w-3 shrink-0" aria-hidden="true" /> : <ChevronDown className="mt-px h-3 w-3 shrink-0 text-slate-500" aria-hidden="true" />}
                  </button>
                  {isExpanded && (
                    <div id={detailsId} className="mx-1.5 mb-1.5 grid grid-cols-2 gap-x-2 gap-y-1.5 border-t border-slate-700/40 pt-1.5 text-[8px] leading-tight text-slate-400">
                      {weightRows.map((weight) => {
                        const percent = typeof weight.value === "number" && Number.isFinite(weight.value) ? Math.max(0, Math.min(100, Math.round(weight.value * 100))) : 0;
                        return <div key={weight.label} className="min-w-0"><div className="mb-0.5 flex items-center justify-between gap-1"><span>{weight.label}</span><span className="font-medium text-slate-300">{formatRegimeWeight(weight.value)}</span></div><div className="h-1 overflow-hidden rounded-full bg-slate-700/70" role="progressbar" aria-label={`Poids ${weight.label}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}><div className={`h-full rounded-full ${weight.color}`} style={{ width: `${percent}%` }} /></div></div>;
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
      {(regimeFreshnessLabel || regimeSourceUpdatedAt) ? <p className="mt-0.5 hidden text-[10px] font-medium text-slate-300 sm:block">{regimeFreshnessLabel}{regimeSourceUpdatedAt ? ` · source à ${regimeSourceUpdatedAt} (Europe/Paris)` : ""}</p> : null}
    </section>
  );
}

export default function Dashboard() {
  const { user, loading: authLoading } = useAuth();
  const { activeLocation: contextLocation, setActiveLocation: setContextLocation } = useLocation();
  const [localMode, setLocalMode] = useState<"standard" | "local" | "ultra-local">(getStoredLocalMode);
  const [weatherEffectsMode] = useState<DashboardWeatherEffectsMode>(getDashboardWeatherEffectsMode);
  const { showProvenance } = useProvenanceDisplay();
  const [hasWaitTimedOut, setHasWaitTimedOut] = useState(false);
  const [showRegimeMenu, setShowRegimeMenu] = useState(false);
  const [expandedRegimeIds, setExpandedRegimeIds] = useState<string[]>([]);
  const [personalTemperature, setPersonalTemperature] = useState("");
  const [personalWind, setPersonalWind] = useState("");
  const [personalPrecipitation, setPersonalPrecipitation] = useState("");
  const [personalCondition, setPersonalCondition] = useState<(typeof PERSONAL_CONDITION_OPTIONS)[number]["id"]>("partly_cloudy");
  const [personalSubmitResult, setPersonalSubmitResult] = useState<{ notice: string } | null>(null);
  const [personalFormError,setPersonalFormError]=useState('');
  const [personalEditError,setPersonalEditError]=useState('');
  const [personalOnline,setPersonalOnline]=useState(navigator.onLine);
  useEffect(()=>{const changed=()=>setPersonalOnline(navigator.onLine);window.addEventListener('online',changed);window.addEventListener('offline',changed);return()=>{window.removeEventListener('online',changed);window.removeEventListener('offline',changed);};},[]);
  const [isPersonalObservationOpen, setIsPersonalObservationOpen] = useState(false);
  const [isPersonalHistoryOpen, setIsPersonalHistoryOpen] = useState(false);
  const [showAllLocalContributors, setShowAllLocalContributors] = useState(false);
  const [diagnosticsEnabled, setDiagnosticsEnabled] = useState(false);
  const [editingPersonalObservation, setEditingPersonalObservation] = useState<{ id: number; temperature: string; windSpeed: string; precipitation: string; condition: (typeof PERSONAL_CONDITION_OPTIONS)[number]["id"] } | null>(null);
  // LocationContext owns the selected place, including its station radius.
  // Dashboard must never fall back to the retired dashboard-only location key.
  const selectedLocation = contextLocation;
  const [selectedObservation, setSelectedObservation] = useState<ObservationDetailKey | null>(null);
  const [dailyDetailRequest,setDailyDetailRequest]=useState<{date:string;sequence:number}|null>(null);
  const dailyDetailTrigger=useRef<HTMLButtonElement|null>(null);
  const observationTrigger = useRef<HTMLButtonElement | null>(null);
  const openObservation = (metric: ObservationDetailKey, trigger: HTMLButtonElement) => {
    observationTrigger.current = trigger;
    setSelectedObservation(metric);
  };
  // Fermer le détail lors du changement de lieu évite de conserver une valeur de l’ancien lieu.
  useEffect(() => {
    setSelectedObservation(null);
    setDailyDetailRequest(null);
  }, [selectedLocation?.lat, selectedLocation?.lon]);

  const handleLocationChange = (loc: { lat: number; lon: number; name: string; radiusKm: number; favoriteId?: number; localMode?: "standard" | "local" | "ultra-local" }) => {
    setContextLocation({ lat: loc.lat, lon: loc.lon, name: loc.name, favoriteId: loc.favoriteId, radiusKm: loc.radiusKm, localMode: loc.localMode ?? "standard" });
    if (loc.localMode) {
      setLocalMode(loc.localMode);
      storeLocalMode(loc.localMode);
    }
  };

  const handleModeChange = (mode: "standard" | "local" | "ultra-local") => {
    setLocalMode(mode);
    storeLocalMode(mode);
  };

  // Use location-aware query when a location is selected
  const queryInput = useMemo(() => ({
    ...getOfficialForecastCoordinates(selectedLocation),
    radiusKm: selectedLocation?.radiusKm ?? 20,
    localMode,
  }), [selectedLocation?.lat, selectedLocation?.lon, selectedLocation?.radiusKm, localMode]);

  const needsLocalStations = localMode !== "standard";
  const { data: locationWeather, isFetching: locationWeatherFetching, isPlaceholderData: locationWeatherIsPlaceholder, error: locationWeatherError, refetch: refetchLocationWeather } = trpc.favorites.getLocationWeather.useQuery(
    queryInput,
    {
      enabled: !!selectedLocation && needsLocalStations,
      staleTime: 90 * 1000,
      gcTime: 10 * 60 * 1000,
      refetchInterval: 5 * 60 * 1000,
      refetchOnWindowFocus: false,
      retry: 1,
    }
  );

  // Pre-loaded forecasts for all favorites (from the configured schedule)
  const { data: preloadedForecasts } = trpc.favorites.getPreloadedForecasts.useQuery(
    undefined,
    { enabled: !!user, staleTime: 5 * 60 * 1000 }
  );

  // Build prefetchedWeather map for FavoritesBar pills (key = "fav-{id}")
  const prefetchedWeather = useMemo(() => {
    if (!preloadedForecasts) return undefined;
    const map = new Map<string, { temp: number | null; condition: string | null }>();
    for (const pf of preloadedForecasts) {
      if (pf.forecast) {
        map.set(`fav-${pf.favoriteId}`, {
          temp: pf.forecast.tempCurrent ?? null,
          condition: pf.forecast.condition,
        });
      }
    }
    return map;
  }, [preloadedForecasts]);

  // Coordinates for weather queries — use active location or Hondeghem default
  const coordsInput = useMemo(() => ({
    ...getOfficialForecastCoordinates(selectedLocation),
  }), [selectedLocation?.lat, selectedLocation?.lon]);

  // Dashboard (MeteoAI synthesis) — always location-aware
  const { data: dash, isFetching: dashFetching, refetch: refetchDashboard } = trpc.weather.getDashboard.useQuery(
    coordsInput,
    {
      enabled: diagnosticsEnabled,
      staleTime: 60 * 1000,
      refetchInterval: 5 * 60 * 1000,
      refetchOnWindowFocus: false,
    }
  );
  // Réponse officielle consolidée : le hook partagé alimente Dashboard et Détails avec le même lieu et la même politique de rafraîchissement.
  const { query: officialForecastQuery } = useOfficialForecast(selectedLocation);
  const { data: officialForecast, isLoading: officialLoading, isError: officialError, isFetching: officialFetching, refetch: refetchOfficialForecast } = officialForecastQuery;
  const { data: dashboardDailyForecast, isLoading: dashboardDailyLoading, isFetching: dashboardDailyFetching, refetch: refetchDashboardDaily } = trpc.weather.getDashboardDailyForecast.useQuery(
    coordsInput,
    {
      // The daily horizon is visually below the current conditions. Waiting for
      // the critical hourly forecast prevents competing cold-start requests.
      enabled: !officialLoading || !!officialForecast,
      staleTime: 5 * 60 * 1000,
      refetchOnWindowFocus: false,
    },
  );
  const { data: currentDashboardWeather } = trpc.favorites.getCurrentDashboardWeather.useQuery(
    coordsInput,
    { staleTime: 60 * 1000, refetchInterval: 5 * 60 * 1000, refetchOnWindowFocus: false, retry: 1 },
  );
  const { data: fastCurrentSnapshot } = trpc.weather.getCurrentModelSnapshot.useQuery(
    coordsInput,
    { staleTime: 60 * 1000, refetchInterval: 5 * 60 * 1000, refetchOnWindowFocus: false, retry: 1 },
  );
  const hourlyLoading = officialLoading;
  const hourlyError = officialError;
  const hourlyFetching = officialFetching;
  const { data: localOfficialHistory } = trpc.weather.getLocalOfficialDeltaHistory.useQuery(
    coordsInput, { enabled: diagnosticsEnabled, staleTime: 5 * 60 * 1000 }
  );
  const { data: regimeCatalogue = [] } = trpc.weather.getRegimeCatalogue.useQuery(
    undefined, { enabled: diagnosticsEnabled, staleTime: 60 * 60 * 1000 }
  );
  const utils = trpc.useUtils();
  const { data: personalHistory = [], isLoading:personalHistoryLoading,error:personalHistoryError,refetch:refetchPersonalHistory } = trpc.personalObservations.history.useQuery(
    coordsInput,
    { enabled: !!user && isPersonalHistoryOpen, staleTime: 60 * 1000 }
  );
  const refreshPersonalObservationData = async () => {
    await utils.personalObservations.history.invalidate();
  };
  const submitPersonalObservation = trpc.personalObservations.submit.useMutation({
    onSuccess: async (result) => {
      setPersonalSubmitResult({ notice: result.notice });
      await refreshPersonalObservationData();
    },
  });
  const updatePersonalObservation = trpc.personalObservations.update.useMutation({
    onSuccess: async () => { setEditingPersonalObservation(null); await refreshPersonalObservationData(); },
  });
  const deletePersonalObservation = trpc.personalObservations.delete.useMutation({
    onSuccess: async () => { await refreshPersonalObservationData(); },
  });

  const handlePersonalObservationSubmit = () => {
    setPersonalFormError('');
    if(!navigator.onLine){setPersonalFormError('Une connexion est nécessaire pour enregistrer votre observation.');return;}
    const temperature = personalTemperature.trim() === "" ? null : Number(personalTemperature.replace(",", "."));
    const windSpeed = personalWind.trim() === "" ? null : Number(personalWind.replace(",", "."));
    const precipitationInput = personalPrecipitation.trim() === "" ? null : Number(personalPrecipitation.replace(",", "."));
    const precipitation = acceptsPersonalPrecipitation(personalCondition) ? precipitationInput : null;
    if ((temperature != null && !Number.isFinite(temperature)) || (windSpeed != null && !Number.isFinite(windSpeed)) || (precipitation != null && (!Number.isFinite(precipitation) || precipitation < 0))) {setPersonalFormError('Vérifiez les nombres saisis. Vous pouvez utiliser une virgule décimale.');return;}
    setPersonalSubmitResult(null);
    submitPersonalObservation.mutate({ ...coordsInput, temperature, condition: personalCondition, windSpeed, precipitation });
  };
  const savePersonalObservationEdit = () => {
    if (!editingPersonalObservation) return;
    setPersonalEditError('');
    if(!navigator.onLine){setPersonalEditError('Une connexion est nécessaire pour modifier votre observation.');return;}
    const temperature = editingPersonalObservation.temperature.trim() === "" ? null : Number(editingPersonalObservation.temperature.replace(",", "."));
    const windSpeed = editingPersonalObservation.windSpeed.trim() === "" ? null : Number(editingPersonalObservation.windSpeed.replace(",", "."));
    const precipitationInput = editingPersonalObservation.precipitation.trim() === "" ? null : Number(editingPersonalObservation.precipitation.replace(",", "."));
    const precipitation = acceptsPersonalPrecipitation(editingPersonalObservation.condition) ? precipitationInput : null;
    if ((temperature != null && !Number.isFinite(temperature)) || (windSpeed != null && !Number.isFinite(windSpeed)) || (precipitation != null && (!Number.isFinite(precipitation) || precipitation < 0))) {setPersonalEditError('Vérifiez les nombres saisis. Vous pouvez utiliser une virgule décimale.');return;}
    updatePersonalObservation.mutate({ id: editingPersonalObservation.id, observation: { temperature, condition: editingPersonalObservation.condition, windSpeed, precipitation } });
  };

  // The current model snapshot is explicitly distinct from the official
  // seven-model horizon, but lets the page render instead of holding a full
  // screen skeleton while that horizon refreshes after a cold start.
  const isLoading = officialLoading && hourlyLoading && !fastCurrentSnapshot;
  const isError = officialError && hourlyError && !fastCurrentSnapshot;

  useEffect(() => {
    if (!fastCurrentSnapshot && !officialForecast) return;
    const timer = window.setTimeout(() => setDiagnosticsEnabled(true), 250);
    return () => window.clearTimeout(timer);
  }, [fastCurrentSnapshot, officialForecast]);

  const refreshCurrentWeather = async () => {
    setHasWaitTimedOut(false);
    await Promise.all([refetchDashboard(), refetchOfficialForecast(), refetchDashboardDaily(), utils.weather.getCurrentModelSnapshot.invalidate(coordsInput), utils.favorites.getCurrentDashboardWeather.invalidate(coordsInput)]);
  };

  useEffect(() => {
    if (!isLoading) {
      setHasWaitTimedOut(false);
      return;
    }
    const timeoutId = window.setTimeout(() => setHasWaitTimedOut(true), DASHBOARD_LOAD_TIMEOUT_MS);
    return () => window.clearTimeout(timeoutId);
  }, [isLoading]);

  if (hasWaitTimedOut) {
    return (
      <div className="min-h-screen bg-background p-4">
        <div className="mx-auto flex min-h-[52vh] max-w-md flex-col items-center justify-center gap-4 text-center">
          <div className="rounded-2xl border border-blue-400/20 bg-blue-400/5 p-6">
            <Clock className="mx-auto mb-3 h-9 w-9 text-blue-300" />
            <h2 className="text-lg font-semibold">Prévisions officielles en cours de chargement</h2>
            <p className="mt-2 text-sm text-muted-foreground">Les données horaires restent en attente de la source météo. Aucune donnée estimée n’est affichée.</p>
            <button type="button" onClick={() => void refreshCurrentWeather()} className="mt-5 min-h-11 rounded-md border border-primary/50 px-4 text-sm font-medium text-primary">
              Réessayer maintenant
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (isLoading) {
    return <WeatherAILoader loading={true} variant="full" />;
  }

  if (isError) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <div role="alert" className="bg-red-500/10 border border-red-500/30 rounded-xl p-6 text-center max-w-sm w-full">
          <Activity className="h-10 w-10 mx-auto text-red-400 mb-3" />
          <h2 className="text-lg font-semibold text-red-400 mb-1">Erreur de chargement</h2>
          <p className="text-sm text-muted-foreground">Impossible de charger les prévisions.</p>
          <button type="button" disabled={officialFetching || dashFetching} onClick={() => void refreshCurrentWeather()} className="mt-5 min-h-11 rounded-md border border-primary/50 px-4 text-sm font-medium text-primary disabled:cursor-wait disabled:opacity-60">
            {officialFetching || dashFetching ? "Relance en cours…" : "Réessayer"}
          </button>
        </div>
      </div>
    );
  }

  // Le mode local reste explicitement distinct pour les stations; les prévisions
  // horaires et journalières proviennent d'un seul objet officiel consolidé.
  const lw = locationWeather;
  const meteoAI = dash?.meteoAI;
  const officialRegime = officialForecast?.regime ?? (dash as any)?.officialRegime ?? null;
  const officialPrimaryRegime = officialRegime?.primary as any;
  const days: any[] = dashboardDailyForecast?.days ?? officialForecast?.days ?? (lw ? lw.forecast15d : []);
  const today = dailyForecastForToday(days);
  const officialHours = officialForecast?.hours ?? [];
  const hours = officialHours;
  const currentSnapshot = officialForecast?.currentSnapshot ?? fastCurrentSnapshot ?? null;
  // Réglage « Paramètres Application » de l’AI Lab : la provenance (source, horodatage et
  // fraîcheur) peut être masquée. Seul l’affichage change : les valeurs restent identiques.
  const currentProvenanceLabel = (field?: CurrentStateFieldLike | null) =>
    showProvenance ? formatCurrentStateProvenance(field, currentSnapshot?.capturedAt) : null;
  const currentProvenanceTitle = (field?: CurrentStateFieldLike | null) =>
    showProvenance ? currentStateFieldTitle(field, currentSnapshot?.capturedAt) : undefined;
  const dailyFallback = officialForecast?.dailyFallback ?? dash?.dailyFallback ?? null;
  const currentFields = currentDashboardWeather?.fields;
  const hasPhysicalCurrentState = Object.values(currentFields ?? {}).some((field) => field.provenance.kind === "physical_stations");
  const hasAvailableCurrentState = Object.values(currentFields ?? {}).some((field) => field.value != null);
  const nowHour = new Date().toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Paris" }).slice(0, 2) + ":00";
  const forecastNowMs = Date.now();
  const panelDate = formatDashboardCompactDate(officialForecast?.today ?? dash?.today);
  const localPrimaryRegime = lw?.multiRegime?.activeRegimes?.[0] ?? null;
  const localObservedRegime = localPrimaryRegime
    ? { id: localPrimaryRegime.id, label: localPrimaryRegime.label, emoji: localPrimaryRegime.emoji }
    : null;
  const regimeUnavailable = officialRegime?.status === "unknown" || (!officialPrimaryRegime && !dash?.regime);
  const regime = officialPrimaryRegime
      ? {
          regime: officialPrimaryRegime.id,
          label: officialPrimaryRegime.label,
          emoji: officialPrimaryRegime.emoji,
          description: officialPrimaryRegime.description,
          weights: officialPrimaryRegime.weights ?? null,
        }
      : regimeUnavailable
        ? { regime: "unknown", label: "Régime indisponible", emoji: "—", description: officialRegime?.description ?? "Des données météo requises sont absentes ou invalides.", weights: null }
        : dash?.regime;
  const regimeProvenance = getRegimeProvenancePresentation({
    source: officialRegime?.source,
    sourceLabel: officialRegime?.sourceLabel,
    sourceUpdatedAt: officialRegime?.sourceUpdatedAt,
    hasRegime: !!officialPrimaryRegime,
  });
  // Réglage « Paramètres Application » de l’AI Lab : masque les mentions de provenance.
  const regimeSourceLabel = showProvenance ? regimeProvenance.sourceLabel : "";
  const regimeSourceUpdatedAt = showProvenance ? regimeProvenance.sourceTimeLabel : null;
  const liveRegimeFreshnessLabel = showProvenance ? regimeProvenance.freshnessLabel : "";
  const allRegimeIds = regimeCatalogue.map((candidate: any) => candidate.id);
  const allRegimesExpanded = allRegimeIds.length > 0 && allRegimeIds.every((id) => expandedRegimeIds.includes(id));
  const localNetatmoMessage = (locationWeather?.netatmo as {message?:string}|undefined)?.message;
  const netatmoStatusLabel: Record<string, string> = {
    available: "Netatmo : connexion propre à cette application (cache partagé de 10 minutes)",
    no_stations: "Netatmo : aucune station exploitable dans la couverture de 50 km",
    error: "Netatmo : collecte momentanément indisponible",
    live: "Netatmo : relevés directs authentifiés",
    fresh_cache: "Netatmo : cache authentifié récent (service temporairement indisponible)",
    connected_empty: "Netatmo : connecté, aucune station exploitable dans le rayon",
    temporarily_unavailable: "Netatmo : service temporairement indisponible",
    not_connected: "Netatmo : aucune autorisation active pour cette session",
  };

  // Heuristic multi-regime score for regime-signal badges
  const multiRegime = officialRegime
    ? { activeRegimes: officialRegime.active, confidenceScore: officialRegime.confidence }
    : (dash as any)?.multiRegime ?? null;
  const primaryRegimeId: string = multiRegime?.activeRegimes?.[0]?.id ?? (regime as any)?.regime ?? (regime as any)?.id ?? "unknown";
  const regimeScore: number | null = multiRegime?.confidenceScore ?? null;
  // L’accord est affiché en unités physiques et demeure distinct de la fiabilité historique.
  const activeOfficialHour = getActiveOfficialForecastHour(hours, forecastNowMs);
  const currentHourIndex = activeOfficialHour?.index ?? -1;
  const currentHour = activeOfficialHour?.hour ?? null;
  const isDailyFallback = currentHour == null && currentSnapshot == null && !hasPhysicalCurrentState && dailyFallback?.kind === "daily_fusion";
  const fallbackDateLabel = isDailyFallback
    ? new Date(`${dailyFallback.date}T12:00:00Z`).toLocaleDateString("fr-FR", { day: "2-digit", month: "long", year: "numeric", timeZone: "Europe/Paris" })
    : null;
  const fallbackComputedAtLabel = isDailyFallback
    ? new Date(dailyFallback.computedAt).toLocaleString("fr-FR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Paris" })
    : null;
  const regimeFreshnessLabel = liveRegimeFreshnessLabel;
  const nextConditionChange = isDailyFallback ? null : findNextConditionChange(hours, currentHour?.hour ?? nowHour, currentHour?.validAt);
  const nextWeatherAlert = getNextWeatherAlert(nextConditionChange);
  const officialSnapshotTemp = currentSnapshot?.temp ?? null;
  const snapshotCapturedAt = currentSnapshot?.capturedAt ?? null;
  const hourlyForecastSource = officialForecast?.officialSnapshot?.source ?? null;
  const hourlyForecastComputedAt = officialForecast?.officialSnapshot?.computedAt ?? null;
  const temperatureField = withCurrentSnapshotFallback(currentFields?.temperature, currentSnapshot?.temp, snapshotCapturedAt);
  // État du ciel : mêmes valeurs que la page Prévisions (prévision horaire officielle
  // de l’heure active, consolidation multi-modèles). Le snapshot best_match seul
  // affichait « Ensoleillé » là où les autres pages indiquaient « Partiellement
  // nuageux »; il ne reste que le repli affiché tant qu’aucune échéance active n’est
  // disponible, et n’est jamais mélangé aux valeurs de la prévision consolidée.
  const dashboardSky = getDashboardSky({
    hour: currentHour,
    forecastSource: formatHourlyForecastSource(hourlyForecastSource),
    forecastComputedAt: hourlyForecastComputedAt,
    fallbackFields: {
      condition: withCurrentSnapshotFallback(currentFields?.condition, currentSnapshot?.condition, snapshotCapturedAt),
      cloudCover: withCurrentSnapshotFallback(currentFields?.cloudCover, currentSnapshot?.cloudCover, snapshotCapturedAt),
      weatherCode: withCurrentSnapshotFallback(currentFields?.weatherCode, currentSnapshot?.weatherCode, snapshotCapturedAt),
    },
  });
  const conditionField = dashboardSky.conditionField;
  const currentTemp = currentNumber(temperatureField);
  const stationTemperature = getCurrentStationTemperature(temperatureField, formatCurrentStateProvenance(temperatureField, currentSnapshot?.capturedAt));
  const chartHours = withCurrentStationTemperature(hours, currentHourIndex, stationTemperature);
  const selectedCondition = currentString(conditionField);
  const displayedCondition = selectedCondition ?? (isDailyFallback ? dailyFallback.condition : null);
  // « Tendance quotidienne » décrit la nature de la valeur, pas sa provenance : il reste affiché.
  const conditionProvenanceLabel = isDailyFallback && !conditionField
    ? "Tendance quotidienne · pas une observation instantanée"
    : currentProvenanceLabel(conditionField);
  const activeFavoriteWeather = {
    temp: officialSnapshotTemp,
    // La pastille du lieu actif reprend le ciel affiché sous la température : même
    // icône que l’état courant, donc même source que la page Prévisions.
    condition: displayedCondition,
  };
  const maxTemperature = isDailyFallback ? dailyFallback.tempMax : today?.tempMax ?? meteoAI?.tempMax ?? null;
  const minTemperature = isDailyFallback ? dailyFallback.tempMin : today?.tempMin ?? meteoAI?.tempMin ?? null;
  const maxTemperatureTone = getExtremeTemperatureTone("max", maxTemperature);
  const minTemperatureTone = getExtremeTemperatureTone("min", minTemperature);
  const apparentTemperatureField = withCurrentSnapshotFallback(currentFields?.apparentTemperature, currentSnapshot?.apparentTemp, snapshotCapturedAt);
  const apparentTemp = currentNumber(apparentTemperatureField);
  const futureUVHour = hours.find((hour) => typeof hour.validAt === "number" && hour.validAt > forecastNowMs && hour.uvIndex != null) ?? null;
  const uvForecastHour = currentHour?.uvIndex != null ? currentHour : futureUVHour;
  const currentUV = currentHour?.uvIndex ?? futureUVHour?.uvIndex ?? null;
  const currentUVLabel = uvForecastHour && uvForecastHour !== currentHour ? "UV prévu à l’échéance suivante" : "UV prévu pour cette heure";
  // Vent : mêmes valeurs que la page Prévisions (prévision horaire officielle de l’heure active); jamais les stations.
  const dashboardWind = getDashboardWind({
    hour: currentHour,
    forecastSource: formatHourlyForecastSource(hourlyForecastSource),
    forecastComputedAt: hourlyForecastComputedAt,
    snapshot: currentSnapshot,
    snapshotCapturedAt,
  });
  const windDirectionField = dashboardWind.directionField;
  const windSpeedField = dashboardWind.speedField;
  const windGustField = dashboardWind.gustField;
  const precipitationField = withCurrentSnapshotFallback(currentFields?.precipitation, currentSnapshot?.precipitation, snapshotCapturedAt);
  const cloudCoverField = dashboardSky.cloudCoverField;
  const humidityField = withCurrentSnapshotFallback(currentFields?.humidity, currentSnapshot?.humidity, snapshotCapturedAt);
  const weatherCodeField = dashboardSky.weatherCodeField;
  const currentWeatherCode = currentNumber(weatherCodeField);
  const windDir = dashboardWind.direction;
  const windSpeed = dashboardWind.speed;
  const currentWindGust = dashboardWind.gust;
  const currentPrecipitation = currentNumber(precipitationField);
  const currentCloudCover = currentNumber(cloudCoverField);
  const currentHumidity = currentNumber(humidityField);
  // Code couleur : chaque valeur d'observation reçoit une teinte adaptée à son intensité.
  const apparentTempTone = getApparentTempTone(apparentTemp);
  const cloudCoverTone = getCloudCoverTone(currentCloudCover);
  const pressureTone = getPressureTone(typeof currentHour?.pressure === "number" && Number.isFinite(currentHour.pressure) ? currentHour.pressure : null);
  const humidityTone = getHumidityTone(currentHumidity);
  const precipitationTone = getPrecipitationTone(currentPrecipitation);
  const visibilityTone = getVisibilityTone(typeof currentHour?.visibility === "number" && Number.isFinite(currentHour.visibility) ? currentHour.visibility : null);
  const dashboardSkyImage = getDashboardWeatherImage({ condition: displayedCondition, regime: regime?.label, temperature: currentTemp ?? undefined, cloudCover: currentCloudCover ?? undefined, precipitation: currentPrecipitation ?? (isDailyFallback ? dailyFallback.precipitation : undefined) ?? undefined, windSpeed: windSpeed ?? undefined });
  const dashboardSkyStyle = { "--dashboard-sky-image": `url("${dashboardSkyImage}")` } as CSSProperties;
  const nextRegimeChange = officialForecast?.nextRegimeChange ?? null;
  const modelFallbackContributors = locationWeather?.ultraLocal?.modelFallback?.contributors ?? [];
  const localObservation = locationWeather?.currentObservation?.source === "local_validated"
    ? locationWeather.currentObservation
    : null;
  const localOfficialDelta = localObservation?.deltaFromOfficialC ?? null;
  const hasMaterialLocalDelta = localOfficialDelta !== null && Math.abs(localOfficialDelta) >= 2;
  const localCoverageBands = locationWeather?.ultraLocal?.bandBreakdown ?? [];
  const localContributors = locationWeather?.ultraLocal?.stationsUsed ?? [];
  const localModeLabel = localMode === "ultra-local" ? "Ultra-local" : "Local";
  const localRadiusKm = localMode === "ultra-local" ? 10 : 30;
  const visibleLocalContributors = showAllLocalContributors ? localContributors : localContributors.slice(0, 6);
  const observationFields: Record<ObservationDetailKey, CurrentStateFieldLike | null> = {
    temperature: temperatureField,
    apparent_temperature: apparentTemperatureField,
    cloud_cover: cloudCoverField,
    wind_speed: windSpeedField,
    wind_gust: windGustField,
    humidity: humidityField,
    precipitation: precipitationField,
    pressure: observationForecastField(currentHour?.pressure, currentHour?.validAt, hourlyForecastComputedAt, formatHourlyForecastSource(hourlyForecastSource)),
    uv_index: observationForecastField(currentUV, uvForecastHour?.validAt, hourlyForecastComputedAt, formatHourlyForecastSource(hourlyForecastSource)),
    visibility: observationForecastField(currentHour?.visibility, currentHour?.validAt, hourlyForecastComputedAt, formatHourlyForecastSource(hourlyForecastSource)),
  };

  return (
    <div className="dashboard-weather-page page-content-enter min-h-dvh w-full overflow-x-clip bg-background" style={dashboardSkyStyle}>
      <div className="mx-auto w-full min-w-0 max-w-none space-y-2 px-1 pb-3 pt-[max(env(safe-area-inset-top),0.25rem)] sm:max-w-2xl sm:space-y-6 sm:px-6 sm:py-8">

        {!authLoading && !user && (
          <div role="status" className="rounded-xl border border-blue-400/20 bg-blue-400/5 px-3 py-2 text-xs text-blue-100">
            <p>{DASHBOARD_PREVIEW_MESSAGE}</p>
            <a
              href={getLoginUrl()}
              className="mt-2 inline-flex min-h-9 items-center justify-center gap-1.5 rounded-lg border border-blue-300/30 bg-blue-300/10 px-3 py-1.5 font-semibold text-blue-50 transition-colors hover:bg-blue-300/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-200"
            >
              <LogIn className="h-3.5 w-3.5" aria-hidden="true" />
              Se connecter
            </a>
          </div>
        )}

        {/* ── Favorites Bar ── */}
        <FavoritesBar
          activeLocation={selectedLocation}
          onLocationChange={handleLocationChange}
          prefetchedWeather={prefetchedWeather}
          activeWeather={activeFavoriteWeather}
        />

        {/* ── Hero : Température actuelle + max/min ── */}
        <div className="dashboard-sky-card relative overflow-hidden bg-gradient-to-br from-slate-800 via-slate-900 to-slate-950 border border-slate-700 rounded-2xl px-3 pb-3 pt-1 sm:p-6">
          <div className="absolute inset-0 bg-gradient-to-b from-slate-950/58 via-slate-950/34 to-slate-950/82 pointer-events-none" />
          <div className="relative">
            {/* ── Regime badge ── */}
            {regime && (
              <div className="mb-1 sm:mb-2 sm:rounded-xl sm:border sm:border-slate-600/50 sm:bg-slate-800/60 sm:px-3 sm:py-1.5">
                <div className="mb-1 flex justify-center sm:mb-1.5">
                  <p className="text-lg font-bold tracking-tight text-slate-50 sm:text-xl">
                    {panelDate}
                  </p>
                </div>
                <div className="flex items-center gap-1.5 sm:gap-2">
                  <button
                    type="button"
                    onClick={() => setShowRegimeMenu((open) => !open)}
                    aria-expanded={showRegimeMenu}
                    aria-controls="regime-catalogue"
                    className="-mx-1 flex min-w-0 flex-1 items-center gap-2 rounded-lg px-1 py-0.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
                  >
                    <span className="grid h-6 w-6 shrink-0 place-items-center rounded-md bg-slate-950/35 text-sm sm:h-7 sm:w-7 sm:text-base">{regime?.emoji}</span>
                    <div className="min-w-0">
                      <p className="text-[8px] font-semibold uppercase tracking-[0.12em] text-sky-200/75 sm:text-[9px] sm:tracking-[0.14em]">État du ciel</p>
                      <p className="flex items-center gap-1 text-[11px] font-semibold text-white sm:text-xs">{regime?.label} {showRegimeMenu ? <ChevronUp className="h-3.5 w-3.5 text-primary" /> : <ChevronDown className="h-3.5 w-3.5 text-slate-300" />}</p>
                      <p className="text-xs text-muted-foreground leading-tight hidden sm:block">{regime?.description}</p>
                      {regimeSourceLabel && regimeFreshnessLabel ? <p className="text-[9px] leading-tight text-sky-200/80 sm:mt-0.5 sm:text-[10px]">{regimeSourceLabel} · {regimeFreshnessLabel}</p> : null}
                      <span className="sr-only">Voir les 20 régimes</span>
                    </div>
                  </button>
                </div>
                {/* Weight pills */}
                <div className="mt-0.5 flex flex-wrap gap-1 sm:mt-1">
                  <span className="rounded-full border border-orange-500/30 bg-orange-500/20 px-1.5 py-px text-[11px] font-medium text-orange-300 sm:px-2 sm:py-0.5 sm:text-xs">
                    🌡 {regime?.weights?.temp == null ? "—" : `${Math.round(regime.weights.temp * 100)}%`}
                  </span>
                  <span className="rounded-full border border-blue-500/30 bg-blue-500/20 px-1.5 py-px text-[11px] font-medium text-blue-300 sm:px-2 sm:py-0.5 sm:text-xs">
                    🌧 {regime?.weights?.precip == null ? "—" : `${Math.round(regime.weights.precip * 100)}%`}
                  </span>
                  <span className="rounded-full border border-cyan-500/30 bg-cyan-500/20 px-1.5 py-px text-[11px] font-medium text-cyan-300 sm:px-2 sm:py-0.5 sm:text-xs">
                    💨 {regime?.weights?.wind == null ? "—" : `${Math.round(regime.weights.wind * 100)}%`}
                  </span>
                  <span className="rounded-full border border-purple-500/30 bg-purple-500/20 px-1.5 py-px text-[11px] font-medium text-purple-300 sm:px-2 sm:py-0.5 sm:text-xs">
                    ☁ {regime?.weights?.condition == null ? "—" : `${Math.round(regime.weights.condition * 100)}%`}
                  </span>
                </div>
                {showRegimeMenu && (
                  <div id="regime-catalogue" className="mt-2 rounded-lg border border-slate-600/35 bg-slate-950/30 p-2" aria-label="Tous les régimes météo possibles">
                    <div className="mb-2 flex items-center justify-between gap-2 px-1">
                      <p className="text-[10px] font-medium uppercase tracking-[0.12em] text-slate-400">Tous les régimes</p>
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => setExpandedRegimeIds(allRegimesExpanded ? [] : allRegimeIds)}
                          aria-label={allRegimesExpanded ? "Tout réduire les régimes" : "Tout développer les régimes"}
                          className="min-h-7 rounded-md border border-primary/30 bg-primary/10 px-2 text-[9px] font-semibold text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                        >
                          {allRegimesExpanded ? "Tout réduire" : "Tout développer"}
                        </button>
                        <span className="rounded-full border border-slate-600/50 bg-slate-900/60 px-1.5 py-0.5 text-[9px] text-slate-400">{regimeCatalogue.length || 20}</span>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-1 sm:grid-cols-2">
                      {regimeCatalogue.map((candidate: any) => {
                        const isActive = candidate.id === primaryRegimeId;
                        const isExpanded = expandedRegimeIds.includes(candidate.id);
                        const detailsId = `regime-weights-${candidate.id}`;
                        const weights = candidate?.weights && typeof candidate.weights === "object" ? candidate.weights : null;
                        const weightRows = [
                          { label: "Temp.", value: weights?.temp, color: "bg-orange-400" },
                          { label: "Pluie", value: weights?.precip, color: "bg-blue-400" },
                          { label: "Vent", value: weights?.wind, color: "bg-cyan-400" },
                          { label: "Cond.", value: weights?.condition, color: "bg-violet-400" },
                        ];
                        return (
                          <div key={candidate.id} className={`min-w-0 rounded-md text-[10px] ${isActive ? "bg-primary/15 text-primary ring-1 ring-primary/25" : "bg-slate-900/25 text-slate-300"}`}>
                            <button
                              type="button"
                              onClick={() => setExpandedRegimeIds((current) => current.includes(candidate.id) ? current.filter((id) => id !== candidate.id) : [...current, candidate.id])}
                              aria-expanded={isExpanded}
                              aria-controls={detailsId}
                              aria-label={`${isExpanded ? "Replier" : "Afficher"} les pondérations de ${candidate.label}`}
                              className="flex w-full min-w-0 items-start gap-1.5 px-1.5 py-1.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                            >
                              <span className="pt-px">{candidate.emoji}</span>
                              <span className="min-w-0 flex-1"><strong className="block truncate">{candidate.label}{isActive ? " · actif" : ""}</strong><span className="mt-0.5 hidden leading-snug text-slate-400 sm:block">{candidate.description}</span></span>
                              {isExpanded ? <ChevronUp className="mt-px h-3 w-3 shrink-0" aria-hidden="true" /> : <ChevronDown className="mt-px h-3 w-3 shrink-0 text-slate-500" aria-hidden="true" />}
                            </button>
                            {isExpanded && (
                              <div id={detailsId} className="mx-1.5 mb-1.5 grid grid-cols-2 gap-x-2 gap-y-1.5 border-t border-slate-700/40 pt-1.5 text-[8px] leading-tight text-slate-400">
                                {weightRows.map((weight) => {
                                  const percent = typeof weight.value === "number" && Number.isFinite(weight.value) ? Math.max(0, Math.min(100, Math.round(weight.value * 100))) : 0;
                                  return (
                                    <div key={weight.label} className="min-w-0">
                                      <div className="mb-0.5 flex items-center justify-between gap-1">
                                        <span>{weight.label}</span>
                                        <span className="font-medium text-slate-300">{formatRegimeWeight(weight.value)}</span>
                                      </div>
                                      <div className="h-1 overflow-hidden rounded-full bg-slate-700/70" role="progressbar" aria-label={`Poids ${weight.label}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}>
                                        <div className={`h-full rounded-full ${weight.color}`} style={{ width: `${percent}%` }} />
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
                {(regimeSourceLabel || regimeFreshnessLabel || regimeSourceUpdatedAt) ? <p className="mt-0.5 hidden text-[10px] font-medium text-slate-300 sm:block">{[regimeSourceLabel, regimeFreshnessLabel].filter(Boolean).join(" · ")}{regimeSourceUpdatedAt ? ` · source à ${regimeSourceUpdatedAt} (Europe/Paris)` : ""}</p> : null}
              </div>
            )}

            {isDailyFallback && (
              <div role="status" className="mb-3 rounded-xl border border-amber-300/35 bg-amber-300/[0.09] px-3 py-2 text-[11px] leading-relaxed text-amber-50">
                <div className="flex items-start gap-2">
                  <CalendarDays className="mt-0.5 h-4 w-4 shrink-0 text-amber-200" />
                  <div>
                    <p className="font-semibold">Créneaux horaires indisponibles</p>
                    <p className="mt-0.5 text-amber-100/85">Dernière fusion quotidienne réelle : {fallbackDateLabel} · calculée le {fallbackComputedAtLabel}. Les valeurs ci-dessous sont des indicateurs journaliers, pas une météo observée à l’instant.</p>
                  </div>
                </div>
              </div>
            )}

            {nextWeatherAlert && (
              <div className={`mb-3 flex items-center gap-2 rounded-xl border px-3 py-2 ${
                nextWeatherAlert.kind === "thunderstorm"
                  ? "border-red-400/50 bg-red-500/15 text-red-100"
                  : nextWeatherAlert.kind === "wind"
                    ? "border-cyan-400/50 bg-cyan-500/15 text-cyan-100"
                    : "border-blue-400/50 bg-blue-500/15 text-blue-100"
              }`}>
                <span className="animate-pulse"><MeteoIcon name={nextWeatherAlert.icon} size={24} /></span>
                <div className="min-w-0">
                  <p className="text-xs font-bold">{nextWeatherAlert.title}</p>
                  <p className="text-[11px] opacity-90">{nextWeatherAlert.detail}</p>
                </div>
              </div>
            )}

            {/* ── Alert badge for dangerous regimes ── */}
            {isDangerousRegime(primaryRegimeId) && regimeScore != null && (
              <div className="mb-3">
                <AlertBadge regimeId={primaryRegimeId} regimeScore={regimeScore} regimeScoreThreshold={60} />
              </div>
            )}

            {/* Main current temperature row: qualified physical estimate or field-level model fallback. */}
            <div className="flex items-start gap-2 sm:gap-6">
              {/* The main temperature is selected from the current-state read model, independently of forecasts. */}
              <div className="w-[4.75rem] shrink-0 pt-0.5 sm:w-[5.25rem] sm:pt-0">
                {displayedCondition
                  ? <MeteoIcon name={dashboardCurrentIcon(displayedCondition,queryInput,forecastNowMs)} size={64} />
                  : <div className="grid h-16 w-16 place-items-center rounded-full border border-slate-500/30 bg-slate-900/45 text-2xl font-medium text-slate-500" role="img" aria-label="Condition météo indisponible">?</div>}
              </div>

              <div className={dashboardTemperatureLayout.content}>
                {/* Big current temp */}
                <ObservationDetailButton metric="temperature" onOpen={openObservation} className="min-w-0 text-left">
                  <p className={dashboardTemperatureLayout.currentValue}>
                    {currentTemp != null ? currentTemp.toFixed(1) : "—"}°
                  </p>
                  {currentProvenanceLabel(temperatureField) && <p className="mt-0.5 text-[9px] leading-tight text-slate-400" title={currentProvenanceTitle(temperatureField)}>
                    {currentProvenanceLabel(temperatureField)}
                  </p>}
                </ObservationDetailButton>

                {/* Max / Min */}
                <button ref={dailyDetailTrigger} type="button" disabled={!today || isDailyFallback && dailyFallback.date!==today.date} aria-label="Voir le détail des températures maximale et minimale prévues pour aujourd’hui" aria-controls="dashboard-daily-forecast" onClick={()=>{
                  if(today)setDailyDetailRequest(previous=>({date:today.date,sequence:(previous?.sequence??0)+1}));
                }} className={`${dashboardTemperatureLayout.extremes} min-h-11 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white disabled:cursor-default`}>
                  <div className={`flex items-center justify-end gap-1 rounded-lg border px-1.5 py-0.5 sm:gap-1.5 ${maxTemperatureTone.container}`}>
                    <span className={`text-[8px] sm:text-xs font-bold uppercase tracking-normal sm:tracking-wide ${maxTemperatureTone.label}`}>Max prévue</span>
                    <span className={`${dashboardTemperatureLayout.extremeValue} font-black ${maxTemperatureTone.value}`}>
                      {maxTemperature != null ? Number(maxTemperature).toFixed(1) : "—"}°
                    </span>
                  </div>
                  <div className={`flex items-center justify-end gap-1 rounded-lg border px-1.5 py-0.5 sm:gap-1.5 ${minTemperatureTone.container}`}>
                    <span className={`text-[8px] sm:text-xs font-bold uppercase tracking-normal sm:tracking-wide ${minTemperatureTone.label}`}>Min prévue</span>
                    <span className={`${dashboardTemperatureLayout.extremeValue} font-black ${minTemperatureTone.value}`}>
                      {minTemperature != null ? Number(minTemperature).toFixed(1) : "—"}°
                    </span>
                  </div>
                </button>
              </div>
            </div>

            <div className="mt-1 min-w-0 space-y-0.5 sm:mt-1.5 sm:space-y-1">
              <p className="whitespace-nowrap text-[15px] font-medium leading-tight text-slate-100/90 sm:text-lg">
                <span className="font-semibold text-sky-200/90">{isDailyFallback ? "Tendance quotidienne · " : currentSnapshot || hasAvailableCurrentState ? "État actuel · " : "État courant indisponible · "}</span>
                <span className="text-white">{displayedCondition ?? "Condition indisponible"}</span>
              </p>
              {conditionProvenanceLabel && <p className="text-[9px] leading-tight text-slate-400" title={currentProvenanceTitle(conditionField)}>
                {conditionProvenanceLabel}
                {showProvenance && currentWeatherCode != null ? ` · code WMO ${currentWeatherCode}` : ""}
              </p>}
              {(nextRegimeChange ?? nextConditionChange) && (
                <>
                  <p className="whitespace-nowrap text-[15px] font-medium leading-tight sm:hidden">
                    <span className="text-sky-200/90">Évolution · {nextRegimeChange
                      ? `${nextRegimeChange.hour.replace(":00", "h")} · ${nextRegimeChange.emoji} `
                      : `${nextConditionChange!.hour.replace(":00", "h")} · `}</span>
                    <span className="text-white">{nextRegimeChange ? nextRegimeChange.label : nextConditionChange!.condition}</span>
                  </p>
                  <p className="hidden items-center gap-1 text-[11px] font-medium text-sky-300 sm:flex">
                    <Clock className="h-3 w-3" />
                    <span>Évolution horaire : {nextRegimeChange ? `${nextRegimeChange.emoji} ` : ""}</span>
                    <span className="text-white">{nextRegimeChange ? nextRegimeChange.label : nextConditionChange!.condition}</span>
                    <span>à {nextRegimeChange ? nextRegimeChange.hour : nextConditionChange!.hour}</span>
                  </p>
                </>
              )}
            </div>

            <section aria-label="Observations actuelles et valeurs prévisionnelles" className="rounded-xl border border-cyan-400/20 bg-cyan-950/10 px-2 pb-2">
              <p className="pt-2 text-xs font-semibold uppercase tracking-[0.12em] text-cyan-200/90 sm:text-sm">Observations actuelles {showProvenance && <span className="font-normal normal-case tracking-normal text-slate-400">· nature, source et échéance indiquées par valeur</span>}</p>
              <div className="mt-2 grid grid-cols-[minmax(0,1fr)_5.75rem_minmax(0,1fr)] items-center gap-1 border-t border-cyan-400/20 pt-3 sm:grid-cols-[minmax(0,1fr)_6rem_minmax(0,1fr)] sm:gap-3">
                <ObservationDetailButton metric="apparent_temperature" onOpen={openObservation} className="min-w-0 rounded-lg border border-white/5 bg-black/20 p-1.5 text-center sm:p-2" title={currentProvenanceTitle(apparentTemperatureField)}>
                  <p className="flex items-center justify-center gap-1 text-[12px] font-medium leading-tight text-slate-200 sm:text-sm"><Thermometer className={"h-3.5 w-3.5 shrink-0 " + apparentTempTone.value} />Ressenti</p>
                  <p className={"mt-1 text-lg font-bold sm:text-2xl " + apparentTempTone.value}>{apparentTemp != null ? `${apparentTemp.toFixed(1)}°` : "—"}</p>
                  {currentProvenanceLabel(apparentTemperatureField) && <p className="mt-1 text-[9px] leading-tight text-slate-400 sm:text-[10px]">{currentProvenanceLabel(apparentTemperatureField)}</p>}
                </ObservationDetailButton>
                <div className="min-w-0 text-center">
                  <p className="mb-1 flex items-center justify-center gap-1 whitespace-nowrap text-[12px] font-medium leading-tight text-white sm:text-sm"><Wind className="h-3.5 w-3.5 shrink-0" />Direction du vent</p>
                  <WindRose direction={windDir} />
                  {currentProvenanceLabel(windDirectionField) && <p className="mt-1 text-[9px] leading-tight text-slate-400 sm:text-[10px]" title={currentProvenanceTitle(windDirectionField)}>
                    {currentProvenanceLabel(windDirectionField)}
                  </p>}
                </div>
                <ObservationDetailButton metric="cloud_cover" onOpen={openObservation} className="min-w-0 rounded-lg border border-white/5 bg-black/20 p-1.5 text-center sm:p-2" title={currentProvenanceTitle(cloudCoverField)}>
                  <p className="flex items-center justify-center gap-1 text-[12px] font-medium leading-tight text-slate-200 sm:text-sm"><Eye className={"h-3.5 w-3.5 shrink-0 " + cloudCoverTone.value} />Nuages actuels</p>
                  <p className={"mt-1 text-lg font-bold sm:text-2xl " + cloudCoverTone.value}>{currentCloudCover == null ? "—" : `${formatDashboardNumber(currentCloudCover, 0)}%`}</p>
                  {currentProvenanceLabel(cloudCoverField) && <p className="mt-1 text-[9px] leading-tight text-slate-400 sm:text-[10px]">{currentProvenanceLabel(cloudCoverField)}</p>}
                </ObservationDetailButton>
              </div>
              <div className="mt-2 grid grid-cols-2 gap-2">
                <ObservationDetailButton metric="wind_speed" onOpen={openObservation} className="min-w-0 rounded-lg border border-white/5 bg-black/20 p-2 text-center" title={currentProvenanceTitle(windSpeedField)}>
                  <p className="flex items-center justify-center gap-1 text-[12px] font-medium leading-tight text-slate-200 sm:text-sm"><Wind className={"h-3.5 w-3.5 shrink-0 " + WIND_VALUE_COLOR} />Vent actuel</p>
                  <p className={"mt-1 text-lg font-semibold sm:text-xl " + WIND_VALUE_COLOR}>{formatOptionalForecastValue(windSpeed, 0, " km/h")}</p>
                  {currentProvenanceLabel(windSpeedField) && <p className="mt-1 text-[9px] leading-tight text-slate-400 sm:text-[10px]">{currentProvenanceLabel(windSpeedField)}</p>}
                </ObservationDetailButton>
                <ObservationDetailButton metric="wind_gust" onOpen={openObservation} className="min-w-0 rounded-lg border border-white/5 bg-black/20 p-2 text-center" title={currentProvenanceTitle(windGustField)}>
                  <p className="flex items-center justify-center gap-1 text-[12px] font-medium leading-tight text-slate-200 sm:text-sm"><Wind className={"h-3.5 w-3.5 shrink-0 " + WIND_VALUE_COLOR} />Rafales actuelles</p>
                  <p className={"mt-1 text-lg font-semibold sm:text-xl " + WIND_VALUE_COLOR}>{formatOptionalForecastValue(currentWindGust, 0, " km/h")}</p>
                  {currentProvenanceLabel(windGustField) && <p className="mt-1 text-[9px] leading-tight text-slate-400 sm:text-[10px]">{currentProvenanceLabel(windGustField)}</p>}
                </ObservationDetailButton>
              </div>
              <ObservationDetailButton metric="pressure" onOpen={openObservation} className="mt-2 flex w-full flex-wrap items-center justify-between gap-x-3 gap-y-1 rounded-lg border border-white/5 bg-black/20 p-2 text-left">
                <p className="flex items-center gap-1 text-[12px] font-medium text-sky-100 sm:text-sm"><Thermometer className={"h-3.5 w-3.5 " + pressureTone.value} />Pression de surface estimée (modèle)</p>
                <p className={"text-lg font-semibold sm:text-xl " + pressureTone.value}>{typeof currentHour?.pressure === "number" && Number.isFinite(currentHour.pressure) ? `${formatDashboardNumber(currentHour.pressure, 0)} hPa` : "—"}</p>
                {showProvenance && <p className="mt-1 w-full text-[9px] leading-tight text-slate-400 sm:text-[10px]">{formatHourlyForecastValidAt(currentHour?.validAt)} · {formatHourlyForecastSource(hourlyForecastSource)} · {formatHourlyForecastComputedAt(hourlyForecastComputedAt)}</p>}
                <p className="mt-1 w-full text-[9px] leading-tight text-slate-500"><code className="font-mono">surface_pressure</code> en hPa · pression de surface du lieu, non ramenée au niveau de la mer; estimation de modèle, pas une mesure de station.</p>
              </ObservationDetailButton>
              <div className="mt-2 grid grid-cols-2 gap-2">
                <ObservationDetailButton metric="humidity" onOpen={openObservation} className="min-w-0 rounded-lg border border-white/5 bg-black/20 p-2 text-center" title={currentProvenanceTitle(humidityField)}>
                  <p className="flex items-center justify-center gap-1 text-[12px] font-medium leading-tight text-slate-200 sm:text-sm"><MeteoIcon name="humidity" size={16} className={"shrink-0 " + humidityTone.value} />Humidité actuelle</p>
                  <p className={"mt-1 text-lg font-semibold sm:text-xl " + humidityTone.value}>{currentHumidity == null ? "—" : `${formatDashboardNumber(currentHumidity)}%`}</p>
                  {currentProvenanceLabel(humidityField) && <p className="mt-1 text-[9px] leading-tight text-slate-400 sm:text-[10px]">{currentProvenanceLabel(humidityField)}</p>}
                </ObservationDetailButton>
                <ObservationDetailButton metric="precipitation" onOpen={openObservation} className="min-w-0 rounded-lg border border-white/5 bg-black/20 p-2 text-center" title={currentProvenanceTitle(precipitationField)}>
                  <p className="flex items-center justify-center gap-1 text-[12px] font-medium leading-tight text-slate-200 sm:text-sm"><Droplets className={"h-3.5 w-3.5 shrink-0 " + precipitationTone.value} />Précipitations actuelles</p>
                  <p className={"mt-1 text-lg font-semibold sm:text-xl " + precipitationTone.value}>{currentPrecipitation == null ? "—" : `${currentPrecipitation.toFixed(1)} mm`}</p>
                  {currentProvenanceLabel(precipitationField) && <p className="mt-1 text-[9px] leading-tight text-slate-400 sm:text-[10px]">{currentProvenanceLabel(precipitationField)}</p>}
                  <p className="mt-1 text-[9px] leading-tight text-slate-500">Cumul station non comparable</p>
                </ObservationDetailButton>
              </div>
              <div className="mt-2 border-t border-sky-400/20 pt-2">
                <div className="grid grid-cols-2 gap-2">
                <ObservationDetailButton metric="uv_index" onOpen={openObservation} className="min-w-0 rounded-lg border border-sky-300/15 bg-slate-950/35 p-2 text-center">
                  <p className="flex items-center justify-center gap-1 text-[12px] font-medium leading-tight text-sky-100 sm:text-sm"><Sun className="h-3.5 w-3.5 shrink-0" />{currentUVLabel}</p>
                  <UVBadge uv={currentUV} />
                  {showProvenance && <p className="mt-1 text-[9px] leading-tight text-slate-400 sm:text-[10px]">{formatHourlyForecastValidAt(uvForecastHour?.validAt)}</p>}
                  {showProvenance && <p className="mt-1 text-[9px] leading-tight text-slate-500 sm:text-[10px]">{formatHourlyForecastSource(hourlyForecastSource)} · {formatHourlyForecastComputedAt(hourlyForecastComputedAt)}</p>}
                </ObservationDetailButton>
                <ObservationDetailButton metric="visibility" onOpen={openObservation} className="min-w-0 rounded-lg border border-sky-300/15 bg-slate-950/35 p-2 text-center" title="Visibilité météorologique en kilomètres ; le contrat ne fournit pas de mesure distincte de visibilité des nuages.">
                  <p className="flex items-center justify-center gap-1 text-[12px] font-medium leading-tight text-sky-100 sm:text-sm"><Eye className={"h-3.5 w-3.5 shrink-0 " + visibilityTone.value} />Visibilité prévue</p>
                  <p className={"mt-1 text-lg font-semibold sm:text-xl " + visibilityTone.value}>{currentHour?.visibility == null ? "—" : `${currentHour.visibility.toFixed(1)} km`}</p>
                  {showProvenance && <p className="mt-1 text-[9px] leading-tight text-slate-400 sm:text-[10px]">{formatHourlyForecastValidAt(currentHour?.validAt)}</p>}
                  <p className="mt-1 text-[9px] leading-tight text-slate-500">Visibilité météo, pas spécifique aux nuages</p>
                  {showProvenance && <p className="mt-1 text-[9px] leading-tight text-slate-500 sm:text-[10px]">{formatHourlyForecastSource(hourlyForecastSource)} · {formatHourlyForecastComputedAt(hourlyForecastComputedAt)}</p>}
                </ObservationDetailButton>
                </div>
              </div>
            </section>

            </div>
          </div>

        <div className="dashboard-sky-card flex min-h-11 items-center gap-2 rounded-xl border border-border bg-card p-2" aria-label="Mode de contexte local">
          <Radio className="h-4 w-4 shrink-0 text-primary" />
          <span className="mr-auto text-xs font-semibold text-muted-foreground">Contexte</span>
          <div className="flex gap-1">
            {(["standard", "local", "ultra-local"] as const).map((mode) => (
              <button
                key={mode}
                onClick={() => handleModeChange(mode)}
                className={`rounded-lg border px-2.5 py-1 text-xs font-medium transition-colors ${localMode === mode ? "border-primary/50 bg-primary/15 text-primary" : "border-transparent text-muted-foreground hover:bg-muted hover:text-foreground"}`}
              >
                {mode === "ultra-local" ? "Ultra-local" : mode === "local" ? "Local" : "Officiel"}
              </button>
            ))}
          </div>
        </div>

        <section className="dashboard-sky-card rounded-xl border border-sky-400/25 bg-sky-400/5" aria-labelledby="personal-observation-title">
          <button type="button" aria-expanded={isPersonalObservationOpen} onClick={() => setIsPersonalObservationOpen((open) => !open)} className="flex min-h-12 w-full items-center gap-2 px-3 text-left">
            <Eye className="h-5 w-5 shrink-0 text-sky-300" />
            <div className="min-w-0 flex-1"><h2 id="personal-observation-title" className="text-sm font-semibold text-slate-100">Mes observations</h2><p className="mt-0.5 text-[10px] text-slate-400">Votre carnet météo privé.</p></div>
            {isPersonalObservationOpen ? <ChevronUp className="h-5 w-5 shrink-0 text-sky-300" /> : <ChevronDown className="h-5 w-5 shrink-0 text-sky-300" />}
          </button>
          {isPersonalObservationOpen ? <div className="border-t border-sky-300/15 px-3 pb-3 pt-2">
          {!user ? <p className="rounded-lg border border-slate-700 bg-black/20 px-3 py-2 text-xs text-slate-300">Connectez-vous pour enregistrer vos observations dans votre carnet privé.</p> : <>
            <p className="text-[11px] leading-relaxed text-slate-400">Indiquez ce que vous observez à {selectedLocation?.name??'Hondeghem'}. La date et l’heure sont enregistrées à l’envoi. Les champs chiffrés sont facultatifs.</p>
            {!personalOnline&&<p role="status" className="mt-2 text-xs text-amber-200">Une connexion est nécessaire pour enregistrer ou modifier vos observations.</p>}
            <div className="mt-3 grid grid-cols-2 gap-2">
              <label className="text-[11px] font-medium text-slate-300">Température observée (°C)<input aria-label="Température observée" inputMode="decimal" value={personalTemperature} onChange={(event) => setPersonalTemperature(event.target.value)} placeholder="Ex. 24" className="mt-1 min-h-10 w-full rounded-lg border border-slate-600 bg-[#0b1019]/80 px-3 text-sm text-white outline-none focus:border-sky-400" /></label>
              <label className="text-[11px] font-medium text-slate-300">Vent observé (km/h)<input aria-label="Vent observé" inputMode="decimal" value={personalWind} onChange={(event) => setPersonalWind(event.target.value)} placeholder="Facultatif" className="mt-1 min-h-10 w-full rounded-lg border border-slate-600 bg-[#0b1019]/80 px-3 text-sm text-white outline-none focus:border-sky-400" /></label>
            </div>
            <p className="mt-3 text-[11px] font-medium text-slate-300">Quel temps observez-vous ?</p>
            <div className="mt-1.5 flex flex-wrap gap-1.5" aria-label="Propositions de conditions météo">
              {PERSONAL_CONDITION_OPTIONS.map((option) => <button key={option.id} type="button" onClick={() => setPersonalCondition(option.id)} className={`min-h-9 rounded-lg border px-2.5 text-[11px] font-medium ${personalCondition === option.id ? "border-sky-300/60 bg-sky-400/15 text-sky-100" : "border-slate-700 bg-black/15 text-slate-300"}`}>{option.label}</button>)}
            </div>
            {acceptsPersonalPrecipitation(personalCondition) ? <label className="mt-3 block text-[11px] font-medium text-slate-300">Précipitations observées (mm)<input aria-label="Précipitations observées en millimètres" inputMode="decimal" value={personalPrecipitation} onChange={(event) => setPersonalPrecipitation(event.target.value)} placeholder="Ex. 1,2" className="mt-1 min-h-10 w-full rounded-lg border border-sky-400/40 bg-[#0b1019]/80 px-3 text-sm text-white outline-none focus:border-sky-300" /></label> : null}
            <button type="button" onClick={handlePersonalObservationSubmit} disabled={submitPersonalObservation.isPending||!personalOnline} className="mt-3 min-h-10 w-full rounded-lg border border-sky-300/45 bg-sky-400/15 px-3 text-xs font-semibold text-sky-100 disabled:cursor-wait disabled:opacity-60">{submitPersonalObservation.isPending ? "Enregistrement…" : "Enregistrer mon observation"}</button>
            {personalFormError||submitPersonalObservation.isError ? <p role="alert" className="mt-2 text-[11px] text-red-300">{personalFormError||submitPersonalObservation.error?.message}</p> : null}
            {personalSubmitResult ? <div className="mt-2 rounded-lg border border-emerald-400/25 bg-emerald-400/10 px-3 py-2 text-[11px] text-emerald-100"><p>{personalSubmitResult.notice}</p></div> : null}
            <div className="mt-3 border-t border-sky-300/15 pt-2 text-[11px] text-slate-400">Ces déclarations personnelles restent séparées des mesures Netatmo. La comparaison historique et la calibration restent à migrer ; aucun score ni poids de modèle n’est modifié.</div>
            <button type="button" onClick={() => setIsPersonalHistoryOpen(true)} className="mt-3 min-h-10 w-full rounded-lg border border-slate-600 bg-black/15 px-3 text-xs font-semibold text-slate-200">Consulter mes observations</button>
          </>}
          </div> : null}
        </section>

        <Dialog open={isPersonalHistoryOpen} onOpenChange={setIsPersonalHistoryOpen}>
          <DialogContent className="max-h-[85vh] overflow-y-auto border-slate-700 bg-[#10131a] p-4 text-slate-100 sm:max-w-xl">
            <DialogHeader><DialogTitle className="pr-7 text-white">Historique de mes observations</DialogTitle></DialogHeader>
            <p className="text-xs text-slate-400">Les 200 dernières déclarations pour {selectedLocation?.name??'Hondeghem'}, en heure de Paris.</p>
            {personalHistoryLoading&&<p role="status" className="text-xs text-slate-300">Chargement de votre carnet…</p>}
            {personalHistoryError&&<div role="alert" className="text-xs text-red-300"><p>{personalHistoryError.message}</p><button type="button" onClick={()=>void refetchPersonalHistory()} className="mt-2 min-h-10 rounded-lg border border-slate-600 px-3 text-slate-200">Réessayer</button></div>}
            {deletePersonalObservation.error&&<p role="alert" className="text-xs text-red-300">{deletePersonalObservation.error.message}</p>}
            {personalHistoryLoading||personalHistoryError?null:personalHistory.length === 0 ? <p className="py-8 text-center text-sm text-slate-400">Aucune observation personnelle n’est encore enregistrée pour ce lieu.</p> : <div className="space-y-2">{personalHistory.slice().reverse().map((observation) => <div key={observation.id} className="rounded-xl border border-slate-700 bg-black/20 p-3"><div className="flex items-start justify-between gap-3"><div><p className="text-sm font-semibold text-slate-100">{observation.temperature == null ? "Température non renseignée" : `${Number(observation.temperature).toFixed(1)} °C`} · {PERSONAL_CONDITION_OPTIONS.find((option) => option.id === observation.condition)?.label ?? observation.condition}</p><p className="mt-1 text-[11px] text-slate-400">{new Date(observation.observedAt).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short", timeZone: "Europe/Paris" })}{observation.windSpeed == null ? "" : ` · vent ${Number(observation.windSpeed).toFixed(0)} km/h`}{observation.precipitation == null ? "" : ` · pluie ${Number(observation.precipitation).toFixed(1)} mm`}</p></div><div className="flex shrink-0 gap-2"><button type="button" onClick={() => {setPersonalEditError(''); updatePersonalObservation.reset(); setEditingPersonalObservation({ id: observation.id, temperature: observation.temperature?.toString() ?? "", windSpeed: observation.windSpeed?.toString() ?? "", precipitation: observation.precipitation?.toString() ?? "", condition: observation.condition as (typeof PERSONAL_CONDITION_OPTIONS)[number]["id"] });}} className="min-h-9 rounded-lg border border-sky-400/35 px-2.5 text-[11px] font-semibold text-sky-200">Modifier</button><button type="button" disabled={deletePersonalObservation.isPending||!personalOnline} onClick={() => { if (window.confirm("Supprimer définitivement cette observation personnelle ?")) deletePersonalObservation.mutate({ id: observation.id }); }} className="min-h-9 rounded-lg border border-red-400/35 px-2.5 text-[11px] font-semibold text-red-200 disabled:opacity-60">Supprimer</button></div></div></div>)}</div>}
          </DialogContent>
        </Dialog>

        <Dialog open={editingPersonalObservation !== null} onOpenChange={(open) => { if (!open) setEditingPersonalObservation(null); }}>
          <DialogContent className="max-h-[85vh] overflow-y-auto border-slate-700 bg-[#10131a] p-4 text-slate-100 sm:max-w-md"><DialogHeader><DialogTitle className="pr-7 text-white">Modifier mon observation</DialogTitle></DialogHeader>{editingPersonalObservation ? <div className="space-y-3"><div className="grid grid-cols-2 gap-2"><label className="text-xs text-slate-300">Température (°C)<input inputMode="decimal" value={editingPersonalObservation.temperature} onChange={(event) => setEditingPersonalObservation({ ...editingPersonalObservation, temperature: event.target.value })} className="mt-1 min-h-10 w-full rounded-lg border border-slate-600 bg-black/20 px-3 text-sm text-white" /></label><label className="text-xs text-slate-300">Vent (km/h)<input inputMode="decimal" value={editingPersonalObservation.windSpeed} onChange={(event) => setEditingPersonalObservation({ ...editingPersonalObservation, windSpeed: event.target.value })} className="mt-1 min-h-10 w-full rounded-lg border border-slate-600 bg-black/20 px-3 text-sm text-white" /></label></div><div className="flex flex-wrap gap-1.5">{PERSONAL_CONDITION_OPTIONS.map((option) => <button key={option.id} type="button" onClick={() => setEditingPersonalObservation({ ...editingPersonalObservation, condition: option.id })} className={`min-h-9 rounded-lg border px-2 text-[11px] ${editingPersonalObservation.condition === option.id ? "border-sky-300/60 bg-sky-400/15 text-sky-100" : "border-slate-700 text-slate-300"}`}>{option.label}</button>)}</div>{acceptsPersonalPrecipitation(editingPersonalObservation.condition) ? <label className="block text-xs text-slate-300">Précipitations (mm)<input inputMode="decimal" value={editingPersonalObservation.precipitation} onChange={(event) => setEditingPersonalObservation({ ...editingPersonalObservation, precipitation: event.target.value })} placeholder="Ex. 1,2" className="mt-1 min-h-10 w-full rounded-lg border border-sky-400/40 bg-black/20 px-3 text-sm text-white" /></label> : null}<button type="button" disabled={updatePersonalObservation.isPending||!personalOnline} onClick={savePersonalObservationEdit} className="min-h-10 w-full rounded-lg border border-emerald-400/40 bg-emerald-400/10 text-xs font-semibold text-emerald-100 disabled:opacity-60">{updatePersonalObservation.isPending ? "Enregistrement…" : "Enregistrer la correction"}</button>{personalEditError&&<p role="alert" className="text-xs text-red-300">{personalEditError}</p>}{updatePersonalObservation.error&&<p role="alert" className="text-xs text-red-300">{updatePersonalObservation.error.message}</p>}<p className="text-[11px] leading-relaxed text-slate-400">La correction met à jour votre déclaration sans changer les scores ni les poids météo.</p></div> : null}</DialogContent>
        </Dialog>

        {needsLocalStations && !locationWeather && <div className="dashboard-sky-card rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-3" role={locationWeatherError?'alert':'status'}>
          <p className="text-xs text-slate-200">{locationWeatherError?'Le contexte local n’a pas pu être chargé.':'Recherche et contrôle des stations locales…'}</p>
          {locationWeatherError&&<button type="button" onClick={()=>void refetchLocationWeather()} className="mt-2 min-h-10 rounded-lg border border-sky-400/35 px-3 text-xs text-sky-200">Réessayer</button>}
        </div>}
        {localMode !== "standard" && locationWeather?.ultraLocal && (
          <section className="space-y-2" aria-labelledby="local-context-title">
            <div className="flex items-center justify-between gap-2 px-1">
              <div className="min-w-0">
                <h2 id="local-context-title" className="text-sm font-semibold text-slate-100">Moyenne locale pondérée</h2>
                <LocalModelContributionNotice
                  localMode={localMode}
                  isPlaceholderData={locationWeatherIsPlaceholder}
                  estimateTemperature={locationWeather.ultraLocal.temperature}
                  stationCount={locationWeather.ultraLocal.stationCount}
                  modelContribution={locationWeather.ultraLocal.modelContribution}
                  modelWeight={locationWeather.ultraLocal.modelWeight}
                  finalModelWeight={locationWeather.ultraLocal.finalModelWeight}
                  usesOfficialFallback={locationWeather.ultraLocal.usesOfficialFallback}
                  usesModelFallback={locationWeather.ultraLocal.usesModelFallback}
                />
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[10px] text-muted-foreground">{locationWeatherFetching && locationWeatherIsPlaceholder ? "Filtre local en cours…" : "n’influence pas la prévision officielle"}</span>
                <button type="button" onClick={() => handleModeChange("standard")} aria-label="Fermer le contexte local et revenir au mode Officiel" title="Revenir au mode Officiel" className="weather-icon-bare inline-flex size-8 shrink-0 items-center justify-center rounded-full border border-slate-600/70 bg-slate-900/70 text-slate-200 transition-colors hover:border-sky-300/65 hover:bg-sky-400/15 hover:text-sky-100 active:scale-95">
                  <X className="size-4" />
                </button>
              </div>
            </div>
            <div className="dashboard-sky-card rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-2xl font-bold text-emerald-300">{locationWeather.ultraLocal.temperature != null ? `${Number(locationWeather.ultraLocal.temperature).toFixed(1)}°C` : "—"}</p>
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    {locationWeather.ultraLocal.stationCount > 0
                      ? `${locationWeather.ultraLocal.stationCount} station${locationWeather.ultraLocal.stationCount > 1 ? "s" : ""} physique${locationWeather.ultraLocal.stationCount > 1 ? "s" : ""} admise${locationWeather.ultraLocal.stationCount > 1 ? "s" : ""} pour ce calcul`
                      : locationWeather.ultraLocal.usesOfficialFallback?"Repli explicite sur le snapshot Open-Meteo":"Température locale indisponible"}
                  </p>
                </div>
                <WeatherStatusBadge compact tone="success" label="Relevés locaux" value={locationWeather.ultraLocal.stationCount > 0 ? `${locationWeather.ultraLocal.stationCount} station(s)` : "Données insuffisantes"} pulse={locationWeather.ultraLocal.stationCount > 0} description="Nombre de stations locales retenues pour le contexte physique. Ce compteur n’est pas un score et ne mesure pas la fiabilité des prévisions." />
              </div>
              <AltitudeCorrectionNotice correction={locationWeather.ultraLocal.altitudeCorrection} isPlaceholderData={locationWeatherIsPlaceholder} />
              {locationWeather.ultraLocal.altitudeCorrection?.applied&&<p className="mt-1 text-[10px] text-slate-400">Gradient standard approximatif de 0,65 °C/100 m ; le profil atmosphérique réel n’est pas mesuré ici.</p>}
              <p className="mt-2 text-[10px] leading-relaxed text-slate-300">{locationWeather.ultraLocal.explanation}</p>
              <p className="mt-1 text-[10px] leading-relaxed text-slate-400">Priorité technique Netatmo : 72/100, distincte d’un score historique. Les ajustements urbains, côtiers et de vallée restent désactivés sans calibration qualifiée.</p>
              {hasMaterialLocalDelta ? <div className="mt-3 rounded-xl border border-amber-400/30 bg-amber-400/10 px-3 py-2.5" role="status">
                <div className="flex items-start justify-between gap-3"><div><p className="text-[11px] font-semibold text-amber-100">Écart du calcul local avec le snapshot du modèle</p><p className="mt-0.5 text-[10px] leading-relaxed text-slate-300">L’indicateur principal utilise les stations physiques retenues ou, champ par champ, le snapshot Open-Meteo. Ce calcul Local/Ultra-local séparé peut comporter une contribution modèle; la prévision horaire reste dans sa série dédiée.</p></div><span className="shrink-0 text-sm font-bold text-amber-200">{localOfficialDelta > 0 ? "+" : ""}{localOfficialDelta.toFixed(1)}°</span></div>
                <p className="mt-1.5 text-[10px] text-slate-400">Snapshot du modèle : {officialSnapshotTemp == null ? "—" : `${officialSnapshotTemp.toFixed(1)}°C`} · résultat du mode Local/Ultra-local (distinct de l’indicateur principal) : {localObservation?.temperature.toFixed(1)}°C{localObservation?.observedAt ? ` · mesure source la plus récente ${new Date(localObservation.observedAt).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Paris" })}` : ""}.</p>
              </div> : null}
              <div className="mt-3 border-t border-emerald-500/15 pt-2">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <p className="text-[11px] font-semibold text-emerald-100">Couverture locale</p>
                    <p className="mt-0.5 text-[10px] text-slate-400">{localModeLabel} · rayon maximum {localRadiusKm} km</p>
                    <p className="mt-0.5 text-[10px] text-slate-400">Recherche Netatmo : 50 km autour du lieu. {localMode==='local'?'Sélection du calcul Local : moins de 30 km.':'Sélection du calcul Ultra-local : moins de 10 km.'}</p>
                  </div>
                  <span className="rounded-full border border-emerald-400/25 bg-emerald-400/10 px-2 py-1 text-[10px] font-semibold text-emerald-200">{localCoverageBands.reduce((total: number, band: any) => total + band.stationCount, 0)} station{localCoverageBands.reduce((total: number, band: any) => total + band.stationCount, 0) > 1 ? "s" : ""}</span>
                </div>
                <div className="mt-2 grid gap-1.5 sm:grid-cols-2">
                  {localCoverageBands.map((band: any) => {
                    const hasContributors = band.stationCount > 0;
                    return (
                      <div key={band.band} className={`rounded-lg border px-2 py-1.5 ${hasContributors ? "border-emerald-400/25 bg-emerald-400/10" : "border-slate-700/70 bg-slate-950/25"}`}>
                        <div className="flex items-center justify-between gap-2 text-[10px]">
                          <span className={hasContributors ? "font-semibold text-emerald-100" : "font-semibold text-slate-300"}>{band.band}</span>
                          <span className={hasContributors ? "text-emerald-200" : "text-slate-500"}>{band.stationCount} station{band.stationCount > 1 ? "s" : ""}</span>
                        </div>
                        <p className="mt-0.5 text-[9px] text-slate-400">{hasContributors ? `Poids réellement utilisé : ${Math.round(Number(band.effectiveWeight) * 100)} %` : "Aucune station contributrice dans cette bande"}</p>
                      </div>
                    );
                  })}
                </div>
              </div>
              {localContributors.length > 0 ? (
                <div className="mt-3 border-t border-emerald-500/15 pt-2">
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <p className="text-[11px] font-semibold text-emerald-100">Stations contributrices</p>
                      <p className="mt-0.5 text-[10px] text-slate-400">Seules les stations admises par les contrôles apparaissent ici.</p>
                    </div>
                    <span className="text-[10px] font-medium text-emerald-200">{localContributors.length}</span>
                  </div>
                  <div className="mt-2 space-y-1.5">
                    {visibleLocalContributors.map((station: any) => {
                      const hasAppliedAdjustment = Number.isFinite(Number(station.altitudeAdjustment)) && Number(station.altitudeAdjustment) !== 0;
                      const displayedTemperature = hasAppliedAdjustment ? station.adjustedTemperature : station.temperature;
                      return (
                        <div key={station.stationId} className="flex items-center justify-between gap-2 text-[11px] text-slate-300">
                          <span className="min-w-0 truncate">{station.name} · {station.band} · {station.distanceKm.toFixed(1)} km</span>
                          <span className="shrink-0 text-emerald-200">{displayedTemperature == null ? "—" : Number(displayedTemperature).toFixed(1)}° · {hasAppliedAdjustment ? "alt. corrigée" : "brute"} · {Math.round(station.weight * 100)}%</span>
                        </div>
                      );
                    })}
                  </div>
                  {localContributors.length > 6 ? (
                    <button type="button" onClick={() => setShowAllLocalContributors((open) => !open)} className="mt-2 min-h-8 rounded-md border border-emerald-400/30 bg-emerald-400/10 px-2.5 text-[10px] font-semibold text-emerald-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300">
                      {showAllLocalContributors ? "Réduire les stations" : `Afficher les ${localContributors.length - 6} autres stations`}
                    </button>
                  ) : null}
                  <p className="pt-2 text-[10px] leading-relaxed text-slate-400">Contrôles calculés à cette requête : distance, fraîcheur, fiabilité, cohérence et altitude seulement avec une référence explicite. Sans cible, le contrôle altitude est non vérifiable et les températures restent brutes. La stabilité longue durée exige un historique et n’est pas déduite de ce seul affichage.</p>
                </div>
              ) : modelFallbackContributors.length > 0 ? (
                <p className="mt-3 border-t border-emerald-500/15 pt-2 text-[10px] leading-relaxed text-slate-400">Aucune station contributrice n’est disponible dans ce rayon. Contributeurs de repli : {modelFallbackContributors.map((model: any) => `${model.name} ${Math.round(Number(model.weight) * 100)}%`).join(" · ")}. Aucun modèle n’est présenté comme station.</p>
              ) : (
                <p className="mt-3 border-t border-emerald-500/15 pt-2 text-[10px] leading-relaxed text-slate-400">Aucune station contributrice n’est disponible dans ce rayon. Le mode local reste explicite et ne remplace pas la prévision officielle.</p>
              )}
              <p className="mt-2 text-[10px] leading-relaxed text-slate-400">{netatmoStatusLabel[locationWeather.netatmo?.status ?? "not_connected"]}</p>
              {localNetatmoMessage&&<p role="status" className="mt-1 text-[10px] text-amber-200">{localNetatmoMessage}</p>}
            </div>
            <a href="/connexion-netatmo" className="inline-flex min-h-10 items-center px-2 text-xs text-sky-300">Gérer la connexion Netatmo de cette application →</a>
            <LocalOfficialDeltaChart points={localOfficialHistory} />
          </section>
        )}

        {/* Hourly Chart */}
        <div className="overflow-visible rounded-[22px]">
          <HourlyWeightingNotice
            weighting={officialForecast?.officialSnapshot?.hourlyWeighting}
            showCoverageDistribution={false}
            showFallbackDetails={false}
          />
          <OfficialForecastCalculationTimes
            hourlyComputedAt={officialForecast?.officialSnapshot?.hourlyComputedAt}
            computedAt={officialForecast?.officialSnapshot?.computedAt}
            className="mb-2 px-1"
          />
          {hourlyLoading ? (
            <div className="h-56 bg-muted rounded-xl animate-pulse" />
          ) : hours.length > 0 ? (
            <Suspense fallback={<div className="h-56 bg-muted rounded-xl animate-pulse" />}>
              <HourlyChart key={`${coordsInput.lat}/${coordsInput.lon}`} fusionDiagnostics={(officialForecast as unknown as {fusionDiagnostics?:FusionTrace})?.fusionDiagnostics??[]} computedAt={officialForecast?.officialSnapshot?.computedAt??null} stale={officialForecast?.officialSnapshot?.snapshotStatus==='stale'} hours={chartHours} locationName={selectedLocation?.name ?? DEFAULT_OFFICIAL_FORECAST_LOCATION.name} activeHourIndex={currentHourIndex} activeHourMeasurementLabel={stationTemperature?.provenanceLabel ?? null} />
            </Suspense>
          ) : (
            <div className="rounded-xl border border-blue-400/20 bg-blue-400/5 px-4 py-5 text-center">
              <p className="text-sm font-medium text-blue-100">Données horaires temporairement indisponibles.</p>
              <p className="mt-1 text-xs text-muted-foreground">La dernière prévision officielle n’a pas encore répondu. Aucune donnée n’est inventée.</p>
              <button type="button" disabled={hourlyFetching} onClick={() => void refetchOfficialForecast()} className="mt-3 min-h-10 rounded-md border border-primary/50 px-3 text-xs font-semibold text-primary disabled:cursor-wait disabled:opacity-60">{hourlyFetching ? "Relance en cours…" : "Réessayer les heures"}</button>
            </div>
          )}
        </div>

        {/* ── 15-day chart enriched ── */}
        <div id="dashboard-daily-forecast" className="overflow-visible rounded-[22px]">
          {officialLoading || dashboardDailyLoading ? (
            <div className="h-72 bg-muted rounded-xl animate-pulse" />
          ) : days.length > 0 ? (
            <Suspense fallback={<div className="h-72 bg-muted rounded-xl animate-pulse" />}>
              <FifteenDayChart key={`${coordsInput.lat}/${coordsInput.lon}`} detailRequest={dailyDetailRequest} onRequestedDetailClose={()=>dailyDetailTrigger.current?.focus()} stale={Boolean((dashboardDailyForecast as {controlCache?:{stale?:boolean}}|undefined)?.controlCache?.stale)} days={days} locationName={selectedLocation?.name ?? DEFAULT_OFFICIAL_FORECAST_LOCATION.name} />
            </Suspense>
          ) : (
            <div className="rounded-xl border border-blue-400/20 bg-blue-400/5 px-4 py-5 text-center">
              <p className="text-sm font-medium text-blue-100">Prévisions journalières temporairement indisponibles.</p>
              <p className="mt-1 text-xs text-muted-foreground">La collecte partagée peut continuer en arrière-plan. Les conditions présentes et les heures disponibles restent visibles.</p>
              <button type="button" disabled={dashboardDailyFetching} onClick={() => void refetchDashboardDaily()} className="mt-3 min-h-10 rounded-md border border-primary/50 px-3 text-xs font-semibold text-primary disabled:opacity-60">{dashboardDailyFetching ? "Relance en cours…" : "Réessayer les jours"}</button>
            </div>
          )}
        </div>

        <DashboardFusionTrace
          key={`fusion/${coordsInput.lat}/${coordsInput.lon}`}
          points={(officialForecast as unknown as {fusionDiagnostics?:FusionTrace})?.fusionDiagnostics??[]}
          preferredValidAt={currentHour?.validAt??null}
          computedAt={officialForecast?.officialSnapshot?.computedAt??null}
          stale={officialForecast?.officialSnapshot?.snapshotStatus==='stale'}
        />
        <DeferredEnvironmentalPanels coords={coordsInput} />
        <DashboardObservationDetails
          key={`observation/${coordsInput.lat}/${coordsInput.lon}`}
          metric={selectedObservation}
          field={selectedObservation ? observationFields[selectedObservation] : null}
          locationName={selectedLocation?.name ?? DEFAULT_OFFICIAL_FORECAST_LOCATION.name}
          points={(officialForecast as unknown as {fusionDiagnostics?:FusionTrace})?.fusionDiagnostics ?? []}
          forecastValidAt={(selectedObservation === 'uv_index' ? uvForecastHour?.validAt : currentHour?.validAt) ?? null}
          computedAt={hourlyForecastComputedAt}
          stale={officialForecast?.officialSnapshot?.snapshotStatus === 'stale'}
          onClose={() => setSelectedObservation(null)}
          restoreFocus={() => { if (observationTrigger.current?.isConnected) observationTrigger.current.focus(); }}
        />

      </div>
      <BackToTopButton />
    </div>
  );
}

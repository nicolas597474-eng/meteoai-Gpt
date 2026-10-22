import {useLocation} from '@/contexts/LocationContext';
import {hourlySkyCondition} from '@/lib/hourlySkyPresentation';
import { useRef, useState, useEffect, useCallback, useMemo } from "react";
import { Clock, MapPin, X, Thermometer, Wind, Droplets, Sun, Cloud, Navigation, Gauge, Eye, ChevronDown } from "lucide-react";
import { MeteoIcon, getIconNameFromCondition } from "@/components/MeteoIcon";
import { getHourlyConditionLabel } from "@/lib/hourlyConditionLabel";
import { formatHourlyDisplay } from "@/lib/hourlyDisplay";
import { getChartTemperatureScale } from "@/lib/chartTemperatureScale";
import { getLabelAboveCurveY, TEMPERATURE_LABEL_ABOVE_GAP } from "@/lib/chartLabelLanes";
import { drawTemperatureCurveSegments, getTemperatureTone } from "@/lib/chartTemperatureTone";
import {DashboardFusionTrace} from '@/components/weather/DashboardFusionTrace';
import type {DashboardFusionTrace as FusionTrace} from '@shared/dashboardFusionTrace';
import {hourlyDetailKey,selectedHourlyDetailIndex,findHourlyDetailTrace,hourlyDetailTemperature,formatHourlyDetailDate,formatHourlyDetailNumber} from '@/lib/hourlyDetail';
import type { HourlyMultiModelMetrics } from "@shared/hourlyModelMetrics";
import { findActiveHourlyForecastIndex } from "@shared/hourlyForecastTime";
import { useProvenanceDisplay } from "@/contexts/ProvenanceDisplayContext";

// ─── Types ────────────────────────────────────────────────────────────────────
export interface HourData {
  date?: string | null;
  hour: string;
  validAt?: number;
  temp: number | null;
  apparentTemp: number | null;
  precipitation: number | null;
  windSpeed: number | null;
  windGust?: number | null;
  windDirection: number | null;
  cloudCover: number | null;
  humidity: number | null;
  uvIndex: number | null;
  condition: string | null;
  weatherCode?: number | null;
  pressure?: number | null;
  dewPoint?: number | null;
  visibility?: number | null;
  solarRadiation?: number | null;
  cloudLow?: number | null;
  cloudMid?: number | null;
  cloudHigh?: number | null;
  precipType?: string | null;
  precipIntensity?: string | null;
  multiModelMetrics?: HourlyMultiModelMetrics | null;
}

interface Props {
  hours: HourData[];
  locationName?: string;
  activeHourIndex?: number;
  /** Provenance de la mesure des stations physiques quand le point actuel est une observation. */
  activeHourMeasurementLabel?: string | null;
  fusionDiagnostics?: FusionTrace;
  computedAt?: string | null;
  stale?: boolean;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function getConditionLabel(cloudCover: number | null, precip: number | null, condition: string | null): string {
  return getHourlyConditionLabel(cloudCover, precip, condition);
}

function getConditionBg(cloudCover: number | null, precip: number | null, condition: string | null): string {
  const cond = (condition ?? "").toLowerCase();
  if (cond.includes("orage")) return "rgba(148, 163, 184, 0.045)";
  if ((precip != null && precip > 2) || cond.includes("pluie") || cond.includes("averse")) return "rgba(148, 163, 184, 0.032)";
  if ((cloudCover != null && cloudCover > 75) || cond.includes("couvert")) return "rgba(148, 163, 184, 0.04)";
  if ((cloudCover != null && cloudCover < 30) || cond.includes("ensoleillé")) return "rgba(255, 255, 255, 0.025)";
  return "rgba(255, 255, 255, 0.014)";
}

function degToCompass(deg: number | null): string {
  if (deg == null) return "—";
  const dirs = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSO", "SO", "OSO", "O", "ONO", "NO", "NNO"];
  return dirs[Math.round(deg / 22.5) % 16];
}

// ─── Weather Icon (MeteoAI pack) ─────────────────────────────────────────────
// Presentation « full » : les graphiques du Dashboard utilisent les mêmes
// icônes météo 3D illustrées que l'en-tête et la page Prévisions (PNG du pack
// MeteoAI, partagés et mis en cache par le navigateur).
function WeatherIconSVG({ condition, size = 20 }: { condition: string; size?: number }) {
  return <MeteoIcon name={getIconNameFromCondition(condition)} size={size} />;
}

function visibilityLabel(value: number | null | undefined): string {
  if (value == null) return "indisponible";
  if (value < 1) return "très réduite";
  if (value < 5) return "réduite";
  if (value < 10) return "moyenne";
  return "bonne";
}

function HourlyScaleLabels({
  totalHeight,
  tempTop,
  tempBottom,
  windTop,
  windBottom,
  precipTop,
  precipBottom,
  scaleTop,
  scaleBot,
  windMax,
  precipMax,
}: {
  totalHeight: number;
  tempTop: number;
  tempBottom: number;
  windTop: number;
  windBottom: number;
  precipTop: number;
  precipBottom: number;
  scaleTop: number;
  scaleBot: number;
  windMax: number;
  precipMax: number;
}) {
  const tempTicks = getChartTemperatureScale([scaleBot, scaleTop], 0).ticks;
  const tempToAxisY = (value: number) => tempTop + (1 - (value - scaleBot) / (scaleTop - scaleBot || 1)) * (tempBottom - tempTop);
  return (
    <aside aria-label="Échelles du graphique horaire" className="relative z-10 w-10 shrink-0 border-r border-slate-700/70 bg-[#06080d] text-right text-[8px] font-medium text-slate-500" style={{ height: totalHeight }}>
      <span className="absolute left-1 top-1 text-[7px] font-semibold text-white">°C</span>
      {tempTicks.map((tick) => <span key={tick} className="absolute right-1.5 -translate-y-1/2 text-white" style={{ top: tempToAxisY(tick) }}>{tick}°</span>)}
      <span className="absolute left-1 text-[7px] font-semibold text-emerald-400" style={{ top: windTop + 1 }}>km/h</span>
      <span className="absolute right-1.5 text-emerald-400" style={{ top: windTop + 12 }}>{windMax}</span>
      <span className="absolute right-1.5 text-emerald-400/80" style={{ top: windBottom - 10 }}>0</span>
      <span className="absolute left-1 text-[7px] font-semibold text-sky-400" style={{ top: precipTop + 1 }}>mm</span>
      <span className="absolute right-1.5 text-sky-400" style={{ top: precipTop + 12 }}>{precipMax.toFixed(1)}</span>
      <span className="absolute right-1.5 text-sky-400/80" style={{ top: precipBottom - 10 }}>0</span>
    </aside>
  );
}

// ─── Detail Overlay ──────────────────────────────────────────────────────────
export function HourDetailOverlay({ hour, onClose, trace, computedAt, stale, measurementLabel,conditionOverride }: { conditionOverride?:string|null;hour: HourData; onClose: () => void;trace:FusionTrace[number]|null;computedAt:string|null;stale:boolean;measurementLabel:string|null }) {
  const cond = getConditionLabel(hour.cloudCover, hour.precipitation, conditionOverride??hour.condition);
  const metrics = hour.multiModelMetrics ?? null;
  const temperatureMetrics = metrics?.temperature;
  const hasGust = hour.windGust != null;
  const forecastTemperature=hourlyDetailTemperature(hour,trace,!!measurementLabel);
  const [comparisonOpen, setComparisonOpen] = useState(false);

  return (
    <section className="mb-3 rounded-2xl border border-blue-400/25 bg-[#0a0e14] p-4 shadow-[0_12px_28px_rgba(15,23,42,0.35)] animate-in slide-in-from-top-2 duration-200" role="region" aria-labelledby="hour-detail-title">

        {/* Header */}
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-3">
            <WeatherIconSVG condition={cond} size={32} />
            <div>
              <h3 id="hour-detail-title" className="font-semibold text-white text-base">{formatHourlyDetailDate(hour)}</h3>
              <p className="text-xs text-slate-400">{cond}</p>
            </div>
          </div>
          <button onClick={onClose} aria-label="Fermer les détails de la prévision horaire" className="inline-flex min-h-11 items-center gap-1.5 rounded-xl border border-slate-600/60 bg-slate-800/70 px-3 text-xs font-semibold text-slate-200 transition-colors hover:bg-slate-700 active:scale-95">
            <X className="h-5 w-5" />
            <span>Fermer</span>
          </button>
        </div>

        <p className="mb-2 text-xs text-slate-300">Prévision Open-Meteo · {stale?'dernière prévision en cache':'snapshot chargé'}{computedAt&&Number.isFinite(Date.parse(computedAt))?` · calcul ${new Intl.DateTimeFormat('fr-FR',{timeZone:'Europe/Paris',day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'}).format(new Date(computedAt))} (Paris)`:''}.</p>
        {measurementLabel&&<p className="mb-3 rounded-lg border border-sky-300/20 px-2 py-2 text-xs text-sky-100">Le point actuel du graphique affiche une observation : {measurementLabel}. Les valeurs ci-dessous restent les prévisions de cette échéance.</p>}
        {metrics && (
          <div className="mb-3 rounded-xl border border-amber-300/20 bg-amber-300/[0.06]">
            <button type="button" onClick={() => setComparisonOpen((open) => !open)} aria-expanded={comparisonOpen} className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-xs text-amber-50 active:scale-[0.99]">
              <span><span className="font-semibold">Dispersion thermique · étendue {temperatureMetrics?.range == null ? "—" : `${formatHourlyDetailNumber(temperatureMetrics.range)}°C`}</span><span className="ml-1 text-[10px] text-amber-100/70">· {temperatureMetrics ? `${temperatureMetrics.availableModelCount}/${metrics.expectedModelCount} modèles` : "effectif indisponible"}</span></span>
              <span className="flex items-center gap-1 text-[10px]">Statistiques <ChevronDown className={`h-3.5 w-3.5 transition-transform ${comparisonOpen ? "rotate-180" : ""}`} /></span>
            </button>
            {comparisonOpen && (
              <div className="border-t border-slate-600/30 px-3 pb-3 pt-2.5 text-[11px]">
                <p className="font-semibold text-slate-100">Statistiques descriptives des valeurs valides · Best Match exclu</p>
                <div className="mt-2 grid grid-cols-2 gap-2">
                  <div className="rounded-lg border border-sky-400/20 bg-sky-400/5 px-2.5 py-2"><p className="text-[9px] uppercase tracking-wide text-sky-200/75">Minimum</p><p className="mt-1 font-semibold text-slate-100">{temperatureMetrics?.min == null ? "—" : `${formatHourlyDetailNumber(temperatureMetrics.min)}°C`}</p><p className="text-sky-200">{temperatureMetrics?.minModel ?? "modèle indisponible"}</p></div>
                  <div className="rounded-lg border border-orange-400/20 bg-orange-400/5 px-2.5 py-2"><p className="text-[9px] uppercase tracking-wide text-orange-200/75">Maximum</p><p className="mt-1 font-semibold text-slate-100">{temperatureMetrics?.max == null ? "—" : `${formatHourlyDetailNumber(temperatureMetrics.max)}°C`}</p><p className="text-orange-200">{temperatureMetrics?.maxModel ?? "modèle indisponible"}</p></div>
                </div>
                <div className="mt-2 space-y-1 leading-relaxed text-slate-300">
                  <p>Moyenne pondérée officielle : <b>{temperatureMetrics?.weightedMean == null ? "—" : `${formatHourlyDetailNumber(temperatureMetrics.weightedMean)}°C`}</b></p>
                  <p>Médiane : <b>{temperatureMetrics?.median == null ? "—" : `${formatHourlyDetailNumber(temperatureMetrics.median)}°C`}</b> · écart-type population : <b>{temperatureMetrics?.standardDeviation == null ? "—" : `${formatHourlyDetailNumber(temperatureMetrics.standardDeviation)}°C`}</b></p>
                  <p>Modèles température disponibles ({temperatureMetrics ? `${temperatureMetrics.availableModelCount}/${metrics.expectedModelCount}` : "effectif indisponible"}) : {temperatureMetrics?.modelsWithData.join(", ") || "aucun"}</p>
                  {temperatureMetrics?.availableModelCount != null && temperatureMetrics.availableModelCount < 2 && <p>Dispersion non calculable avec moins de deux valeurs valides.</p>}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Main grid */}
        <div className="grid grid-cols-2 gap-2">
          {/* Temperature */}
          <div className="bg-white/5 rounded-lg p-2.5 border border-white/5">
            <div className="flex items-center gap-1.5 mb-1"><Thermometer className="h-3.5 w-3.5 text-orange-400" /><span className="text-[10px] uppercase tracking-wider text-slate-500">Moyenne pondérée officielle</span></div>
            <p className="text-sm font-bold text-white">{forecastTemperature != null ? `${new Intl.NumberFormat("fr-FR",{maximumFractionDigits:1}).format(forecastTemperature)}°C` : "—"}</p>
            {temperatureMetrics?.range != null && <p className="text-[10px] text-slate-500 mt-0.5">Étendue inter-modèles : {formatHourlyDetailNumber(temperatureMetrics.range)}°C</p>}
            {temperatureMetrics && <p className="text-[10px] text-slate-500 mt-0.5">Valeurs disponibles : {temperatureMetrics.availableModelCount}/{metrics!.expectedModelCount}</p>}
          </div>

          {/* Ressenti */}
          <div className="bg-white/5 rounded-lg p-2.5 border border-white/5">
            <div className="flex items-center gap-1.5 mb-1"><Thermometer className="h-3.5 w-3.5 text-pink-400" /><span className="text-[10px] uppercase tracking-wider text-slate-500">Ressenti</span></div>
            <p className="text-sm font-bold text-white">{hour.apparentTemp != null ? `${formatHourlyDetailNumber(hour.apparentTemp)}°C` : "—"}</p>
          </div>

          {/* Vent */}
            <div className="bg-white/5 rounded-lg p-2.5 border border-white/5">
              <div className="flex items-center gap-1.5 mb-1"><MeteoIcon name="wind_param" size={17} className="shrink-0" /><span className="text-[10px] uppercase tracking-wider text-slate-500">Vent</span></div>
            <p className="text-sm font-bold text-white">{formatHourlyDetailNumber(hour.windSpeed)} <span className="text-[10px] text-slate-400">km/h</span></p>
            {hasGust && <p className="text-[10px] text-orange-300 mt-0.5">Rafales: {formatHourlyDetailNumber(hour.windGust,0)} km/h</p>}
          </div>

          {/* Direction */}
          <div className="bg-white/5 rounded-lg p-2.5 border border-white/5">
            <div className="flex items-center gap-1.5 mb-1"><Navigation className="h-3.5 w-3.5 text-sky-400" style={{ transform: `rotate(${((hour.windDirection ?? 0) + 180) % 360}deg)` }} /><span className="text-[10px] uppercase tracking-wider text-slate-500">Direction</span></div>
            <p className="text-sm font-bold text-white">{degToCompass(hour.windDirection)}</p>
            {hour.windDirection != null && <p className="text-[10px] text-slate-500 mt-0.5">{Math.round(hour.windDirection)}°</p>}
          </div>

          {/* Précipitations */}
          <div className="bg-white/5 rounded-lg p-2.5 border border-white/5">
            <div className="flex items-center gap-1.5 mb-1"><Droplets className="h-3.5 w-3.5 text-blue-400" /><span className="text-[10px] uppercase tracking-wider text-slate-500">Estimation de consensus</span></div>
            <p className="text-sm font-bold text-blue-400">{hour.precipitation != null ? `${formatHourlyDetailNumber(hour.precipitation,2)} mm` : "—"}</p>
            {hour.precipType ? <p className="mt-0.5 text-[10px] text-slate-500">{hour.precipType === "snow" ? "Neige" : hour.precipType === "freezing_rain" ? "Pluie verglaçante" : "Pluie"}{hour.precipIntensity ? ` · ${hour.precipIntensity === "heavy" ? "forte" : hour.precipIntensity === "moderate" ? "modérée" : "faible"}` : ""}</p> : null}
          </div>

          <div className="bg-white/5 rounded-lg p-2.5 border border-white/5">
            <p className="text-[10px] uppercase tracking-wider text-slate-500">Accord pluie des modèles</p>
            <p className="text-sm font-bold text-sky-300">{metrics?.precipitation.frequencyPercent==null?'—':`${new Intl.NumberFormat('fr-FR',{maximumFractionDigits:1}).format(metrics.precipitation.frequencyPercent)} %`}</p>
            <p className="mt-0.5 text-[10px] text-slate-400">{metrics?`${metrics.precipitation.rainModelCount}/${metrics.precipitation.availableModelCount} modèles prévoient au moins ${metrics.precipitation.thresholdMm.toLocaleString('fr-FR')} mm.`:'Donnée non fournie.'} Ce n’est pas une probabilité de pluie calibrée.</p>
          </div>
          <div className="bg-white/5 rounded-lg p-2.5 border border-white/5">
            <p className="text-[10px] uppercase tracking-wider text-slate-500">Code météo WMO</p>
            <p className="text-sm font-bold text-white">{hour.weatherCode??'—'}</p>
            <p className="mt-0.5 text-[10px] text-slate-400">Code consolidé des modèles, distinct d’une observation locale.</p>
          </div>
          {/* Humidité */}
            <div className="bg-white/5 rounded-lg p-2.5 border border-white/5">
              <div className="flex items-center gap-1.5 mb-1"><MeteoIcon name="humidity" size={17} className="shrink-0" /><span className="text-[10px] uppercase tracking-wider text-slate-500">Humidité</span></div>
            <p className="text-sm font-bold text-cyan-400">{hour.humidity != null ? `${Math.round(hour.humidity)}%` : "—"}</p>
            <p className="mt-0.5 text-[10px] text-slate-500">Point de rosée {hour.dewPoint != null ? `${formatHourlyDetailNumber(hour.dewPoint)}°C` : "—"}</p>
          </div>

          {/* UV */}
          <div className="bg-white/5 rounded-lg p-2.5 border border-white/5">
            <div className="flex items-center gap-1.5 mb-1"><Sun className="h-3.5 w-3.5 text-yellow-400" /><span className="text-[10px] uppercase tracking-wider text-slate-500">UV</span></div>
            <p className="text-sm font-bold text-yellow-400">{hour.uvIndex != null ? Math.round(hour.uvIndex) : "—"}</p>
            {hour.uvIndex != null && (
              <p className="text-[10px] text-slate-500 mt-0.5">
                {hour.uvIndex <= 2 ? "Faible" : hour.uvIndex <= 5 ? "Modéré" : hour.uvIndex <= 7 ? "Élevé" : hour.uvIndex <= 10 ? "Très élevé" : "Extrême"}
              </p>
            )}
            <p className="mt-0.5 text-[10px] text-slate-500">Rayonnement {hour.solarRadiation != null ? `${Math.round(hour.solarRadiation)} W/m²` : "—"}</p>
          </div>

          {/* Nébulosité */}
          <div className="bg-white/5 rounded-lg p-2.5 border border-white/5">
            <div className="flex items-center gap-1.5 mb-1"><Cloud className="h-3.5 w-3.5 text-slate-400" /><span className="text-[10px] uppercase tracking-wider text-slate-500">Nébulosité</span></div>
            <p className="text-sm font-bold text-white">{hour.cloudCover != null ? `${Math.round(hour.cloudCover)}%` : "—"}</p>
            <p className="mt-0.5 text-[10px] text-slate-500">Bas {formatHourlyDetailNumber(hour.cloudLow)}% · Moy. {formatHourlyDetailNumber(hour.cloudMid)}% · Haut {formatHourlyDetailNumber(hour.cloudHigh)}%</p>
          </div>
          <div className="bg-white/5 rounded-lg p-2.5 border border-white/5">
            <div className="flex items-center gap-1.5 mb-1"><Gauge className="h-3.5 w-3.5 text-violet-400" /><span className="text-[10px] uppercase tracking-wider text-slate-500">Pression</span></div>
            <p className="text-sm font-bold text-violet-300">{hour.pressure != null ? `${Math.round(hour.pressure)} hPa` : "—"}</p>
            <p className="mt-0.5 text-[10px] text-slate-500">Pression de surface</p>
          </div>
          <div className="bg-white/5 rounded-lg p-2.5 border border-white/5">
            <div className="flex items-center gap-1.5 mb-1"><Eye className="h-3.5 w-3.5 text-cyan-300" /><span className="text-[10px] uppercase tracking-wider text-slate-500">Visibilité</span></div>
            <p className="text-sm font-bold text-cyan-200">{hour.visibility != null ? `${formatHourlyDetailNumber(hour.visibility)} km` : "—"}</p>
            <p className="mt-0.5 text-[10px] text-slate-500">Portée {visibilityLabel(hour.visibility)}</p>
          </div>
        </div>
        <div className="mt-3"><DashboardFusionTrace key={hour.validAt??hour.hour} points={trace?[trace]:[]} preferredValidAt={hour.validAt??null} computedAt={computedAt} stale={stale} /></div>
    </section>
  );
}

// ─── MAIN COMPONENT ───────────────────────────────────────────────────────────
export default function HourlyChart({ hours, locationName, activeHourIndex, activeHourMeasurementLabel, fusionDiagnostics=[], computedAt=null, stale=false }: Props) {
  const { showProvenance } = useProvenanceDisplay();
  const {activeLocation}=useLocation();
  const skyCondition=(hour:HourData)=>{const value=hourlySkyCondition(hour,activeLocation?.lat??50.7567,activeLocation?.lon??2.5204);return value==='clear_night'?'Nuit dégagée':value==='partly_cloudy_night'?'Nuit partiellement nuageuse':value;};
  const scrollRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const progressBarRef = useRef<HTMLDivElement>(null);
  const detailPanelRef = useRef<HTMLDivElement>(null);
  const [selectedTarget,setSelectedTarget]=useState<string|null>(null);
  const selectedHour=selectedHourlyDetailIndex(hours,selectedTarget);
  const [containerWidth, setContainerWidth] = useState(0);
  const [scrollProgress, setScrollProgress] = useState(0);
  const displayPoints = useMemo(() => hours.map((hour) => ({
    date: hour.date ?? null,
    hour: hour.hour,
    validAt: hour.validAt,
  })), [hours]);
  const displayLabels = useMemo(() => displayPoints.map((point) => formatHourlyDisplay(point, displayPoints)), [displayPoints]);

  useEffect(() => {
    if (selectedHour !== null) detailPanelRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [selectedHour]);

  const N = hours.length;
  const VISIBLE_HOURS = 8; // hours visible at once

  // Layout constants
  const COL_W = 76;
  const CHART_H = 300;
  const ICON_ROW = 0;
  const LABEL_ROW = 0;
  const PAD_T = 82;
  const TOTAL_H = CHART_H + ICON_ROW + LABEL_ROW;
  const scrollableW = COL_W * N;

  // Scales
  const { scaleTop, scaleBot, scaleRange, gridStep } = getChartTemperatureScale(hours.map(h => h.temp), 2);

  const maxPrecip = Math.max(...hours.map(h => h.precipitation ?? 0), 1);
  const maxWind = Math.max(...hours.map(h => h.windSpeed ?? 0), 5);
  const windScaleTop = Math.ceil(maxWind / 5) * 5;
  const precipScaleTop = Math.ceil(maxPrecip * 10) / 10;
  // Zone allocation: température 60 %, vent 20 %, pluie 20 %.
  // La lecture reste centrée sur la température depuis le retrait du ressenti.
  const tempZoneTop = PAD_T;
  // Les valeurs maximales occupent une bande fixe au-dessus de la courbe :
  // aucun chiffre ne peut ainsi recouvrir son point ou son tracé.
  const tempCurveTop = tempZoneTop + 34;
  const tempZoneBot = PAD_T + (CHART_H - PAD_T) * 0.60;
  const windZoneTop = tempZoneBot + 4;
  const windZoneBot = windZoneTop + (CHART_H - PAD_T) * 0.20;
  const precipZoneTop = windZoneBot + 2;
  const precipZoneBot = CHART_H - 2;

  const tempToY = useCallback((t: number) => tempCurveTop + (1 - (t - scaleBot) / scaleRange) * (tempZoneBot - tempCurveTop), [scaleBot, scaleRange, tempCurveTop, tempZoneBot]);
  const colX = useCallback((i: number) => i * COL_W + COL_W / 2, []);

  // Active forecast interval index
  const nowHour = useMemo(() => {
    return activeHourIndex ?? findActiveHourlyForecastIndex(hours, Date.now());
  }, [activeHourIndex, hours]);
  const dayBoundaryIndexes = useMemo(
    () => hours.reduce<number[]>((indexes, hour, index) => {
      if (index > 0 && hour.hour === "00:00") indexes.push(index);
      return indexes;
    }, []),
    [hours],
  );

  // ── Draw canvas ──────────────────────────────────────────────────────────────
  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || N === 0) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = scrollableW * dpr;
    canvas.height = TOTAL_H * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    // Fond opaque garanti avant tout tracé, y compris après un redimensionnement
    // mobile qui réinitialise le bitmap du Canvas.
    ctx.fillStyle = "#05070a";
    ctx.fillRect(0, 0, scrollableW, TOTAL_H);

    // Per-hour background
    hours.forEach((h, i) => {
      const x = i * COL_W;
      ctx.fillStyle = getConditionBg(h.cloudCover, h.precipitation, h.condition);
      ctx.fillRect(x, 0, COL_W, CHART_H);
    });

    // Vertical separators
    for (let i = 1; i < N; i++) {
      const x = i * COL_W;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, CHART_H);
      ctx.strokeStyle = "rgba(148, 163, 184, 0.06)";
      ctx.lineWidth = 1;
      ctx.stroke();
    }

    // Le changement de journée reste visible dans les 48 heures, sans modifier
    // les relevés horaires ni les axes de lecture.
    dayBoundaryIndexes.forEach((boundaryIndex) => {
      const x = boundaryIndex * COL_W;
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, CHART_H);
      ctx.setLineDash([6, 4]);
      ctx.strokeStyle = "rgba(96, 165, 250, 0.88)";
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.restore();
    });

    // Horizontal grid (temp)
    for (let t = scaleBot; t <= scaleTop; t += gridStep) {
      const y = tempToY(t);
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(scrollableW, y);
      ctx.strokeStyle = "rgba(148, 163, 184, 0.06)";
      ctx.lineWidth = 1;
      ctx.stroke();
    }

    // Clear reading bands: temperatures, wind, then precipitation.
    [windZoneTop - 3, precipZoneTop - 3].forEach((y) => {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(scrollableW, y);
      ctx.strokeStyle = "rgba(148, 163, 184, 0.26)";
      ctx.lineWidth = 1;
      ctx.stroke();
    });

    // Current hour highlight
    if (nowHour >= 0 && nowHour < N) {
      const x = nowHour * COL_W;
      const g = ctx.createLinearGradient(x, 0, x + COL_W, 0);
      g.addColorStop(0, "rgba(37, 99, 235, 0)");
      g.addColorStop(0.5, "rgba(37, 99, 235, 0.16)");
      g.addColorStop(1, "rgba(37, 99, 235, 0)");
      ctx.fillStyle = g;
      ctx.fillRect(x, 0, COL_W, TOTAL_H);
    }

    // Selected hour highlight
    if (selectedHour !== null && selectedHour < N && selectedHour !== nowHour) {
      const x = selectedHour * COL_W;
      const g = ctx.createLinearGradient(x, 0, x + COL_W, 0);
      g.addColorStop(0, "rgba(168, 85, 247, 0)");
      g.addColorStop(0.5, "rgba(168, 85, 247, 0.08)");
      g.addColorStop(1, "rgba(168, 85, 247, 0)");
      ctx.fillStyle = g;
      ctx.fillRect(x, 0, COL_W, TOTAL_H);
    }

    // Toutes les données sont dessinées immédiatement. Une animation de tracé
    // peut rester bloquée sur certains navigateurs mobiles et laisser le canvas
    // sans courbe ni valeur visible.
    const visibleN = N;

    // Temperature curve (orange gradient)
    const tempPts = hours.slice(0, visibleN).map((h, i) => ({
      x: colX(i),
      y: tempToY(typeof h.temp === "number" && Number.isFinite(h.temp) ? h.temp : 0),
    }));
    if (tempPts.length > 1) drawTemperatureCurveSegments(ctx, tempPts, hours.map((hour) => hour.temp), "hourly");
    // Points + température affichée à chaque heure
    tempPts.forEach((pt, i) => {
      const v = hours[i].temp;
      if (typeof v !== "number" || !Number.isFinite(v)) return;
      const sel = selectedHour === i || nowHour === i;
      const tone = getTemperatureTone(v, "hourly");
      const isExtreme = tone.status !== "normal";
      const r = sel ? 5 : 3.5;
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, r, 0, Math.PI * 2);
      ctx.fillStyle = isExtreme ? tone.fill : nowHour === i ? "#818cf8" : tone.fill;
      ctx.fill();
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.fillStyle = isExtreme ? tone.label : nowHour === i ? "#dbeafe" : tone.label;
      ctx.font = `700 ${sel ? 14 : 12}px system-ui`;
      ctx.textAlign = "center";
      const temperatureLabelY = getLabelAboveCurveY(pt.y, tempZoneTop, TEMPERATURE_LABEL_ABOVE_GAP);
      const temperatureLabel = `${v.toFixed(1)}°`;
      ctx.fillStyle = isExtreme ? tone.label : nowHour === i ? "#dbeafe" : tone.label;
      ctx.fillText(temperatureLabel, pt.x, temperatureLabelY);
    });

    // Wind readings by column (no wind curve).
    hours.slice(0, visibleN).forEach((h, i) => {
      const v = hours[i].windSpeed;
      if (v == null) return;
      const x = colX(i);
      const y = windZoneTop + 17;
      ctx.fillStyle = "#bbf7d0";
      ctx.font = "700 13px system-ui";
      ctx.textAlign = "center";
      const windLabel = `${Math.round(v)} km/h`;
      ctx.fillStyle = "#bbf7d0";
      ctx.fillText(windLabel, x, y);
      const dir = hours[i].windDirection;
      if (dir != null) {
        ctx.fillStyle = "rgba(187, 247, 208, 0.92)";
        ctx.font = "600 11px system-ui";
        ctx.fillText(degToCompass(dir), x, y + 14);
      }
    });

    // Precipitation bars
    const precipLabelBand = 16;
    const precipBarTop = precipZoneTop + precipLabelBand;
    const precipH = precipZoneBot - precipBarTop;
    hours.slice(0, visibleN).forEach((h, i) => {
      const p = h.precipitation;
      const x = colX(i);
      ctx.font = "700 12px system-ui";
      ctx.textAlign = "center";
      const drawUnavailablePrecipitation = () => {
        ctx.fillStyle = "rgba(148, 163, 184, 0.9)";
        ctx.fillText("—", x, precipZoneBot - 5);
      };
      if (p == null) {
        drawUnavailablePrecipitation();
        return;
      }
      if (!Number.isFinite(p)) {
        drawUnavailablePrecipitation();
        return;
      }
      ctx.fillStyle = p > 0 ? "#dbeafe" : "rgba(191,219,254,0.92)";
      const precipLabel = p.toFixed(1);
      const drawPrecipLabel = (labelY: number) => {
        ctx.fillStyle = p > 0 ? "#dbeafe" : "rgba(191,219,254,0.92)";
        ctx.fillText(precipLabel, x, labelY);
      };
      if (p <= 0) {
        drawPrecipLabel(precipZoneBot - 5);
        return;
      }
      const barH = Math.max(3, (p / maxPrecip) * precipH);
      const barTop = precipZoneBot - barH;
      drawPrecipLabel(barTop - 5);
      const barW = Math.min(COL_W * 0.5, 20);
      const g = ctx.createLinearGradient(0, precipZoneBot - barH, 0, precipZoneBot);
      g.addColorStop(0, "rgba(96, 165, 250, 0.9)");
      g.addColorStop(1, "rgba(37, 99, 235, 0.5)");
      ctx.fillStyle = g;
      ctx.fillRect(x - barW / 2, barTop, barW, barH);
    });

  }, [hours, N, selectedHour, scrollableW, TOTAL_H, CHART_H, ICON_ROW, COL_W, PAD_T, scaleBot, scaleTop, scaleRange, gridStep, maxPrecip, tempToY, colX, nowHour, dayBoundaryIndexes, tempZoneTop, tempCurveTop, tempZoneBot, windZoneTop, windZoneBot, precipZoneTop, precipZoneBot]);

  // Resize observer
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(e => setContainerWidth(e[0].contentRect.width));
    ro.observe(el);
    setContainerWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  // Scroll progress tracker
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onScroll = () => {
      const maxScroll = el.scrollWidth - el.clientWidth;
      if (maxScroll > 0) setScrollProgress(el.scrollLeft / maxScroll);
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, []);

  // Toujours démarrer la zone visible sur l’heure actuelle, y compris après un
  // rafraîchissement des prévisions ou un changement de lieu.
  useEffect(() => {
    const el = scrollRef.current;
    if (nowHour >= 0 && el) {
      const targetScroll = Math.max(0, nowHour * COL_W);
      requestAnimationFrame(() => el.scrollTo({ left: targetScroll, behavior: "auto" }));
    }
  }, [hours, nowHour, COL_W]);

  useEffect(() => { draw(); }, [draw]);

  // Click handler
  const onClick = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (N === 0) return;
    const rect = canvasRef.current!.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const col = Math.floor(x / COL_W);
    if (col >= 0 && col < N) setSelectedTarget(previous=>previous===hourlyDetailKey(hours[col])?null:hourlyDetailKey(hours[col]));
  }, [N, COL_W,hours]);

  if (hours.length === 0) return null;

  return (
    <section ref={containerRef} className="weather-chart-3d w-full rounded-[22px] border p-2 sm:p-3">
      {/* Header */}
      <div className="mb-3">
        <div className="flex items-center justify-between">
          <h2 className="flex items-center gap-2.5">
            <span className="weather-icon-bare flex h-8 w-8 items-center justify-center rounded-full border border-blue-300/55 bg-blue-500/25"><Clock className="h-4 w-4 text-blue-200" /></span>
            <span>
              <span className="block text-base font-bold text-white">Heure par heure</span>
              <span className="block text-[11px] font-normal text-slate-400">Prévisions détaillées</span>
            </span>
          </h2>
          <span className="rounded-full border border-slate-500/45 bg-slate-900/60 px-3 py-1.5 text-[11px] font-semibold text-slate-200">{N} h</span>
        </div>
        {locationName && (
          <p className="text-[11px] text-primary/70 flex items-center gap-1 mt-0.5">
            <MapPin className="h-3 w-3" /> {locationName}
          </p>
        )}
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px]">
          <span className="flex items-center gap-1.5 text-slate-300"><span className="w-2 h-4 rounded-full bg-orange-400 inline-block" /> Temp °C</span>
          <span className="flex items-center gap-1.5 text-green-400"><span className="w-4 h-0 border-t-2 border-dashed border-green-400 inline-block" /> Vent km/h</span>
          <span className="flex items-center gap-1.5 text-blue-400"><span className="w-3 h-3.5 bg-blue-500/80 inline-block rounded-sm" /> Pluie mm</span>
          {showProvenance && activeHourMeasurementLabel && (
            <span className="flex items-center gap-1.5 text-amber-200/90" title={activeHourMeasurementLabel}>
              <Thermometer className="h-3 w-3" />
              Point actuel : mesure des stations physiques Netatmo
            </span>
          )}
        </div>
      </div>

      {selectedHour !== null && selectedHour < hours.length && (
        <div ref={detailPanelRef} className="scroll-mt-3">
          <HourDetailOverlay conditionOverride={skyCondition(hours[selectedHour])} hour={hours[selectedHour]} trace={findHourlyDetailTrace(fusionDiagnostics,hours[selectedHour].validAt)} computedAt={computedAt} stale={stale} measurementLabel={selectedHour===nowHour?activeHourMeasurementLabel??null:null} onClose={() => setSelectedTarget(null)} />
        </div>
      )}

      {/* Chart area */}
      <div className="overflow-hidden rounded-[16px] border border-slate-700/70 bg-[#05070a]" style={{ height: TOTAL_H }}>
        <div className="flex h-full">
          <HourlyScaleLabels totalHeight={TOTAL_H} tempTop={tempZoneTop} tempBottom={tempZoneBot} windTop={windZoneTop} windBottom={windZoneBot} precipTop={precipZoneTop} precipBottom={precipZoneBot} scaleTop={scaleTop} scaleBot={scaleBot} windMax={windScaleTop} precipMax={precipScaleTop} />
        <div ref={scrollRef} className="min-w-0 flex-1 overflow-x-auto scrollbar-hide" style={{ scrollSnapType: "x mandatory", WebkitOverflowScrolling: "touch" }}>
          <div className="relative" style={{ width: scrollableW, height: TOTAL_H }}>
            {/* En-tête de chaque créneau : heure + grande icône météo */}
            <div className="absolute left-0 top-0 flex" style={{ height: 78, width: scrollableW }}>
              {hours.map((h, i) => {
                const cond = getConditionLabel(h.cloudCover, h.precipitation, skyCondition(h));
                const isCurrent = i === nowHour;
                const isNewDay = i > 0 && h.hour === "00:00";
                const displayLabel = displayLabels[i];
                return (
                  <button type="button" key={hourlyDetailKey(h)} onClick={()=>setSelectedTarget(previous=>previous===hourlyDetailKey(h)?null:hourlyDetailKey(h))} aria-label={`Détails de la prévision du ${formatHourlyDetailDate(h)}`} aria-expanded={selectedHour===i} className={`relative flex shrink-0 flex-col items-center justify-start rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300 ${isNewDay ? "pt-5" : "pt-2"}`} style={{ width: COL_W,height:78 }}>
                    {isNewDay && <span className="absolute left-1/2 top-0 -translate-x-1/2 whitespace-nowrap rounded-full border border-sky-300/55 bg-sky-500/20 px-1.5 py-0.5 text-[8px] font-bold text-sky-100">Demain</span>}
                    <span className={`text-[10px] font-semibold ${isCurrent ? "text-blue-100" : "text-slate-300"}`}>{displayLabel?.hourLabel ?? h.hour}</span>
                    {displayLabel?.offsetLabel && <span className="text-[8px] leading-none text-sky-200/80" title="Offset exact de l’instant UTC">{displayLabel.offsetLabel.replace("Europe/Paris ", "")}</span>}
                    <span className="mt-1.5"><WeatherIconSVG condition={cond} size={31} /></span>
                  </button>
                );
              })}
            </div>
            <canvas ref={canvasRef} style={{ width: scrollableW, height: TOTAL_H, cursor: "pointer", display: "block", backgroundColor: "#05070a" }} onClick={onClick} />
          </div>
        </div>
        </div>
      </div>

      {/* Progress bar (interactive) */}
      {N > VISIBLE_HOURS && (
          <div className="mt-2 mx-auto" style={{ width: "60%", maxWidth: 200 }}>
          <div
            ref={progressBarRef}
            className="h-[6px] rounded-full bg-slate-700/40 relative cursor-pointer group"
            onClick={(e) => {
              const bar = progressBarRef.current;
              const scroll = scrollRef.current;
              if (!bar || !scroll) return;
              const rect = bar.getBoundingClientRect();
              const clickX = e.clientX - rect.left;
              const ratio = Math.max(0, Math.min(1, clickX / rect.width));
              const maxScroll = scroll.scrollWidth - scroll.clientWidth;
              scroll.scrollTo({ left: ratio * maxScroll, behavior: 'smooth' });
            }}
          >
            <div
              className="absolute h-full rounded-full bg-gradient-to-r from-blue-600 to-blue-400 transition-transform duration-150 group-hover:from-blue-500 group-hover:to-blue-300"
              style={{
                width: `${(VISIBLE_HOURS / N) * 100}%`,
                transform: `translateX(${scrollProgress * ((N / VISIBLE_HOURS) - 1) * 100}%)`
              }}
            />
          </div>
          <p className="text-center text-[9px] text-slate-500 mt-1">Cliquez ou glissez pour naviguer</p>
        </div>
      )}

    </section>
  );
}

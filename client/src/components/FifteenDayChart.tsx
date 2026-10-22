import { useRef, useState, useEffect, useCallback, useMemo } from "react";
import { TrendingUp, X, Thermometer, Wind, Droplets, Sun, Cloud, Sunrise, Sunset, Navigation, Eye, MapPin } from "lucide-react";
import { MeteoIcon, getIconNameFromCondition } from "@/components/MeteoIcon";
import {DailyFusionDetails} from '@/components/weather/DailyFusionDetails';
import type {DailyFusionDetails as DailyTrace} from '@shared/dashboardDailyFusion';
import type {DailyOfficialFusionDisplay} from '@shared/dailyForecast';
import {dailyDisplayDate,dailyDetailDate,selectedDailyIndex} from '@/lib/dailyDetail';
import {formatHourlyDetailNumber as number} from '@/lib/hourlyDetail';
import { conditionFromWeatherValues } from "@shared/weatherConditionLabels";
import type { PrecipitationModelConsensus } from "@shared/precipitationConsensus";
import type { DailyModelAgreement } from "@shared/modelAgreement";
import { getChartTemperatureScale } from "@/lib/chartTemperatureScale";
import { getLabelAboveCurveY, getLabelBelowCurveY, TEMPERATURE_LABEL_ABOVE_GAP, TEMPERATURE_LABEL_BELOW_GAP, TEMPERATURE_WIND_CLEARANCE } from "@/lib/chartLabelLanes";
import { drawTemperatureCurveSegments, getTemperatureTone } from "@/lib/chartTemperatureTone";

// ─── Types ────────────────────────────────────────────────────────────────────
export interface DayData {
  date: string;
  weatherCode?: number | null;
  fusionDetails?: DailyTrace;
  officialFusion?: Pick<DailyOfficialFusionDisplay,'issuedAt'|'referenceAt'|'calibrationStatus'|'availabilityStatus'>;
  tempMax: number | null;
  tempMin: number | null;
  precipitation: number | null;
  precipitationConsensus?: PrecipitationModelConsensus;
  windSpeed: number | null;
  windGust: number | null;
  windDirection: number | null;
  humidity: number | null;
  cloudCover: number | null;
  condition: string | null;
  modelAgreement?: DailyModelAgreement;
  uvIndex: number | null;
  feelsLikeMax: number | null;
  feelsLikeMin: number | null;
  sunrise: string | null;
  sunset: string | null;
}

interface Props {
  days: DayData[];
  locationName?: string;
  stale?:boolean;
  detailRequest?:{date:string;sequence:number}|null;
  onRequestedDetailClose?:()=>void;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function formatDate(dateStr: string) {return dailyDisplayDate(dateStr);}

function getConditionLabel(cloudCover: number | null, precip: number | null, condition: string | null): string {
  if (condition && /(orage|brouillard|neige|pluie|averse)/i.test(condition)) return condition;
  if (cloudCover != null || precip != null) return conditionFromWeatherValues(precip, cloudCover);
  return condition ?? "Conditions indisponibles";
}

function getConditionBg(cloudCover: number | null, precip: number | null, condition: string | null): string {
  const cond = (condition ?? "").toLowerCase();
  if (cond.includes("orage")) return "rgba(148, 163, 184, 0.045)";
  if ((precip != null && precip > 3) || cond.includes("pluie") || cond.includes("averse")) return "rgba(148, 163, 184, 0.032)";
  if ((cloudCover != null && cloudCover > 75) || cond.includes("couvert")) return "rgba(148, 163, 184, 0.04)";
  if ((cloudCover != null && cloudCover < 30) || cond.includes("ensoleillé")) return "rgba(255, 255, 255, 0.025)";
  return "rgba(255, 255, 255, 0.014)";
}

function degToCompass(deg: number | null): string {
  if (deg == null) return "—";
  const dirs = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSO", "SO", "OSO", "O", "ONO", "NO", "NNO"];
  return dirs[Math.round(deg / 22.5) % 16];
}

function uvLabel(uv: number | null): { text: string; color: string } {
  if (uv == null) return { text: "—", color: "text-muted-foreground" };
  if (uv <= 2) return { text: "Faible", color: "text-green-400" };
  if (uv <= 5) return { text: "Modéré", color: "text-yellow-400" };
  if (uv <= 7) return { text: "Élevé", color: "text-orange-400" };
  if (uv <= 10) return { text: "Très élevé", color: "text-red-400" };
  return { text: "Extrême", color: "text-purple-400" };
}

// ─── Weather Icon (MeteoAI pack) ─────────────────────────────────────────────────────────
// Presentation « full » : les graphiques du Dashboard utilisent les mêmes
// icônes météo 3D illustrées que l'en-tête et la page Prévisions (PNG du pack
// MeteoAI, partagés et mis en cache par le navigateur).
function WeatherIconSVG({ condition, size = 22 }: { condition: string; size?: number }) {
  return <MeteoIcon name={getIconNameFromCondition(condition)} size={size} />;
}

function ForecastScaleLabels({
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
    <aside aria-label="Échelles du graphique de prévisions" className="relative z-10 w-10 shrink-0 border-r border-slate-700/70 bg-[#06080d] text-right text-[8px] font-medium text-slate-500" style={{ height: totalHeight }}>
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

// ─── Detail Card ──────────────────────────────────────────────────────────────
function DetailCard({ icon, label, value }: { icon: React.ReactNode; label: string; value: React.ReactNode }) {
  return (
    <div className="bg-white/5 rounded-lg p-2.5 border border-white/5">
      <div className="flex items-center gap-1.5 mb-1">
        {icon}
        <span className="text-[10px] uppercase tracking-wider text-slate-500">{label}</span>
      </div>
      <p className="text-sm font-bold text-white leading-tight">{value}</p>
    </div>
  );
}

// ─── Overlay Detail Panel ─────────────────────────────────────────────────────
function DayDetailOverlay({ day, onClose,stale }: { day: DayData; onClose: () => void;stale:boolean }) {
  const dateLabel=dailyDetailDate(day.date);
  const cond = getConditionLabel(day.cloudCover, day.precipitation, day.condition);
  const uv = uvLabel(day.uvIndex);

  return (
    <section className="mb-3 rounded-2xl border border-blue-400/25 bg-[#0a0e14] p-4 shadow-[0_12px_28px_rgba(15,23,42,0.35)] animate-in slide-in-from-top-2 duration-200 sm:p-5" role="region" aria-labelledby="day-detail-title">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <span className="flex h-14 w-14 items-center justify-center rounded-2xl border border-blue-400/25 bg-blue-500/10">
              <WeatherIconSVG condition={cond} size={44} />
            </span>
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-blue-300">Prévision détaillée</p>
              <h3 id="day-detail-title" className="font-semibold text-white text-base">{dateLabel}</h3>
              <p className="text-xs text-slate-400">{cond}</p>
            </div>
          </div>
          <button onClick={onClose} aria-label="Fermer les détails de la prévision" className="inline-flex min-h-11 items-center gap-1.5 rounded-xl border border-slate-600/60 bg-slate-800/70 px-3 text-xs font-semibold text-slate-200 transition-colors hover:bg-slate-700 active:scale-95">
            <X className="h-5 w-5" />
            <span>Fermer</span>
          </button>
        </div>
        <p className="mb-3 text-xs text-slate-300">Prévision quotidienne Open-Meteo · {stale?'dernière prévision en cache':'snapshot chargé'}{day.officialFusion?.referenceAt&&Number.isFinite(Date.parse(day.officialFusion.referenceAt))?` · calcul ${new Intl.DateTimeFormat('fr-FR',{timeZone:'Europe/Paris',day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'}).format(new Date(day.officialFusion.referenceAt))} (Paris)`:''}.</p>
        <div className="mb-4 grid grid-cols-3 overflow-hidden rounded-xl border border-white/8 bg-white/[0.03]">
          <div className="border-r border-white/8 px-3 py-2.5 text-center"><p className="text-[9px] uppercase tracking-wide text-slate-500">Max.</p><p className="mt-0.5 text-base font-bold text-orange-300">{day.tempMax != null ? `${number(day.tempMax)}°` : "—"}</p></div>
          <div className="border-r border-white/8 px-3 py-2.5 text-center"><p className="text-[9px] uppercase tracking-wide text-slate-500">Min.</p><p className="mt-0.5 text-base font-bold text-blue-300">{day.tempMin != null ? `${number(day.tempMin)}°` : "—"}</p></div>
          <div className="px-3 py-2.5 text-center"><p className="text-[9px] uppercase tracking-wide text-slate-500">Estimation pluie</p><p className="mt-0.5 text-base font-bold text-sky-300">{day.precipitation == null ? "—" : `${number(day.precipitation,2)} mm`}</p></div>
        </div>
        <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">Paramètres météo</p>
        <p className="mb-2 text-[9px] leading-relaxed text-slate-500">Ressenti, direction dominante et UV · référence Open-Meteo Best Match, non contributrice à la fusion officielle.</p>
        <div className="grid grid-cols-3 gap-1.5 sm:gap-2">
          <DetailCard icon={<Thermometer className="h-3.5 w-3.5 text-orange-400" />} label="Température" value={<>{number(day.tempMax)}° <span className="text-blue-400 text-xs">/ {number(day.tempMin)}°</span></>} />
          <DetailCard icon={<Thermometer className="h-3.5 w-3.5 text-pink-400" />} label="Ressenti · Best Match" value={<>{number(day.feelsLikeMax)}° <span className="text-blue-400 text-xs">/ {number(day.feelsLikeMin)}°</span></>} />
          <DetailCard icon={<MeteoIcon name="wind_param" size={17} className="shrink-0" />} label="Vent maximal" value={<>{number(day.windSpeed)} <span className="text-[10px] text-slate-400">km/h</span></>} />
          <DetailCard icon={<Wind className="h-3.5 w-3.5 text-orange-400" />} label="Rafales" value={<>{day.windGust != null ? Math.round(day.windGust) : "—"} <span className="text-[10px] text-slate-400">km/h</span></>} />
          <DetailCard icon={<Navigation className="h-3.5 w-3.5 text-sky-400" style={{ transform: `rotate(${(day.windDirection ?? 0) + 180}deg)` }} />} label="Direction · Best Match" value={<>{degToCompass(day.windDirection)} <span className="text-[10px] text-slate-500">{day.windDirection != null ? `${Math.round(day.windDirection)}°` : ""}</span></>} />
          <DetailCard icon={<Droplets className="h-3.5 w-3.5 text-blue-400" />} label="Estimation pluie (consensus)" value={<span className="text-blue-400">{day.precipitation == null ? "—" : `${number(day.precipitation,2)} mm`}</span>} />
          <DetailCard icon={<MeteoIcon name="humidity" size={17} className="shrink-0" />} label="Humidité" value={<span className="text-cyan-400">{day.humidity != null ? `${Math.round(day.humidity)}%` : "—"}</span>} />
          <DetailCard icon={<Sun className="h-3.5 w-3.5 text-yellow-400" />} label="Indice UV · Best Match" value={<><span className={uv.color}>{day.uvIndex != null ? Math.round(day.uvIndex) : "—"}</span> <span className={`text-[10px] ${uv.color}`}>{uv.text}</span></>} />
          <DetailCard icon={<Cloud className="h-3.5 w-3.5 text-slate-400" />} label="Nébulosité" value={<>{day.cloudCover != null ? `${Math.round(day.cloudCover)}%` : "—"}</>} />
          <DetailCard icon={<Sunrise className="h-3.5 w-3.5 text-amber-400" />} label="Lever" value={<span className="text-amber-400">{day.sunrise ?? "—"}</span>} />
          <DetailCard icon={<Sunset className="h-3.5 w-3.5 text-orange-500" />} label="Coucher" value={<span className="text-orange-500">{day.sunset ?? "—"}</span>} />
          <DetailCard icon={<Cloud className="h-3.5 w-3.5 text-slate-300"/>} label="Code météo WMO" value={day.weatherCode??'—'}/>
        </div>
        <div className="mt-3 rounded-xl border border-sky-300/20 p-3 text-xs text-slate-300">
          <p className="font-semibold text-sky-100">Accord des modèles sur la pluie</p>
          <p className="mt-1">{day.precipitationConsensus?.frequencyPercent==null?'Donnée indisponible.':`${number(day.precipitationConsensus.frequencyPercent)} % · ${day.precipitationConsensus.rainModelCount}/${day.precipitationConsensus.availableModelCount} modèles disponibles prévoient au moins ${number(day.precipitationConsensus.thresholdMm)} mm.`} Ce n’est pas une probabilité de pluie calibrée.</p>
          <p className="mt-1 text-slate-400">La dispersion et la stabilité entre runs ne sont pas calculées sans horodatages de runs comparables. Aucune fiabilité historique n’est déduite du nombre de modèles.</p>
        </div>
        <DailyFusionDetails trace={day.fusionDetails}/>
    </section>
  );
}

// ─── MAIN COMPONENT ───────────────────────────────────────────────────────────
export default function FifteenDayChart({ days, locationName,stale=false,detailRequest=null,onRequestedDetailClose }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const detailPanelRef = useRef<HTMLDivElement>(null);
  const [selectedDate,setSelectedDate]=useState<string|null>(null);
  const displayDays=useMemo(()=>days.slice(0,15),[days]);
  const selectedDay=selectedDailyIndex(displayDays,selectedDate);
  const lastDetailRequest=useRef<number|null>(null);
  const focusedDetailRequest=useRef<number|null>(null);
  const requestOwnsSelection=useRef(false);
  const [containerWidth, setContainerWidth] = useState(0);
  const [animated, setAnimated] = useState(false);
  const [animProgress, setAnimProgress] = useState(0);
  const [scrollProgress, setScrollProgress] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const progressBarRef = useRef<HTMLDivElement>(null);

  useEffect(()=>{
    if(!detailRequest||lastDetailRequest.current===detailRequest.sequence)return;
    lastDetailRequest.current=detailRequest.sequence;
    // Même sélection stricte que le graphique : aucun jour voisin en cas d’absence.
    const index=selectedDailyIndex(displayDays,detailRequest.date);
    requestOwnsSelection.current=index!==null;
    setSelectedDate(index===null?null:displayDays[index].date);
  },[detailRequest,displayDays]);

  useEffect(() => {
    if (selectedDay === null) return;
    const reduced=window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    detailPanelRef.current?.scrollIntoView({ behavior: reduced?'auto':'smooth', block: "start" });
    if(detailRequest&&selectedDate===detailRequest.date&&focusedDetailRequest.current!==detailRequest.sequence){
      focusedDetailRequest.current=detailRequest.sequence;
      detailPanelRef.current?.focus({preventScroll:true});
    }
  }, [selectedDay,selectedDate,detailRequest]);

  const closeDetail=()=>{
    setSelectedDate(null);
    if(requestOwnsSelection.current)onRequestedDetailClose?.();
    requestOwnsSelection.current=false;
  };

  // The chart deliberately stays on one consistent 15-day horizon.

  const N = displayDays.length;

  // ── Layout constants ────────────────────────────────────────────────────────
  const COL_W = 76;          // width per day column
  const CHART_H = 310;       // main chart height (temp + wind + precip combined)
  const ICON_ROW = 0;        // weather header is positioned inside the chart columns
  const LABEL_ROW = 0;       // weather header is positioned inside the chart columns
  const PAD_T = 82;
  const TOTAL_H = CHART_H + ICON_ROW + LABEL_ROW;
  const scrollableW = COL_W * N;

  // ── Scales ──────────────────────────────────────────────────────────────────
  const { scaleTop, scaleBot, scaleRange, gridStep } = getChartTemperatureScale(
    displayDays.flatMap(day => [day.tempMin, day.tempMax]),
    3,
  );

  const maxPrecip = Math.max(...displayDays.map(d => d.precipitation ?? 0), 2);
  const maxWind = Math.max(...displayDays.map(d => d.windSpeed ?? 0), 5);
  const chartAlerts = useMemo(() => {
    const alerts: Array<{ id: string; label: string; className: string }> = [];
    if (displayDays.some((day) => (day.tempMax ?? 0) >= 33)) {
      alerts.push({ id: "heat", label: "Chaleur prévue · maximum ≥ 33°C", className: "border-orange-400/35 bg-orange-400/10 text-orange-200" });
    }
    if (displayDays.some((day) => (day.condition ?? "").toLowerCase().includes("orage"))) {
      alerts.push({ id: "storm", label: "Risque d’orage", className: "border-violet-400/35 bg-violet-400/10 text-violet-200" });
    }
    return alerts;
  }, [displayDays]);
  const windScaleTop = Math.ceil(maxWind / 5) * 5;
  const precipScaleTop = Math.ceil(maxPrecip * 10) / 10;
  // Zone allocation: temp 55%, wind 20%, precip 20%, gaps 5%
  const tempZoneTop = PAD_T;
  // Les maxima restent dans une bande dédiée au-dessus du tracé et de ses points.
  const tempCurveTop = tempZoneTop + 34;
  const tempZoneBot = PAD_T + (CHART_H - PAD_T) * 0.55;
  const windZoneTop = tempZoneBot + 4;
  const windZoneBot = windZoneTop + (CHART_H - PAD_T) * 0.20;
  const precipZoneTop = windZoneBot + 2;
  const precipZoneBot = CHART_H - 2;

  const tempToY = useCallback((t: number) => tempCurveTop + (1 - (t - scaleBot) / scaleRange) * (tempZoneBot - tempCurveTop), [scaleBot, scaleRange, tempCurveTop, tempZoneBot]);
  const colX = useCallback((i: number) => i * COL_W + COL_W / 2, []);

  // ── Draw scrollable canvas ──────────────────────────────────────────────────
  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || N === 0) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = scrollableW * dpr;
    canvas.height = TOTAL_H * dpr;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, scrollableW, TOTAL_H);

    // ── Per-day background (weather-adaptive) ────────────────────────────────
    displayDays.forEach((d, i) => {
      const x = i * COL_W;
      ctx.fillStyle = getConditionBg(d.cloudCover, d.precipitation, d.condition);
      ctx.fillRect(x, 0, COL_W, CHART_H);
    });

    // ── Vertical separators ──────────────────────────────────────────────────
    for (let i = 1; i < N; i++) {
      const x = i * COL_W;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, CHART_H);
      ctx.strokeStyle = "rgba(148, 163, 184, 0.08)";
      ctx.lineWidth = 1;
      ctx.stroke();
    }

    // ── Lignes de température alignées à l’échelle de 5 °C ──────────────────
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

    // ── Selected day highlight ───────────────────────────────────────────────
    if (selectedDay !== null && selectedDay < N) {
      const x = selectedDay * COL_W;
      // Glow
      const g = ctx.createLinearGradient(x, 0, x + COL_W, 0);
      g.addColorStop(0, "rgba(99, 102, 241, 0)");
      g.addColorStop(0.5, "rgba(99, 102, 241, 0.08)");
      g.addColorStop(1, "rgba(99, 102, 241, 0)");
      ctx.fillStyle = g;
      ctx.fillRect(x, 0, COL_W, TOTAL_H);
      // Borders
      ctx.strokeStyle = "rgba(129, 140, 248, 0.25)";
      ctx.lineWidth = 1.5;
      ctx.strokeRect(x + 0.5, 0.5, COL_W - 1, CHART_H - 1);
    }

    // ── Animation progress ───────────────────────────────────────────────────
    const progress = animated ? 1 : animProgress;
    const visibleN = Math.max(1, Math.ceil(N * progress));

    // ── Max curve (orange) ───────────────────────────────────────────────────
    const maxPts = displayDays.slice(0, visibleN).map((d, i) => ({ x: colX(i), y: tempToY(d.tempMax ?? 0) }));
    if (maxPts.length > 1) drawTemperatureCurveSegments(ctx, maxPts, displayDays.map((day) => day.tempMax), "maximum");
    // Points + values
    maxPts.forEach((pt, i) => {
      const v = displayDays[i].tempMax;
      if (v == null) return;
      const sel = selectedDay === i;
      const tone = getTemperatureTone(v, "maximum");
      const r = sel ? 7 : 5;
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, r, 0, Math.PI * 2);
      ctx.fillStyle = tone.fill;
      ctx.fill();
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = 2;
      ctx.stroke();
      // Value
      ctx.fillStyle = tone.label;
      ctx.font = `bold ${sel ? 14 : 13}px system-ui`;
      ctx.textAlign = "center";
      const maxLabelY = getLabelAboveCurveY(pt.y, tempZoneTop, TEMPERATURE_LABEL_ABOVE_GAP);
      ctx.strokeStyle = "rgba(5, 7, 10, 0.9)";
      ctx.lineWidth = 3;
      ctx.strokeText(`${v.toFixed(1)}`, pt.x, maxLabelY);
      ctx.fillText(`${v.toFixed(1)}`, pt.x, maxLabelY);
    });

    // ── Min curve (blue) ─────────────────────────────────────────────────────
    const minPts = displayDays.slice(0, visibleN).map((d, i) => ({ x: colX(i), y: tempToY(d.tempMin ?? 0) }));
    if (minPts.length > 1) drawTemperatureCurveSegments(ctx, minPts, displayDays.map((day) => day.tempMin), "minimum");
    minPts.forEach((pt, i) => {
      const v = displayDays[i].tempMin;
      if (v == null) return;
      const sel = selectedDay === i;
      const tone = getTemperatureTone(v, "minimum");
      const r = sel ? 6 : 4;
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, r, 0, Math.PI * 2);
      ctx.fillStyle = tone.fill;
      ctx.fill();
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.fillStyle = tone.label;
      ctx.font = `bold ${sel ? 13 : 12}px system-ui`;
      ctx.textAlign = "center";
      const minLabelY = getLabelBelowCurveY(pt.y, tempZoneTop, windZoneTop, TEMPERATURE_LABEL_BELOW_GAP, TEMPERATURE_WIND_CLEARANCE);
      ctx.strokeStyle = "rgba(5, 7, 10, 0.9)";
      ctx.lineWidth = 3;
      ctx.strokeText(`${v.toFixed(1)}`, pt.x, minLabelY);
      ctx.fillText(`${v.toFixed(1)}`, pt.x, minLabelY);
    });

    // ── Wind readings by column (no wind curve) ─────────────────────────────
    displayDays.slice(0, visibleN).forEach((d, i) => {
      const v = displayDays[i].windSpeed;
      const dir = displayDays[i].windDirection;
      if (v == null) return;
      const x = colX(i);
      const y = windZoneTop + 17;
      ctx.fillStyle = "#4ade80";
      ctx.font = "bold 12px system-ui";
      ctx.textAlign = "center";
      ctx.fillText(`${Math.round(v)} km/h`, x, y);
      if (dir != null) {
        ctx.fillStyle = "rgba(74, 222, 128, 0.78)";
        ctx.font = "10px system-ui";
        ctx.fillText(degToCompass(dir), x, y + 14);
      }
    });

    // ── Precipitation bars ───────────────────────────────────────────────────
    const precipLabelBand = 18;
    const precipBarTop = precipZoneTop + precipLabelBand;
    const precipH = precipZoneBot - precipBarTop;
    displayDays.slice(0, visibleN).forEach((d, i) => {
      const p = d.precipitation;
      if (p == null) return;
      const x = colX(i);
      ctx.fillStyle = p > 0 ? "#93c5fd" : "rgba(147,197,253,0.66)";
      ctx.font = "bold 11px system-ui";
      ctx.textAlign = "center";
      if (p <= 0) {
        ctx.fillText(p.toFixed(1), x, precipZoneBot - 5);
        return;
      }
      const barH = Math.max(4, (p / maxPrecip) * precipH);
      const barTop = precipZoneBot - barH;
      ctx.fillText(p.toFixed(1), x, barTop - 5);
      const barW = Math.min(COL_W * 0.45, 24);
      const g = ctx.createLinearGradient(0, precipZoneBot - barH, 0, precipZoneBot);
      g.addColorStop(0, "rgba(96, 165, 250, 0.9)");
      g.addColorStop(1, "rgba(37, 99, 235, 0.5)");
      ctx.fillStyle = g;
      ctx.fillRect(x - barW / 2, barTop, barW, barH);
    });

    // ── Date labels + icons ──────────────────────────────────────────────────
    displayDays.forEach((d, i) => {
      const { line1, line2 } = formatDate(d.date);
      const x = colX(i);
      const today = d.date === new Date().toISOString().slice(0, 10);
      const sel = selectedDay === i;
      const lblY = CHART_H + ICON_ROW;
      ctx.fillStyle = today ? "#818cf8" : sel ? "#e2e8f0" : "rgba(148, 163, 184, 0.8)";
      ctx.font = `${today || sel ? "bold " : ""}11px system-ui`;
      ctx.textAlign = "center";
      ctx.fillText(line1, x, lblY + 12);
      ctx.font = "9px system-ui";
      ctx.fillStyle = today ? "#a5b4fc" : "rgba(107, 114, 128, 0.7)";
      ctx.fillText(line2, x, lblY + 24);
    });
  }, [displayDays, N, selectedDay, animated, animProgress, scrollableW, TOTAL_H, CHART_H, ICON_ROW, COL_W, PAD_T, scaleBot, scaleTop, scaleRange, gridStep, maxPrecip, tempToY, colX, tempZoneTop, tempCurveTop, tempZoneBot, windZoneTop, windZoneBot, precipZoneTop, precipZoneBot]);

  // ── Resize observer ─────────────────────────────────────────────────────────
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(e => setContainerWidth(e[0].contentRect.width));
    ro.observe(el);
    setContainerWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  // ── Animation trigger (progressive draw) ────────────────────────────────────
  useEffect(() => {
    if (N > 0 && !animated) {
      let start: number | null = null;
      const duration = 1200; // ms
      const step = (ts: number) => {
        if (!start) start = ts;
        const elapsed = ts - start;
        const p = Math.min(elapsed / duration, 1);
        // Ease-out cubic
        const eased = 1 - Math.pow(1 - p, 3);
        setAnimProgress(eased);
        if (p < 1) {
          requestAnimationFrame(step);
        } else {
          setAnimated(true);
        }
      };
      const t = setTimeout(() => requestAnimationFrame(step), 150);
      return () => clearTimeout(t);
    }
  }, [N, animated]);

  // ── Scroll progress tracker ─────────────────────────────────────────────────
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

  useEffect(() => { draw(); }, [draw]);

  // ── Click handler ───────────────────────────────────────────────────────────
  const onClick = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (N === 0) return;
    const rect = canvasRef.current!.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const col = Math.floor(x / COL_W);
    if (col >= 0 && col < N) {
      requestOwnsSelection.current=false;
      setSelectedDate(previous=>previous===displayDays[col].date?null:displayDays[col].date);
    }
  }, [N,displayDays]);

  if (displayDays.length === 0) return null;

  return (
    <section ref={containerRef} className="weather-chart-3d w-full rounded-[22px] border p-2 sm:p-3">
      {/* Header */}
      <div className="mb-3">
        <div className="flex items-center">
          <h2 className="flex items-center gap-2.5">
            <span className="weather-icon-bare flex h-8 w-8 items-center justify-center rounded-full border border-blue-300/55 bg-blue-500/25"><TrendingUp className="h-4 w-4 text-blue-200" /></span>
            <span>
              <span className="block text-base font-bold text-white">Températures & Météo</span>
              <span className="block text-[11px] font-normal text-slate-400">Prévisions détaillées</span>
            </span>
          </h2>
        </div>
        {locationName && (
          <p className="text-[11px] text-primary/70 flex items-center gap-1 mt-0.5">
            <MapPin className="h-3 w-3" /> {locationName}
          </p>
        )}
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px]">
          <span className="flex items-center gap-1.5 text-slate-300"><span className="w-2 h-4 rounded-full bg-orange-400 inline-block" /> Max °C</span>
          <span className="flex items-center gap-1.5 text-slate-300"><span className="w-2 h-4 rounded-full bg-blue-400 inline-block" /> Min °C</span>
          <span className="flex items-center gap-1.5 text-green-400"><span className="w-2.5 h-2.5 rounded-full bg-green-400 inline-block" /> Vent km/h</span>
          <span className="flex items-center gap-1.5 text-blue-400"><span className="w-3 h-3.5 bg-blue-500/80 inline-block rounded-sm" /> Pluie mm</span>
        </div>
      </div>

      {selectedDay !== null && selectedDay < displayDays.length && (
        <div ref={detailPanelRef} tabIndex={-1} className="scroll-mt-20" onKeyDown={event=>{if(event.key==='Escape'){event.stopPropagation();closeDetail();}}}>
          <DayDetailOverlay key={displayDays[selectedDay].date} day={displayDays[selectedDay]} stale={stale} onClose={closeDetail} />
        </div>
      )}

      {chartAlerts.length > 0 && (
        <aside aria-label="Alertes météo des prévisions" className="mb-2 flex flex-wrap items-center gap-1.5 rounded-xl border border-slate-700/70 bg-slate-950/50 px-2.5 py-2">
          <span className="text-[9px] font-semibold uppercase tracking-[0.12em] text-slate-500">Alertes météo</span>
          {chartAlerts.map((alert) => <span key={alert.id} className={`rounded-lg border px-2 py-1 text-[10px] font-semibold ${alert.className}`}>{alert.label}</span>)}
        </aside>
      )}

      {/* ── Full-width scrollable chart ───────────────────────────────────── */}
      <div className="overflow-hidden rounded-[16px] border border-slate-700/70 bg-[#05070a]" style={{ height: TOTAL_H }}>
        <div className="flex h-full">
          <ForecastScaleLabels totalHeight={TOTAL_H} tempTop={tempZoneTop} tempBottom={tempZoneBot} windTop={windZoneTop} windBottom={windZoneBot} precipTop={precipZoneTop} precipBottom={precipZoneBot} scaleTop={scaleTop} scaleBot={scaleBot} windMax={windScaleTop} precipMax={precipScaleTop} />
        <div ref={scrollRef} className="min-w-0 flex-1 overflow-x-auto scrollbar-hide" style={{ scrollSnapType: "x mandatory", WebkitOverflowScrolling: "touch" }}>
          <div className="relative" style={{ width: scrollableW, height: TOTAL_H }}>
            {/* En-tête de chaque journée : jour + grande icône météo */}
            <div className="absolute left-0 top-0 flex" style={{ height: 78, width: scrollableW }}>
              {displayDays.map((d, i) => {
                const cond = getConditionLabel(d.cloudCover, d.precipitation, d.condition);
                const date = formatDate(d.date);
                const isSelected = i === selectedDay;
                return (
                  <button type="button" key={d.date} aria-label={`Détails de la prévision du ${dailyDetailDate(d.date)}`} aria-expanded={isSelected} onClick={()=>{requestOwnsSelection.current=false;setSelectedDate(previous=>previous===d.date?null:d.date);}} className={`flex shrink-0 flex-col items-center justify-start rounded-lg pt-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300 ${isSelected ? "rounded-b-xl border-2 border-blue-300/65 bg-blue-500/20" : ""}`} style={{ width: COL_W,height:78 }}>
                    <span className={`text-[10px] font-semibold ${isSelected ? "text-blue-100" : "text-slate-200"}`}>{date.line1}</span>
                    <span className="text-[9px] text-slate-500">{date.line2}</span>
                    <span className="mt-1"><WeatherIconSVG condition={cond} size={31} /></span>
                  </button>
                );
              })}
            </div>
            <canvas ref={canvasRef} style={{ width: scrollableW, height: TOTAL_H, cursor: "pointer", display: "block" }} onClick={onClick} />
          </div>
        </div>
        </div>
      </div>

      {/* ── Scroll progress bar ────────────────────────────────────────── */}
      {N > 7 && (
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
                width: `${(7 / N) * 100}%`,
                transform: `translateX(${scrollProgress * ((N / 7) - 1) * 100}%)`
              }}
            />
          </div>
          <p className="text-center text-[9px] text-slate-500 mt-1">Cliquez ou glissez pour naviguer</p>
        </div>
      )}

    </section>
  );
}

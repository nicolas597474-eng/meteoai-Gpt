import {useVisibleClock} from '@/hooks/useVisibleClock';
import { stationLatestReading } from "@shared/stationLatestReading";
import { useQuery } from '@tanstack/react-query';
import { collectLiveModelComparison } from '@/lib/liveModelQuery';
import { liveComparisonQueryKey,MODEL_COMPARISON_REFRESH_MS } from '@/lib/weatherQueryCache';
import { stationModelReferences, stationSummaryCoverage } from '@shared/stationModelReferences';
import { stationChartGeometry } from "@shared/stationComparisonChart";
import { currentStationPresentation,usedLocalStations } from "@shared/currentStationPresentation";
import { Skeleton } from "@/components/ui/skeleton";
import React, { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { resolveSourceSelection, sourceSelectionKey, type SourceSelectionKey } from "@shared/stationSourceDetails";
import { stationComparisonSummary, stationPerformanceVariable, stationOverviewPlaceholder } from "@shared/stationEvidencePresentation";
import { MeteoIcon } from "@/components/MeteoIcon";
import { trpc } from "@/lib/trpc";
import { useLocation } from "@/contexts/LocationContext";
import { usePageWeatherSky } from "@/hooks/usePageWeatherSky";
import { filterAndSortStationSources, type SourceDistanceOrder, type SourceKindFilter, type SourceStatusFilter } from "@/lib/stationSourceFilters";
import { getStationDisplayStatus } from "@/lib/stationCandidateStatus";
import { SourceDetailsDialog } from "@/pages/SourceDetailsDialog";
import { BackToTopButton } from "@/components/BackToTopButton";
import { MeteoSurface } from "@/components/weather/MeteoSurface";
import { CollectionObservabilitySections } from "@/components/weather/CollectionObservabilitySections";
import { WeatherStatusBadge, type WeatherStatusBadgeTone } from "@/components/weather/WeatherStatusBadge";
import { ChevronDown, Clock3, RefreshCw } from "lucide-react";

/**
 * La carte Leaflet (50 ko gzip de moteur + 6 ko de CSS) n'est plus chargée avec
 * la page : elle arrive après le premier rendu et affiche son propre repère de
 * chargement. La page, ses titres et ses chiffres s'affichent donc sans
 * attendre ni télécharger le moteur cartographique.
 */
const StationMap = lazy(() =>
  import("@/components/StationMap").then(({ StationMap: Component }) => ({ default: Component })),
);

function StationMapFallback() {
  return (
    <div
      aria-hidden="true"
      className="h-72 animate-pulse rounded-xl border border-slate-800 bg-[radial-gradient(circle_at_center,rgba(37,99,235,0.14),transparent_34%)] sm:h-80"
    />
  );
}

type ComparisonPoint = {
  hour?: number;
  label?: string;
  stationTemperature: number | null;
  stationSampleCount: number;
  officialTemperature: number | null;
};


// Contract exposed by station snapshot observability. Forecast scheduling is a
// separate flow and must not be presented as the physical-stations cadence.
const STATION_SNAPSHOT_CADENCE_LABEL = "Collecteur cloud · passage horaire";

function formatAge(minutes: number | null) {
  if (minutes === null) return "Aucun relevé";
  if (minutes < 2) return "À l’instant";
  if (minutes < 60) return `Il y a ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `Il y a ${hours} h ${rest}` : `Il y a ${hours} h`;
}

function value(value: number | null | undefined, unit = "") {
  return value === null || value === undefined ? "—" : `${value.toFixed(1)}${unit}`;
}


const PERFORMANCE_VARIABLE_LABELS: Record<string, string> = {
  temperature: "Température",
  humidity: "Humidité",
  pressure: "Pression",
  windSpeed: "Vent",
  windGust: "Rafales",
  windDirection: "Direction du vent",
  precipitation: "Précipitations",
};

const PERFORMANCE_SOURCE_NAMES: Record<string, string> = {
  meteofrance: "Météo-France",
  netatmo: "Netatmo",
};

const PERFORMANCE_REASON_LABELS: Record<string, string> = {
  station_not_eligible: "station non éligible aux comparaisons physiques",
  outside_reference_radius: "station hors du rayon choisi",
  no_station_observations: "aucun relevé exploitable",
  distinct_reference_networks_insufficient: "moins de deux réseaux physiques distincts sur des sites non co-localisés",
  comparisons_insufficient: "moins de 30 comparaisons horaires valides",
  distinct_days_insufficient: "moins de 7 jours distincts couverts",
  precipitation_method_not_defined: "aucun minimum d’échantillon défendable n’est documenté pour mesurer occurrence ou quantité",
  source_prior_insufficient: "moins de deux sites homologues utilisables pour le prior empirique du réseau",
  source_prior_variance_unavailable: "variabilité inter-stations du réseau insuffisante pour estimer une performance individuelle",
};

export function StationPerformancePanel({ performance, windowDays }: { performance: any; windowDays: number | null }) {
  const variables = Object.entries(PERFORMANCE_VARIABLE_LABELS) as Array<[string, string]>;
  const states = variables.map(([key]) => stationPerformanceVariable(performance?.variables?.[key]));
  const measuredCount = states.filter(state => state.estimate !== null).length;
  const hasResults = states.some(state => state.available);
  const headline = measuredCount > 0
    ? `Mesurée pour ${measuredCount} variable${measuredCount > 1 ? "s" : ""}`
    : hasResults ? "Performance individuelle non mesurée" : "Performance individuelle indisponible";
  const windowLabel = typeof windowDays === 'number' && Number.isInteger(windowDays) && windowDays > 0
    ? `Fenêtre glissante de ${windowDays} jours.` : 'Fenêtre historique non renseignée.';

  return <div className="mt-3 rounded-lg border border-violet-500/20 bg-violet-500/[0.035] p-3" aria-label="Performance météorologique individuelle de la station">
    <div className="flex flex-wrap items-center justify-between gap-2"><p className="text-[11px] font-semibold text-violet-100">Performance météo individuelle · accord inter-réseaux</p><span className="text-[10px] font-medium text-violet-200">{headline}</span></div>
    <p className="mt-1 text-[10px] leading-relaxed text-slate-400">MAE/RMSE/biais en unités physiques, comparés à des réseaux et sites distincts; un site aux mêmes coordonnées n’est pas compté deux fois. C’est un accord inter-réseaux, pas une vérité météorologique absolue; l’indépendance amont des fournisseurs n’est pas vérifiée. {windowLabel} Les gates 30/7 sont des minimums de couverture hérités, pas une preuve statistique ni un seuil de score. L’intervalle nominal approximatif à 95 % (t de Student, blocs journaliers) n’est pas calibré; aucun score composite ou probabilité n’est publié. Les précipitations restent non mesurées jusqu’à une règle d’échantillon défendable.</p>
    <details className="mt-2 border-t border-violet-500/15 pt-2">
      <summary className="cursor-pointer text-[10px] font-medium text-violet-200">Détails par variable</summary>
      <div className="mt-2 space-y-2">
        {variables.map(([key, label]) => {
          const result = performance?.variables?.[key];
          const state = stationPerformanceVariable(result);
          const estimate = state.estimate;
          const networks = state.referenceNetworks.map((network: string) => PERFORMANCE_SOURCE_NAMES[network] ?? network).join(", ");
          if (!state.available) return <p key={key} className="text-[10px] leading-relaxed text-slate-400"><span className="font-semibold text-slate-200">{label} :</span> indisponible · nombre de comparaisons et jours couverts non renseignés.</p>;
          if (!estimate) {
            const reason = PERFORMANCE_REASON_LABELS[result?.reason] ?? "historique ou références insuffisants";
            return <p key={key} className="text-[10px] leading-relaxed text-slate-400"><span className="font-semibold text-slate-200">{label} :</span> non mesurée · {reason} · {state.comparisons ?? "—"} comparaison(s), {state.distinctDays ?? "—"} jour(s){state.distinctEventDays === null ? "" : `, ${state.distinctEventDays} jour(s) d’événement`} {networks ? `· références : ${networks}` : ""}.</p>;
          }
          const interval = estimate.uncertainty95;
          return <p key={key} className="text-[10px] leading-relaxed text-slate-300"><span className="font-semibold text-slate-100">{label} :</span> MAE brute poolée {estimate.meanAbsoluteError.toFixed(1)} {result.unit} · MAE moyenne par jour (entrée du shrinkage) {estimate.meanDailyAbsoluteError.toFixed(1)} {result.unit} · prior empirique {estimate.sourcePriorMeanAbsoluteError.toFixed(1)} {result.unit} · MAE shrinkée {estimate.shrunkMeanAbsoluteError.toFixed(1)} {result.unit} (poids de la mesure station : {estimate.stationEvidenceWeight.toFixed(2)}) · intervalle nominal approximatif à 95 % [{interval.lower.toFixed(1)}–{interval.upper.toFixed(1)}] · RMSE {estimate.rootMeanSquareError.toFixed(1)} {result.unit} · biais {estimate.meanBias.toFixed(1)} {result.unit} · désaccord moyen des références {estimate.meanReferenceDisagreement.toFixed(1)} {result.unit} · {state.comparisons ?? "—"} comparaison(s), {state.distinctDays ?? "—"} jour(s){state.distinctEventDays === null ? "" : `, ${state.distinctEventDays} jour(s) d’événement`} · prior de {result.sourcePriorSiteCount} site(s) du réseau{networks ? ` · références : ${networks}` : ""}.</p>;
        })}
      </div>
    </details>
  </div>;
}

type PhysicalStationDiagnostics = {
  netatmoStatus?: "not_connected" | "temporarily_unavailable" | "fresh_cache" | "live" | "connected_empty";
  discoveredCount?: number;
  activeCount?: number;
  exclusionReasons?: string[];
};

function explainPhysicalStationAvailability(
  diagnostics: PhysicalStationDiagnostics | null | undefined,
  radiusKm: number,
) {
  const exclusionReasons = diagnostics?.exclusionReasons ?? [];
  const discoveredCount = diagnostics?.discoveredCount ?? exclusionReasons.length;
  let detail = "Aucune cause détaillée n’a été renvoyée par la vérification actuelle.";

  if (exclusionReasons.length > 0) {
    detail = `${discoveredCount} station${discoveredCount > 1 ? "s" : ""} physique${discoveredCount > 1 ? "s" : ""} trouvée${discoveredCount > 1 ? "s" : ""}, mais écartée${discoveredCount > 1 ? "s" : ""} : ${exclusionReasons.join(" · ")}.`;
  } else if (diagnostics?.netatmoStatus === "not_connected") {
    detail = "La source Netatmo n’était pas autorisée pour cette session de vérification.";
  } else if (diagnostics?.netatmoStatus === "connected_empty") {
    detail = `La source Netatmo a répondu, mais aucune station physique n’a été renvoyée dans le rayon de ${radiusKm} km.`;
  } else if (diagnostics?.netatmoStatus === "temporarily_unavailable") {
    detail = "La source Netatmo n’a pas répondu et aucun cache récent exploitable n’a été retrouvé.";
  } else if (diagnostics?.netatmoStatus === "fresh_cache") {
    detail = "La vérification utilise un cache Netatmo authentifié récent, sans relevé physique actuellement retenu.";
  } else if (discoveredCount === 0) {
    detail = `Aucune station physique n’a été trouvée dans le rayon de ${radiusKm} km lors de la vérification actuelle.`;
  }

  return detail;
}

function TemperatureComparison({ points, periodDays }: { points: ComparisonPoint[]; periodDays: 1 | 7 }) {
  const geometry = stationChartGeometry(points, periodDays);
  if (!geometry.hasPairs) {
    return <MeteoSurface className="rounded-xl border-dashed border-slate-800 bg-transparent px-4 py-8 text-center text-sm text-slate-500">Aucune paire de température station/modèles n’est disponible sur cette période. Aucune heure manquante n’est reconstituée.</MeteoSurface>;
  }
  const { width, height } = geometry;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-4 text-[11px] text-slate-400">
        <span className="flex items-center gap-1.5"><i className="h-2.5 w-2.5 rounded-full bg-emerald-400" /> Stations physiques</span>
        <span className="flex items-center gap-1.5"><i className="h-2.5 w-2.5 rounded-full bg-blue-400" /> Modèles archivés</span>
      </div>
      <div className="h-[168px] rounded-xl border border-slate-800 bg-[#090b10] px-2 py-1">
        <svg viewBox={`0 0 ${width} ${height}`} className="h-full w-full" role="img" aria-label={`Comparaison des températures des stations et des modèles archivés sur ${periodDays === 1 ? "24 heures" : "7 jours"}`}>
          {[0.25, 0.5, 0.75].map((ratio) => <line key={ratio} x1="0" x2={width} y1={height * ratio} y2={height * ratio} stroke="#1e293b" strokeWidth="1" />)}
          {geometry.forecast.map((line, i) => <polyline key={`forecast-${i}`} points={line} fill="none" stroke="#60a5fa" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />)}
          {geometry.temperature.map((line, i) => <polyline key={`station-${i}`} points={line} fill="none" stroke="#34d399" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />)}
          {geometry.isolated("officialTemperature").map((p, i) => <circle key={`forecast-dot-${i}`} cx={p.x} cy={p.y} r="3" fill="#60a5fa" />)}
          {geometry.isolated("stationTemperature").map((p, i) => <circle key={`station-dot-${i}`} cx={p.x} cy={p.y} r="3" fill="#34d399" />)}
          {geometry.labels.map((tick) => <text key={tick.index} x={tick.x} y={height - 3} fill="#64748b" fontSize="14" textAnchor={tick.anchor}><title>{tick.title}</title>{tick.text}</text>)}
        </svg>
      </div>
      <p className="text-[11px] text-slate-500">{periodDays === 1 ? "Créneaux terminés, heures locales Europe/Paris. Les interruptions restent visibles ; les heures sans mesure ne sont pas interpolées." : "Moyennes journalières sur les seules heures appariées station/modèles, sans compléter les heures manquantes."}</p>
    </div>
  );
}

export default function Ranking() {
  const clockNow=useVisibleClock();
  const { activeLocation, setActiveLocation } = useLocation();
  const { style: pageSkyStyle } = usePageWeatherSky();
  const [periodDays, setPeriodDays] = useState<1 | 7>(1);
  const radiusKm = activeLocation?.radiusKm ?? 20;
  const [selectedSource, setSelectedSource] = useState<SourceSelectionKey | null>(null);
  const [physicalCollectionMessage, setPhysicalCollectionMessage] = useState<{ tone: "success" | "warning" | "danger" | "info"; text: string } | null>(null);
  const coords = { lat: activeLocation?.lat ?? 50.7567, lon: activeLocation?.lon ?? 2.5204 };
  const overviewInput = useMemo(() => ({ ...(coords ?? {}), periodDays, radiusKm }), [coords?.lat, coords?.lon, periodDays, radiusKm]);
  const {
    data,
    error: overviewError,
    isError: isOverviewError,
    isFetching: isOverviewFetching,
    isLoading,
    isPlaceholderData: isOverviewPlaceholder,
    refetch: refetchOverview,
  } = trpc.weather.getStationReliabilityOverview.useQuery(overviewInput, {
    staleTime: 5 * 60 * 1000,
    refetchInterval:5*60*1000,refetchIntervalInBackground:false,
    placeholderData: previous => stationOverviewPlaceholder(previous, { ...coords, radiusKm }),
  });
  const {
    data: liveStationData,
    error: liveStationsError,
    isError: isLiveStationsError,
    isFetching: isLiveStationsFetching,
    isLoading: liveStationsLoading,
    refetch: refetchLiveStations,
  } = trpc.weather.searchStations.useQuery(
    { ...(coords ?? { lat: 50.7567, lon: 2.5204 }), radiusKm },
    { staleTime: 5 * 60 * 1000, refetchInterval:5*60*1000,refetchIntervalInBackground:false },
  );
  // Contrat de classement figé côté serveur (getStationRankingContract) :
  // inutile de le redemander à chaque retour d'onglet.
  const { data: rankingCriteria, isError: criteriaError } = trpc.weather.getStationRankingCriteria.useQuery(
    undefined,
    { staleTime: 60 * 60 * 1000, refetchOnWindowFocus: false },
  );
  const currentSources = liveStationData?.stations ?? [];
  const modelsQuery = useQuery({queryKey:liveComparisonQueryKey(coords.lat,coords.lon),queryFn:()=>collectLiveModelComparison(coords.lat,coords.lon),staleTime:MODEL_COMPARISON_REFRESH_MS,refetchInterval:MODEL_COMPARISON_REFRESH_MS,refetchIntervalInBackground:false,refetchOnWindowFocus:false,retry:false});
  const modelReferences = stationModelReferences(modelsQuery.data, liveStationData?.groundTruth);
  const modelCount = !modelsQuery.data || modelsQuery.data.stale ? '—' : String(modelReferences.length);
  const modelStatus = modelsQuery.isError ? 'Références Open-Meteo momentanément indisponibles.' : modelsQuery.data?.stale ? 'Références en cache périmées : elles ne sont pas comptées pour l’heure courante.' : !modelsQuery.data ? 'Chargement des références Open-Meteo…' : modelReferences.length === 0 ? 'Aucun modèle individuel reçu pour l’heure courante. Best match n’est pas compté comme modèle indépendant.' : `${modelReferences.length} modèles Open-Meteo à la même échéance, distincts des observations Netatmo.`;
  const sourceContext = JSON.stringify([coords.lat, coords.lon, radiusKm]);
  const detailsSelection = resolveSourceSelection(selectedSource, currentSources, modelReferences, sourceContext);
  useEffect(() => {
    if (selectedSource && !detailsSelection) setSelectedSource(null);
  }, [selectedSource, detailsSelection]);
  const liveStationsById = useMemo(
    () => new Map(currentSources.map((station) => [station.stationId, station])),
    [currentSources],
  );
  const currentPresentation = useMemo(() => currentStationPresentation(liveStationData, clockNow, data), [liveStationData, data, clockNow]);
  const stationProviderFailed = liveStationData?.sourceDiagnostics?.some((item) => item.status === "error") ?? false;
  const refreshStations = async () => {
    setPhysicalCollectionMessage(null);
    const result = await refetchLiveStations();
    const providerFailed = result.data?.sourceDiagnostics?.some((item) => item.status === "error");
    const disconnected = result.data?.physicalStationDiagnostics?.netatmoStatus === "not_connected";
    setPhysicalCollectionMessage({
      tone: result.isError || providerFailed ? "danger" : disconnected ? "warning" : "info",
      text: result.isError || providerFailed
        ? "Les stations sont temporairement indisponibles. Les archives existantes restent conservées."
        : disconnected ? "La connexion Netatmo doit être rétablie depuis la page de connexion."
        : "Relevés actualisés. Le cache Netatmo de dix minutes est conservé ; les mesures déjà archivées ne sont pas remplacées.",
    });
    await refetchOverview();
  };
  const changeRadius = (nextRadius: number) => {
    // Rayon de consultation partagé ; aucun réglage non pris en charge n'est envoyé aux favoris.
    setActiveLocation({ ...(activeLocation ?? { ...coords, name: "Hondeghem" }), radiusKm: nextRadius });
  };

  if (isLoading) {
    return <div className="weather-page-sky mx-auto min-h-screen max-w-2xl space-y-4 bg-[#080a0f] px-3 pb-24 pt-3 sm:px-5 sm:pt-5" style={pageSkyStyle}><Skeleton className="h-7 w-48 bg-slate-800" /><Skeleton className="h-32 w-full bg-slate-800" /><Skeleton className="h-56 w-full bg-slate-800" /></div>;
  }

  const stations = data?.stations ?? [];
  const comparison = periodDays === 1 ? (data?.comparison24h ?? []) : (data?.comparison7d ?? []);
  const latestMeasurementAt = currentPresentation.lastMeasurementAt;
  const locationName = activeLocation?.name ?? "Hondeghem";
  const selectedSummary = stationComparisonSummary(data, periodDays);
  const instantDeltaC = selectedSummary.deltaC;
  const realLocalStations = usedLocalStations(currentPresentation.stations);
  // Les sources écartées passent par le helper partagé, celui que la carte et
  // les badges utilisent : une seule définition du statut affiché, donc aucune
  // divergence possible entre le compteur et la pastille.
  const ignoredSources = currentSources.filter((station) => getStationDisplayStatus(station) === "excluded");
  const physicalStationExplanation = explainPhysicalStationAvailability(
    liveStationData?.physicalStationDiagnostics,
    radiusKm,
  );

  return (
    <main className="weather-page-sky min-h-screen bg-[#080a0f] pb-28" style={pageSkyStyle}>
      <div className="mx-auto max-w-2xl px-3 pt-2 sm:px-5 sm:pt-4">
        <header className="mb-4 flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 text-blue-400"><MeteoIcon name="location" size={19} /><span className="text-sm font-semibold">{locationName}</span></div>
            <h1 className="mt-2 text-xl font-bold text-white">Stations & fiabilité locale</h1>
            <p className="mt-1 text-xs text-slate-500">Relevés physiques et comparaison avec les modèles archivés.</p>
          </div>
          <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-slate-700/80 bg-[#0b0f16]/75 px-2.5 py-1 text-[10px] font-medium text-slate-400" aria-label={`Relevés physiques automatiques : ${STATION_SNAPSHOT_CADENCE_LABEL}`}>
            <Clock3 className="h-3.5 w-3.5 text-slate-500" aria-hidden="true" />
            {STATION_SNAPSHOT_CADENCE_LABEL}
          </span>
        </header>

        {(isOverviewError || isLiveStationsError || stationProviderFailed) ? (
          <section role="alert" className="mb-4 rounded-2xl border border-rose-400/30 bg-rose-400/[0.06] p-4" aria-label="Erreur de chargement des stations">
            <h2 className="text-sm font-semibold text-rose-100">Données de stations temporairement indisponibles</h2>
            <p className="mt-1 text-xs leading-relaxed text-slate-300">{isOverviewError && isLiveStationsError ? "La synthèse et la recherche de stations ont échoué." : isOverviewError ? "La synthèse de fiabilité n’a pas pu être chargée." : "La recherche de stations n’a pas pu être chargée."} Cette erreur technique ne signifie pas qu’il n’existe aucune station dans ce rayon.</p>
            {(data || liveStationData) ? <p className="mt-1 text-[11px] text-amber-100">Données précédentes affichées lorsqu’elles sont disponibles.</p> : null}
            <div className="mt-3 flex flex-wrap gap-2">
              {isOverviewError ? <button type="button" disabled={isOverviewFetching} onClick={() => void refetchOverview()} className="min-h-10 rounded-md border border-rose-300/50 px-3 text-xs font-semibold text-rose-100 disabled:cursor-wait disabled:opacity-60">{isOverviewFetching ? "Relance en cours…" : "Réessayer la synthèse"}</button> : null}
              {(isLiveStationsError || stationProviderFailed) ? <button type="button" disabled={isLiveStationsFetching} onClick={() => void refetchLiveStations()} className="min-h-10 rounded-md border border-rose-300/50 px-3 text-xs font-semibold text-rose-100 disabled:cursor-wait disabled:opacity-60">{isLiveStationsFetching ? "Relance en cours…" : "Réessayer les stations"}</button> : null}
            </div>
            {(overviewError?.message || liveStationsError?.message) ? <p className="mt-2 text-[10px] text-slate-400">{overviewError?.message ?? liveStationsError?.message}</p> : null}
          </section>
        ) : null}

        <section className="mb-4 rounded-2xl border border-sky-400/30 bg-sky-400/[0.06] p-4">
          <div><h2 className="font-semibold text-white">Votre situation locale</h2><p className="mt-1 text-xs leading-relaxed text-slate-300">Recherche Netatmo : 50 km ; synthèse locale : jusqu’à 30 km selon les critères de fraîcheur et de qualité. Les stations les plus proches et les plus fraîches décrivent le contexte observé autour de {locationName}. Les effectifs et valeurs physiques sont affichés séparément, sans note 0–100.</p></div>
          <div className="mt-3 grid grid-cols-3 gap-2"><Metric label="Stations utilisées" value={!liveStationData || stationProviderFailed || isLiveStationsError ? "—" : String(currentPresentation.usedCount)} icon="stations" color="text-emerald-400" /><Metric label="Température" value={isLiveStationsError && !liveStationData ? "—" : liveStationData?.groundTruth?.temperature == null ? "—" : `${Number(liveStationData.groundTruth.temperature).toFixed(1)}°C`} icon="temperature" color="text-amber-300" /><Metric label="Dernier relevé" value={latestMeasurementAt == null ? "—" : formatAge(Math.max(0, Math.round((Date.now() - latestMeasurementAt) / 60000)))} icon="refresh" color="text-slate-300" /></div>
          <div className="mt-3 space-y-3" aria-label="Détails de la synthèse locale">
            <h3 className="px-1 text-xs font-semibold text-sky-100">Détails de la synthèse locale</h3>
              <div className="rounded-xl border border-sky-500/20 bg-[#10131a] p-3"><div><h3 className="text-sm font-semibold text-white">Synthèse multi-source</h3><p className="mt-1 text-[11px] leading-relaxed text-slate-400">Les observations disponibles sont séparées des références de modèles; aucun indice global de confiance n’est affiché.</p></div><StationSummaryReadings groundTruth={liveStationData?.groundTruth} /></div>
              <div className="grid grid-cols-3 gap-2 rounded-xl border border-slate-800 bg-[#10131a] p-3"><Metric label="Locales utilisées (≤30 km)" value={String(realLocalStations.length)} icon="stations" color="text-emerald-400" /><Metric label="Modèles" value={modelCount} icon="confidence" color="text-violet-300" /><Metric label="Écartées" value={String(ignoredSources.length)} icon="refresh" color="text-slate-300" /></div>
              <p role="status" className="text-[11px] leading-relaxed text-slate-400">{modelStatus}</p>
              {modelsQuery.isError ? <button type="button" disabled={modelsQuery.isFetching} onClick={() => void modelsQuery.refetch()} className="min-h-11 text-xs text-blue-300">Réessayer les modèles</button> : null}
          </div>
          <p className="mt-3 rounded-xl border border-sky-400/15 bg-slate-950/20 px-3 py-2 text-[11px] leading-relaxed text-slate-400">La synthèse locale complète la prévision officielle. Elle ne la remplace pas et aucun relevé absent n’est inventé.</p>
        </section>

        <section className="mb-4 rounded-2xl border border-slate-800 bg-[#10131a] p-4">
          <div className="mb-3 flex items-start justify-between gap-3"><div><h2 className="font-semibold text-white">Carte des stations</h2><p className="text-xs text-slate-500">Vert : utilisée · ambre : à vérifier · bleu : lieu sélectionné.</p></div><MeteoIcon name="location" size={21} className="text-blue-400" /></div>
          <Suspense fallback={<StationMapFallback />}>
            <StationMap center={data?.center ?? coords} stations={currentPresentation.stations} />
          </Suspense>
          <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-slate-400"><span><i className="mr-1 inline-block h-2 w-2 rounded-full bg-emerald-400" />Utilisée</span><span><i className="mr-1 inline-block h-2 w-2 rounded-full bg-amber-300" />À vérifier</span><span><i className="mr-1 inline-block h-2 w-2 rounded-full bg-blue-400" />Lieu actif</span></div>
        </section>

        <section className="mb-4 rounded-2xl border border-emerald-400/25 bg-emerald-400/[0.055] p-3" aria-labelledby="physical-refresh-title">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <h2 id="physical-refresh-title" className="text-sm font-semibold text-emerald-50">Relevés des stations</h2>
              <p className="mt-1 text-[11px] leading-relaxed text-slate-300">Actualise les stations pour {locationName} dans le rayon choisi, en conservant le cache Netatmo et les archives existantes.</p>
            </div>
            <button
              type="button"
              disabled={isLiveStationsFetching || isOverviewFetching}
              onClick={() => void refreshStations()}
              className="inline-flex min-h-10 shrink-0 items-center justify-center gap-2 rounded-xl border border-emerald-300/55 bg-emerald-400/15 px-3 text-xs font-semibold text-emerald-50 transition-colors hover:bg-emerald-400/25 active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300"
              aria-describedby="physical-refresh-note"
            >
              <RefreshCw className={`h-4 w-4 ${isLiveStationsFetching ? "animate-spin" : ""}`} aria-hidden="true" />
              {isLiveStationsFetching ? "Collecte en cours…" : "Relancer les relevés"}
            </button>
          </div>
          <p id="physical-refresh-note" className="mt-2 text-[10px] leading-relaxed text-slate-400">Zone Netatmo interrogée : 50 km. Le rayon choisi filtre les stations affichées. Le collecteur cloud fonctionne indépendamment de votre PC. Le bilan ci-dessous indique le dernier passage effectivement reçu.</p>
          {physicalCollectionMessage ? <div role="status" className={`mt-3 rounded-xl border px-3 py-2 text-[11px] leading-relaxed ${physicalCollectionMessage.tone === "success" ? "border-emerald-300/30 bg-emerald-400/10 text-emerald-100" : physicalCollectionMessage.tone === "danger" ? "border-rose-300/30 bg-rose-400/10 text-rose-100" : physicalCollectionMessage.tone === "warning" ? "border-amber-300/30 bg-amber-400/10 text-amber-100" : "border-sky-300/30 bg-sky-400/10 text-sky-100"}`}>{physicalCollectionMessage.text}</div> : null}
        </section>

        <section className="mb-4 rounded-2xl border border-slate-800 bg-[#10131a] p-4">
          <div className="mb-3 flex items-start justify-between gap-3"><div><h2 className="font-semibold text-white">Rayon de recherche</h2><p className="text-xs text-slate-500">Choisissez jusqu’où rechercher les stations physiques.</p></div><MeteoIcon name="location" size={20} className="text-blue-400" /></div>
          <div className="flex flex-wrap gap-2">{[5, 10, 20, 30, 50].map((radius) => <button key={radius} type="button" aria-pressed={radiusKm === radius} onClick={() => changeRadius(radius)} className={`rounded-lg border px-3 py-1.5 text-xs font-medium ${radiusKm === radius ? "border-blue-500 bg-blue-600 text-white" : "border-slate-700 bg-[#090b10] text-slate-300"}`}>{radius} km</button>)}</div>
          <p className="mt-3 text-[11px] text-slate-500">Ce choix reste valable pour cette consultation. Il ne modifie pas le rayon de collecte Netatmo de 50 km.</p>
        </section>

        {isLiveStationsError && !liveStationData ? null : <LiveSourceSummary
          groundTruth={liveStationData?.groundTruth}
          realLocalStations={realLocalStations}
          modelReferences={modelReferences}
          modelCount={modelCount}
          modelsLoading={modelsQuery.isLoading}
          modelStatus={modelStatus}
          ignoredCount={ignoredSources.length}
          criteria={rankingCriteria}
          criteriaError={criteriaError}
          isLoading={liveStationsLoading}
          physicalStationExplanation={physicalStationExplanation}
          onOpenDetails={(source, kind) => setSelectedSource(sourceSelectionKey(source, kind, sourceContext))}
        />}

        <details className="mb-4 rounded-2xl border border-slate-800 bg-[#10131a] p-3">
          <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 text-sm font-semibold text-white [&::-webkit-details-marker]:hidden"><span>Voir les autres sources disponibles</span><ChevronDown className="h-4 w-4 shrink-0 text-slate-400 transition-transform details-open:rotate-180" /></summary>
          <div className="mt-3"><FilteredStationDirectory sources={currentSources as any[]} isLoading={liveStationsLoading} onOpenDetails={(source) => setSelectedSource(sourceSelectionKey(source, "station", sourceContext))} /></div>
        </details>

        <details className="mb-4 rounded-2xl border border-slate-800 bg-[#10131a] p-3">
          <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 text-sm font-semibold text-white [&::-webkit-details-marker]:hidden"><span>Voir les relevés et comparaisons détaillés</span><ChevronDown className="h-4 w-4 shrink-0 text-slate-400" /></summary>
          <div className="mt-3">
          <section className="rounded-2xl border border-slate-800 bg-[#10131a] p-4">
          <div className="mb-4 flex items-center justify-between"><div><h2 className="font-semibold text-white">Relevés des stations</h2><p className="text-xs text-slate-500">Stations physiques validées autour du lieu.</p></div><MeteoIcon name="stations" size={22} /></div>
          {(data as any)?.archiveStatus?.status === "unavailable" ? <p role="status" className="mb-3 text-xs text-amber-200">Historique des stations indisponible ; les relevés actuels restent affichés sur la carte.</p> : null}
          {((data as any)?.archiveStatus?.boundedRead || (data as any)?.archiveStatus?.status === "partial") ? <p role="status" className="mb-3 text-xs text-amber-200">Lecture historique partielle ou bornée aux 48 derniers lots. Les heures manquantes ne sont pas complétées.</p> : null}
          {isOverviewPlaceholder ? <p role="status" className="py-4 text-sm text-slate-400">Chargement des relevés de la période sélectionnée…</p> : stations.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-800 px-4 py-8 text-center text-sm text-slate-500">{isLiveStationsError || stationProviderFailed ? "L’inventaire actuel des stations est indisponible. Cela ne signifie pas que les archives sont vides." : `Aucun relevé historique associé aux stations actuellement identifiées. Collecte : ${STATION_SNAPSHOT_CADENCE_LABEL.toLowerCase()}.`}</div>
          ) : (
            <div className="space-y-2">
              {stations.map((station: any) => {
                const liveStation = liveStationsById.get(station.stationId);
                const selectedReading = stationLatestReading(station, liveStation,clockNow);
                const displayedLatest = selectedReading.reading;
                const displayedAgeMinutes = selectedReading.ageMinutes;
                const hasDirectReading = selectedReading.kind === "live";

                return <article key={station.stationId} className="rounded-xl border border-slate-800 bg-[#090b10] p-3">
                  <div className="flex items-start justify-between gap-3"><div><p className="font-medium text-sm text-white">{station.name}</p><p className="mt-0.5 text-[11px] text-slate-500">{station.source} · {station.distanceKm.toFixed(1)} km · priorité technique réseau {Math.round(station.reliabilityScore)}/100</p></div><span className={`rounded-full px-2 py-1 text-[10px] ${displayedAgeMinutes !== null && displayedAgeMinutes <= 90 ? "bg-emerald-500/10 text-emerald-400" : "bg-amber-500/10 text-amber-300"}`}>{formatAge(displayedAgeMinutes)}</span></div>
                  <div className="mt-3 grid grid-cols-4 gap-2 border-t border-slate-800 pt-3 text-center"><Reading label="Temp." value={value(displayedLatest?.temperature, "°")} /><Reading label="Vent" value={value(displayedLatest?.windSpeed, " km/h")} /><Reading label="Rafales" value={value(displayedLatest?.windGust, " km/h")} /><Reading label="Pluie" value={value(displayedLatest?.precipitation, " mm")} /></div>
                  <p className="mt-3 text-[11px] text-slate-600">{station.readings.length > 0 ? `${station.readings.length} relevé(s) conservé(s) sur la période sélectionnée. ` : ""}{hasDirectReading ? "Dernier relevé direct : cet instant n’est pas encore archivé." : displayedLatest ? "Dernier relevé archivé." : "Aucun relevé archivé ou direct disponible."}</p>
                  {selectedReading.conflict ? <p role="status" className="mt-2 text-[11px] text-amber-200">Valeurs discordantes au même instant ; le relevé archivé reste conservé.</p> : null}
                  <div className="mt-3 rounded-lg border border-slate-800 bg-slate-950/25 p-3">
                    <p className="text-[10px] font-semibold text-slate-200">Profil opérationnel des relevés</p>
                    {station.qualityProfile ? <p className="mt-1 text-[10px] leading-relaxed text-slate-400">Complétude {station.qualityProfile.completenessScore == null ? "—" : `${Math.round(station.qualityProfile.completenessScore * 100)}%`} · continuité {station.qualityProfile.continuityScore == null ? "—" : `${Math.round(station.qualityProfile.continuityScore * 100)}%`} · stabilité {station.qualityProfile.stabilityScore == null ? "—" : `${Math.round(station.qualityProfile.stabilityScore * 100)}%`} · {station.qualityProfile.observationCount} relevé(s). Cela décrit la couverture et la régularité des données, pas la précision météorologique.</p> : <p className="mt-1 text-[10px] text-slate-500">Profil de complétude, continuité et stabilité non disponible.</p>}
                  </div>
                  <StationPerformancePanel performance={station.stationPerformance} windowDays={data?.performanceWindowDays ?? null} />
                </article>;
              })}
            </div>
          )}
        </section>

          <section className="mt-3 rounded-2xl border border-slate-800 bg-[#10131a] p-4">
          <div className="mb-4 flex items-start justify-between gap-3"><div><h2 className="font-semibold text-white">Stations vs modèles archivés</h2><p className="text-xs text-slate-500">Température — heures de Paris.</p><p className="mt-1 text-[10px] leading-relaxed text-slate-400">Comparaison descriptive : une valeur par modèle reçu avant le créneau comparé. La moyenne des modèles archivés ne représente pas la fusion officielle. Ce graphique ne constitue ni une MAE ni un score de fiabilité.</p></div><div className="flex rounded-lg border border-slate-700 bg-[#090b10] p-0.5"><button type="button" aria-pressed={periodDays === 1} onClick={() => setPeriodDays(1)} className={`rounded-md px-2.5 py-1 text-xs ${periodDays === 1 ? "bg-blue-600 text-white" : "text-slate-400"}`}>24 h</button><button type="button" aria-pressed={periodDays === 7} onClick={() => setPeriodDays(7)} className={`rounded-md px-2.5 py-1 text-xs ${periodDays === 7 ? "bg-blue-600 text-white" : "text-slate-400"}`}>7 jours</button></div></div>
          <div className="mb-4 flex items-center justify-between rounded-xl border border-slate-800 bg-[#090b10] px-3 py-2"><span className="text-xs text-slate-400">Dernier écart apparié station / modèles</span><span className={`text-sm font-bold ${instantDeltaC === null ? "text-slate-400" : instantDeltaC > 0 ? "text-amber-300" : instantDeltaC < 0 ? "text-sky-300" : "text-emerald-400"}`}>{instantDeltaC === null ? "—" : `${instantDeltaC > 0 ? "+" : ""}${instantDeltaC.toFixed(1)} °C`}</span></div>
          {selectedSummary.validAt != null ? <p className="mb-3 text-[11px] text-slate-400">Dernier créneau apparié : {new Date(selectedSummary.validAt).toLocaleString("fr-FR", {timeZone:"Europe/Paris",dateStyle:"short",timeStyle:"short"})} · Europe/Paris.</p> : null}
          {(data as any)?.comparisonStatus === "partial" ? <p role="status" className="mb-3 text-xs text-amber-200">Comparaison partielle : certaines archives sont absentes, rejetées ou hors de la limite de lecture.</p> : (data as any)?.comparisonStatus === "unavailable" ? <p role="status" className="mb-3 text-xs text-amber-200">Archives de comparaison indisponibles. Les mesures actuelles restent consultables.</p> : null}
          {(data as any)?.comparisonEvidence ? <p className="mb-3 text-[11px] text-slate-400">Référence physique dans un rayon de {(data as any).comparisonEvidence.referenceRadiusKm} km, au moins 3 stations par créneau. Zone Netatmo interrogée : 50 km.</p> : null}
          <TemperatureComparison points={comparison} periodDays={periodDays} />
          </section>
          </div>
        </details>

        <CollectionObservabilitySections />
      </div>
      <SourceDetailsDialog selection={detailsSelection} groundTruth={liveStationData?.groundTruth} onOpenChange={(open) => { if (!open) setSelectedSource(null); }} />
      <BackToTopButton />
    </main>
  );
}

const SOURCE_LABELS: Record<string, string> = {
  meteofrance: "Météo-France",
  synop: "SYNOP/WMO",
  noaa: "NOAA",
  openmeteo: "Open-Meteo",
  netatmo: "STATION NETATMO",
  wunderground: "Grille régionale · GFS",
  davis: "Référence de grille",
  infoclimat: "Grille locale · AROME",
};

function StationSourceCard({ station, rank, physical, onOpenDetails }: { station: any; rank: number; physical: boolean; onOpenDetails: (source: any) => void }) {
  const temperature = station.temperature === null || station.temperature === undefined ? "—" : `${Number(station.temperature).toFixed(1)}°`;
  const displayStatus = getStationDisplayStatus(station);
  const isAuthenticatedNetatmo = displayStatus === "physical" && station.source === "netatmo" && String(station.stationId ?? "").startsWith("netatmo-");
  const sourceTone: WeatherStatusBadgeTone = displayStatus === "physical" ? "success" : "info";
  const statusTone: WeatherStatusBadgeTone = displayStatus === "physical" ? "success" : displayStatus === "reference" ? "info" : "danger";
  const statusLabel = isAuthenticatedNetatmo ? "NIVEAU 1 · AUTHENTIFIÉE" : displayStatus === "physical" ? "STATION RÉELLE" : displayStatus === "reference" ? "RÉFÉRENCE / GRILLE" : "SOURCE ÉCARTÉE";
  const markerClass = displayStatus === "physical" ? "bg-emerald-400" : displayStatus === "reference" ? "bg-sky-400" : "bg-rose-400";
  const inactiveClass = displayStatus === "excluded" ? "border-rose-500/25 bg-rose-500/5 opacity-80" : "border-slate-800 bg-[#090b10]";
  const description = isAuthenticatedNetatmo ? "Observation issue de l’API Netatmo autorisée ; identifiant de station vérifiable et provenance physique." : station.exclusionReason ? `Écartée : ${station.exclusionReason}` : null;
  const quality = station.qualityProfile;
  const qualityLabel = quality?.status === "fiable" ? "PROFIL OPÉRATIONNEL STABLE" : quality?.status === "qualifiee" ? "PROFIL DE RELEVÉS QUALIFIÉ" : quality?.status === "degradee" ? "PROFIL DE RELEVÉS DÉGRADÉ" : quality?.status === "en_observation" ? "PROFIL DE RELEVÉS EN OBSERVATION" : null;
  const qualityTone: WeatherStatusBadgeTone = quality?.status === "fiable" ? "success" : quality?.status === "qualifiee" ? "info" : quality?.status === "degradee" ? "warning" : "neutral";
  return <article className={`rounded-xl border ${inactiveClass}`}>
    <button type="button" onClick={() => onOpenDetails(station)} aria-label={`Ouvrir les données brutes et la contribution de ${station.name}`} className="flex w-full items-center gap-3 p-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400">
      <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold ${rank <= 3 ? "bg-blue-500/15 text-blue-300" : "bg-slate-800 text-slate-400"}`}>{rank}</span>
      <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${markerClass}`} />
      <span className="min-w-0 flex-1"><span className="flex flex-wrap items-center gap-1.5"><span className="truncate text-sm font-medium text-white">{station.name}</span><WeatherStatusBadge compact tone={sourceTone} label={SOURCE_LABELS[station.source] ?? station.source} /><WeatherStatusBadge compact tone={statusTone} label={statusLabel} pulse={isAuthenticatedNetatmo} />{qualityLabel ? <WeatherStatusBadge compact tone={qualityTone} label={qualityLabel} /> : null}</span><span className="mt-0.5 block text-[11px] text-slate-500">{Number(station.distanceKm).toFixed(1)} km{station.altitude !== null && station.altitude !== undefined ? ` · ${station.altitude} m` : ""}</span></span>
      <span className="text-right"><span className="block text-lg font-semibold text-white">{temperature}</span><span className="text-[10px] text-slate-500">Temp.</span></span>
      <span className="text-[10px] font-semibold text-blue-300">Détails</span>
    </button>
    <p className={`border-t border-slate-800 px-3 py-2 text-[10px] ${description ? "text-amber-200" : "text-slate-500"}`}>{description ?? `Disponibilité de source estimée ${Math.round((station.dataAvailability ?? 0) * 100)}% · cadence nominale ${station.updateFrequencyMin ?? "—"} min.`}{quality ? ` · profil opérationnel (${quality.observationCount} relevé(s)) : complétude ${quality.completenessScore == null ? "—" : `${Math.round(quality.completenessScore * 100)}%`}, continuité ${quality.continuityScore == null ? "—" : `${Math.round(quality.continuityScore * 100)}%`}, stabilité ${quality.stabilityScore == null ? "—" : `${Math.round(quality.stabilityScore * 100)}%`}; ces indicateurs ne mesurent pas la précision météorologique.` : ""}</p>
  </article>;
}

function ModelReferenceCard({ reference, rank, onOpenDetails }: { reference: any; rank: number; onOpenDetails: (source: any) => void }) {
  const temperature = reference.temperature === null || reference.temperature === undefined ? "—" : `${Number(reference.temperature).toFixed(1)}°`;
  const deltaLabel = reference.localDeltaC === null || reference.localDeltaC === undefined ? "Aucune station locale validée" : `Écart local ${Number(reference.localDeltaC) > 0 ? "+" : ""}${Number(reference.localDeltaC).toFixed(1)} °C`;
  return <article className="rounded-xl border border-violet-500/20 bg-[#090b10]"><button type="button" onClick={() => onOpenDetails(reference)} aria-label={`Ouvrir les données brutes et la contribution de ${reference.name}`} className="w-full p-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400"><div className="flex items-center gap-3"><span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-violet-500/10 text-xs font-bold text-violet-200">{rank}</span><span className="min-w-0 flex-1"><span className="flex flex-wrap items-center gap-1.5"><span className="truncate text-sm font-medium text-white">{reference.name}</span><WeatherStatusBadge compact tone="lab" label="Modèle" value="Non station" /></span><span className="mt-0.5 block text-[11px] text-slate-500">{deltaLabel} · consensus de {reference.localStationCount ?? 0} station{reference.localStationCount === 1 ? "" : "s"} locale{reference.localStationCount === 1 ? "" : "s"}</span></span><span className="text-right"><span className="block text-lg font-semibold text-white">{temperature}</span><span className="text-[10px] text-slate-500">Temp.</span></span></div><div className="mt-2 flex items-center justify-between border-t border-slate-800 pt-2"><span className="text-[10px] text-slate-500">Échéance {reference.updatedAt ? new Date(reference.updatedAt).toLocaleTimeString("fr-FR", { timeZone:"Europe/Paris", hour: "2-digit", minute: "2-digit" }) : "—"}</span><span className="text-[10px] text-slate-500">Écart brut aux observations · sans note de cohérence</span></div></button></article>;
}

const StationFilterChoice = ({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) => <button type="button" onClick={onClick} aria-pressed={active} className={`rounded-lg border px-2.5 py-1.5 text-[11px] font-medium ${active ? "border-blue-500 bg-blue-600 text-white" : "border-slate-700 bg-[#090b10] text-slate-300"}`}>{children}</button>;

function FilteredStationDirectory({ sources, isLoading, onOpenDetails }: { sources: any[]; isLoading: boolean; onOpenDetails: (source: any) => void }) {
  const [kind, setKind] = useState<SourceKindFilter>("all");
  const [status, setStatus] = useState<SourceStatusFilter>("active");
  const [distanceOrder, setDistanceOrder] = useState<SourceDistanceOrder>("nearest");
  const filteredSources = filterAndSortStationSources(sources, kind, status, distanceOrder);

  return <section className="mb-4 rounded-2xl border border-slate-700 bg-[#10131a] p-4"><div className="mb-3 flex items-start justify-between gap-3"><div><h2 className="font-semibold text-white">Explorer les sources</h2><p className="text-xs text-slate-500">Filtrez chaque source selon son type, son statut et sa distance.</p></div><WeatherStatusBadge compact tone="neutral" label="Sources" value={String(filteredSources.length)} /></div><div className="space-y-3 border-b border-slate-800 pb-3"><div><p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500">Type</p><div className="flex flex-wrap gap-1.5"><StationFilterChoice active={kind === "all"} onClick={() => setKind("all")}>Toutes</StationFilterChoice><StationFilterChoice active={kind === "physical"} onClick={() => setKind("physical")}>Locales réelles</StationFilterChoice><StationFilterChoice active={kind === "reference"} onClick={() => setKind("reference")}>Références</StationFilterChoice></div></div><div><p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500">Statut</p><div className="flex flex-wrap gap-1.5"><StationFilterChoice active={status === "active"} onClick={() => setStatus("active")}>Actives</StationFilterChoice><StationFilterChoice active={status === "ignored"} onClick={() => setStatus("ignored")}>Écartées</StationFilterChoice><StationFilterChoice active={status === "all"} onClick={() => setStatus("all")}>Toutes</StationFilterChoice></div></div><div className="flex items-center justify-between gap-3"><p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Distance</p><div className="flex gap-1.5"><StationFilterChoice active={distanceOrder === "nearest"} onClick={() => setDistanceOrder("nearest")}>Plus proches</StationFilterChoice><StationFilterChoice active={distanceOrder === "furthest"} onClick={() => setDistanceOrder("furthest")}>Plus éloignées</StationFilterChoice></div></div></div>{isLoading ? <div className="mt-3 h-24 animate-pulse rounded-xl bg-slate-800" /> : filteredSources.length > 0 ? <div className="mt-3 space-y-2">{filteredSources.map((station, index) => <StationSourceCard key={station.stationId} station={station} rank={index + 1} physical={station.sourceKind === "physical"} onOpenDetails={onOpenDetails} />)}</div> : <div className="mt-3 rounded-xl border border-dashed border-slate-700 px-4 py-6 text-center text-sm text-slate-500">Aucune source ne correspond à ces filtres.</div>}</section>;
}

function LiveSourceSummary({ groundTruth, realLocalStations, modelReferences, modelCount, modelsLoading, modelStatus, ignoredCount, criteria, criteriaError, isLoading, physicalStationExplanation, onOpenDetails }: { groundTruth: any; realLocalStations: any[]; modelReferences: any[]; modelCount:string; modelsLoading:boolean; modelStatus:string; ignoredCount: number; criteria: any; criteriaError: boolean; isLoading: boolean; physicalStationExplanation: string; onOpenDetails: (source: any, kind: "station" | "model") => void }) {
  const netatmoCount = realLocalStations.filter((station) => station.source === "netatmo" && String(station.stationId ?? "").startsWith("netatmo-")).length;
  const [showAdditionalLocalStations, setShowAdditionalLocalStations] = useState(false);
  const [showAdditionalModelReferences, setShowAdditionalModelReferences] = useState(false);
  const values = [
    ["Température", groundTruth?.temperature === null || groundTruth?.temperature === undefined ? "—" : `${Number(groundTruth.temperature).toFixed(1)}°C`],
    ["Humidité", groundTruth?.humidity === null || groundTruth?.humidity === undefined ? "—" : `${Number(groundTruth.humidity).toFixed(0)}%`],
    ["Pression", groundTruth?.pressure === null || groundTruth?.pressure === undefined ? "—" : `${Number(groundTruth.pressure).toFixed(0)} hPa`],
    ["Vent", groundTruth?.windSpeed === null || groundTruth?.windSpeed === undefined ? "—" : `${Number(groundTruth.windSpeed).toFixed(1)} km/h`],
    ["Rafales", groundTruth?.windGust === null || groundTruth?.windGust === undefined ? "—" : `${Number(groundTruth.windGust).toFixed(1)} km/h`],
    ["Précip.", groundTruth?.precipitation === null || groundTruth?.precipitation === undefined ? "—" : `${Number(groundTruth.precipitation).toFixed(1)} mm`],
  ];
  return <section className="mb-4 space-y-4">
    <div className="rounded-2xl border border-emerald-500/20 bg-[#10131a] p-4">
      <div className="mb-3 flex items-start justify-between gap-3"><div><h2 className="font-semibold text-white">Stations locales réelles</h2><a href="/connexion-netatmo" className="mt-2 inline-flex min-h-10 items-center text-xs text-sky-300">Connecter Netatmo · recherche à 50 km →</a><p className="text-xs text-slate-500">Observations physiques identifiées et compatibles avec la collecte officielle.</p></div><WeatherStatusBadge compact tone="success" label="Stations Netatmo" value={netatmoCount > 0 ? String(netatmoCount) : "Indisponibles"} pulse={netatmoCount > 0} /></div>
      {isLoading ? <div className="h-20 animate-pulse rounded-xl bg-slate-800" /> : realLocalStations.length > 0 ? <div className="space-y-2">
        <StationSourceCard station={realLocalStations[0]} rank={1} physical onOpenDetails={(source) => onOpenDetails(source, "station")} />
        {realLocalStations.length > 1 ? <>
          <button type="button" aria-expanded={showAdditionalLocalStations} onClick={() => setShowAdditionalLocalStations((open) => !open)} className="flex min-h-11 w-full items-center justify-between rounded-xl border border-emerald-500/25 bg-emerald-500/5 px-3 text-left text-xs font-medium text-emerald-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300">
            <span>{showAdditionalLocalStations ? "Masquer les autres stations" : `Afficher les ${realLocalStations.length - 1} autres stations`}</span>
            <span aria-hidden="true" className={`text-lg leading-none transition-transform duration-200 ${showAdditionalLocalStations ? "rotate-180" : "rotate-0"}`}>⌄</span>
          </button>
          {showAdditionalLocalStations ? <div className="space-y-2 border-t border-emerald-500/15 pt-2">{realLocalStations.slice(1).map((station, index) => <StationSourceCard key={station.stationId} station={station} rank={index + 2} physical onOpenDetails={(source) => onOpenDetails(source, "station")} />)}</div> : null}
        </> : null}
      </div> : <div className="rounded-xl border border-dashed border-emerald-500/20 px-4 py-5 text-center"><p className="text-sm font-semibold text-emerald-100">{modelReferences.length > 0 ? "Modèles disponibles, relevés physiques insuffisants" : "Relevés physiques indisponibles"}</p><p className="mt-2 text-xs leading-relaxed text-slate-400">{physicalStationExplanation}</p></div>}
    </div>
    <details className="rounded-2xl border border-slate-800 bg-[#10131a] p-3">
      <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 text-sm font-semibold text-white [&::-webkit-details-marker]:hidden"><span>Comprendre les modèles et les critères</span><ChevronDown className="h-4 w-4 shrink-0 text-slate-400" /></summary>
      <div className="mt-3 rounded-2xl border border-violet-500/20 bg-[#10131a] p-4">
      <div className="mb-3 flex items-start justify-between gap-3"><div><h2 className="font-semibold text-white">Références de modèles — non stations</h2><p className="text-xs text-slate-500">Prévisions au point du lieu, comparées aux observations physiques quand elles existent.</p></div><WeatherStatusBadge compact tone="lab" label="Références" value={modelCount} /></div>
      <p className="mb-3 rounded-xl border border-violet-500/15 bg-violet-500/5 px-3 py-2 text-[11px] leading-relaxed text-slate-400">Prévisions de l’heure courante, avec leur heure de réception. L’écart brut décrit l’accord instantané ; il ne modifie pas la température locale avant une validation historique mesurée.</p>
      {modelsLoading ? <div className="h-20 animate-pulse rounded-xl bg-slate-800" /> : modelReferences.length > 0 ? <div className="space-y-2">
        <ModelReferenceCard reference={modelReferences[0]} rank={1} onOpenDetails={(source) => onOpenDetails(source, "model")} />
        {modelReferences.length > 1 ? <>
          <button type="button" aria-expanded={showAdditionalModelReferences} onClick={() => setShowAdditionalModelReferences((open) => !open)} className="flex min-h-11 w-full items-center justify-between rounded-xl border border-violet-500/25 bg-violet-500/5 px-3 text-left text-xs font-medium text-violet-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-300">
            <span>{showAdditionalModelReferences ? "Masquer les autres références" : `Afficher les ${modelReferences.length - 1} autres références`}</span>
            <span aria-hidden="true" className={`text-lg leading-none transition-transform duration-200 ${showAdditionalModelReferences ? "rotate-180" : "rotate-0"}`}>⌄</span>
          </button>
          {showAdditionalModelReferences ? <div className="space-y-2 border-t border-violet-500/15 pt-2">{modelReferences.slice(1).map((reference, index) => <ModelReferenceCard key={reference.id} reference={reference} rank={index + 2} onOpenDetails={(source) => onOpenDetails(source, "model")} />)}</div> : null}
        </> : null}
      </div> : <div className="rounded-xl border border-dashed border-violet-500/20 px-4 py-5 text-center text-sm text-slate-500">{modelStatus}</div>}
    </div>
    {criteriaError && !criteria ? <p role="status" className="mt-3 text-xs text-amber-200">Critères de classement momentanément indisponibles.</p> : null}
    {criteria && <div className="rounded-2xl border border-slate-800 bg-[#10131a] p-4"><h2 className="mb-3 font-semibold text-white">Critères de classement</h2>{criteria.ordering ? <p className="mb-3 text-[11px] leading-relaxed text-slate-400">{criteria.ordering}</p> : null}<div className="grid grid-cols-2 gap-2">{criteria.criteria.map((criterion: any) => <div key={criterion.name} className="flex items-center gap-2"><span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-blue-500/10 text-xs font-bold text-blue-300">{criterion.weight}%</span><span><span className="block text-xs font-medium text-slate-200">{criterion.name}</span><span className="block text-[10px] leading-tight text-slate-500">{criterion.description}</span></span></div>)}</div><div className="mt-4 border-t border-slate-800 pt-3"><h3 className="text-xs font-semibold text-slate-100">Priorités techniques fixes par réseau/source — pas des scores météo</h3><div className="mt-2 flex flex-wrap gap-2">{criteria.sources.map((source: any) => <span key={source.id} className="rounded-lg border border-slate-700 bg-slate-950/40 px-2.5 py-1.5 text-[10px] text-slate-200">{source.name} · {source.sourcePriorityScore}/100</span>)}</div><p className="mt-2 text-[10px] leading-relaxed text-slate-400">Ces valeurs codées par origine servent aux heuristiques de classement et de pondération existantes; elles ne mesurent ni la précision météorologique ni la performance de cette station. Une performance individuelle n’est publiée que si des comparaisons physiques entre réseaux distincts et un prior empirique propre au réseau sont suffisants. Le profil opérationnel (complétude, continuité, stabilité) reste une information distincte.</p></div></div>}
    </details>
  </section>;
}

function Metric({ label, value, icon, color }: { label: string; value: string; icon: any; color: string }) {
  return <div className="min-w-0 border-r border-slate-800 last:border-0 px-2 first:pl-0 last:pr-0"><MeteoIcon name={icon} size={16} className={color} /><p className="mt-1 truncate text-[10px] text-slate-500">{label}</p><p className="mt-0.5 text-sm font-bold text-white">{value}</p></div>;
}

function Reading({ label, value }: { label: string; value: string }) {
  return <div><p className="text-[10px] text-slate-500">{label}</p><p className="mt-0.5 text-xs font-medium text-slate-200">{value}</p></div>;
}

/** Même grille mobile, avec la couverture physique propre à chaque variable. */
export function StationSummaryReadings({groundTruth}:{groundTruth:any}) {
  const fields=[['temperature','Température','°C',1],['humidity','Humidité','%',0],['pressure','Pression',' hPa',0],['windSpeed','Vent',' km/h',1],['windGust','Rafales',' km/h',1],['precipitation','Précip. (1 h)',' mm',1]] as const;
  return <div className="mt-3 grid grid-cols-3 gap-2">{fields.map(([field,label,unit,decimals])=>{
    const reading=groundTruth?.[field],coverage=stationSummaryCoverage(groundTruth,field);
    const known=typeof reading==='number'&&Number.isFinite(reading)&&coverage.count>0;
    const time=(at:number|null)=>at===null?'—':new Date(at).toLocaleTimeString('fr-FR',{timeZone:'Europe/Paris',hour:'2-digit',minute:'2-digit'});
    return <div key={field} className="min-w-0" title={known?`Mesures Netatmo : ${time(coverage.oldestAt)}–${time(coverage.newestAt)} (Paris)`:'Aucune observation physique admissible pour cette variable'}><Reading label={label} value={known?`${reading.toFixed(decimals)}${unit}`:'—'} /><p className="mt-1 text-[9px] leading-tight text-slate-400">{known?`Netatmo · ${coverage.count} station${coverage.count>1?'s':''}`:'Aucune mesure admissible'}</p></div>;
  })}</div>;
}

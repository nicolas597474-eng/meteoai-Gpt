/**
 * WeatherDetails — Page de prévisions météo ultra-détaillées
 * Sections: prévisions unifiées par jour/heure, carte météo et historique vérifié
 */
import { useState, useEffect } from "react";
import { trpc } from "@/lib/trpc";
import { MeteoIcon } from "@/components/MeteoIcon";
import { Skeleton } from "@/components/ui/skeleton";
import { WeatherAILoader } from "@/components/weather/WeatherAILoader";
import { useLocation } from "@/contexts/LocationContext";
import { usePageWeatherSky } from "@/hooks/usePageWeatherSky";
import { MeteoSurface } from "@/components/weather/MeteoSurface";
import { ForecastByDaySection } from "@/components/weather/ForecastByDaySection";
import { BackToTopButton } from "@/components/BackToTopButton";
import { WEATHER_QUERY_SLOW_MS } from "@/lib/weatherQueryRecovery";
import { WindyMap } from "@/components/WindyMap";
import { Link } from "wouter";
import { DEFAULT_OFFICIAL_FORECAST_LOCATION, getActiveOfficialForecastHour } from "@/lib/officialForecast";
import { useOfficialForecast } from "@/hooks/useOfficialForecast";
import { useCurrentStationTemperature } from "@/hooks/useCurrentStationTemperature";
import { withCurrentStationTemperature } from "@/lib/currentStationTemperature";
import {selectForecastDetails,forecastDetailsNotice} from '@/lib/forecastDetailsState';
import {offlineForecastStatus} from '@/lib/forecastOffline';
import {requestForecastReload} from '@/lib/forecastRefreshRequest';

// ─── Main Component ─────────────────────────────────────────────────────────

export default function WeatherDetails() {
  const { activeLocation } = useLocation();
  const { style: pageSkyStyle } = usePageWeatherSky();
  const { query: essentialForecastQuery, coordinates } = useOfficialForecast(activeLocation);
  const { data: essentialForecast, isLoading: essentialLoading, isError: essentialError, error: essentialForecastError, refetch: refetchEssentialForecast } = essentialForecastQuery;
  const { query: detailedForecastQuery } = useOfficialForecast(activeLocation, {
    includeExtendedPeriods: true,
    enabled: !!essentialForecast,
  });
  const stationTemperature = useCurrentStationTemperature(coordinates);
  const { data: detailedForecast, isFetching: detailedFetching, error: detailedForecastError, refetch: refetchDetailedForecast } = detailedForecastQuery;
  const data = selectForecastDetails(essentialForecast, detailedForecast);
  const isLoading = essentialLoading;
  const isFetching = essentialForecastQuery.isFetching || detailedFetching;
  const [,updateCacheStatus] = useState(0);
  useEffect(()=>{
    const update=()=>updateCacheStatus(version=>version+1);
    window.addEventListener('meteoai-offline-status',update);
    return ()=>window.removeEventListener('meteoai-offline-status',update);
  },[]);
  const cacheReasons=[false,true].map(extended=>offlineForecastStatus.get(JSON.stringify(['weather.getDetailedForecast',coordinates.lat,coordinates.lon,extended]))?.reason);
  const notice=forecastDetailsNotice(data,{busy:isFetching||cacheReasons.includes('refreshing'),failed:!!essentialForecastError||!!detailedForecastError||cacheReasons.includes('unavailable'),offline:cacheReasons.includes('offline')});
  const isError = essentialError && !essentialForecast;
  const error = essentialForecastError;
  const refetch = async () => {
    requestForecastReload(coordinates.lat,coordinates.lon);
    await refetchEssentialForecast();
    if (essentialForecast) await refetchDetailedForecast();
  };
  const isEnrichingDiagnostics = !!essentialForecast && detailedFetching && !detailedForecast;
  const [slowLoad, setSlowLoad] = useState(false);
  useEffect(() => {
    if (!isLoading && !isFetching) {
      setSlowLoad(false);
      return;
    }
    const timeout = window.setTimeout(() => setSlowLoad(true), WEATHER_QUERY_SLOW_MS);
    return () => window.clearTimeout(timeout);
  }, [isLoading, isFetching]);

  const activeOfficialHour = data?.hours
    ? getActiveOfficialForecastHour(data.hours, Date.now())
    : null;
   if (isLoading) {
     return (
       <div role="status" aria-live="polite" aria-busy="true" aria-label="Chargement des prévisions" className="weather-page-sky min-h-dvh w-full overflow-x-clip bg-[#0d1117]" style={pageSkyStyle}>
         <div className="mx-auto w-full min-w-0 max-w-none px-1 pt-[max(env(safe-area-inset-top),0.25rem)] sm:max-w-2xl sm:px-3 sm:py-4">
           {slowLoad && <div role="status" className="mb-4 min-w-0 w-full max-w-full rounded-2xl border border-amber-300/20 bg-amber-300/[0.06] px-3 py-2 text-xs leading-relaxed text-amber-100">La source météo met plus de temps que prévu. MeteoAI réessaie uniquement les erreurs temporaires.</div>}
           <WeatherAILoader loading={true} message="Chargement des prévisions" variant="full" />
         </div>
       </div>
     );
   }

  if (isError || !data) {
    const isTimeout = /timeout|délai|aborted/i.test(error?.message ?? "");
    return <div className="weather-page-sky min-h-dvh w-full overflow-x-clip bg-[#0d1117]" style={pageSkyStyle}><div className="mx-auto w-full min-w-0 max-w-none px-1 pt-[max(env(safe-area-inset-top),0.25rem)] sm:max-w-2xl sm:px-3 sm:py-5"><MeteoSurface tone="default" className="min-w-0 w-full max-w-full rounded-2xl border border-amber-300/25 bg-amber-300/[0.06] p-3 text-center sm:rounded-[24px] sm:p-5"><MeteoIcon name="refresh" size={26} /><h1 className="mt-3 text-base font-semibold text-white">Prévisions temporairement indisponibles</h1><p className="mx-auto mt-2 max-w-sm text-xs leading-relaxed text-slate-300">{isTimeout ? "Le délai de la source météo a été dépassé après les réessais autorisés." : "La prévision ne peut pas être chargée pour le moment. Aucune donnée n’est remplacée ou inventée."}</p><button type="button" onClick={() => void refetch()} disabled={isFetching} className="mt-4 min-h-10 rounded-xl border border-sky-300/40 bg-sky-300/10 px-4 text-xs font-semibold text-sky-100 disabled:opacity-50">{isFetching ? "Nouvel essai…" : "Réessayer"}</button></MeteoSurface></div><BackToTopButton /></div>;
  }

  const hours = data.hours ?? [];
  const currentHourIdx = activeOfficialHour?.index ?? -1;
  const displayHours = withCurrentStationTemperature(hours, currentHourIdx, stationTemperature);

  return (
    <div className="weather-page-sky forecast-details-page page-content-enter min-h-dvh w-full overflow-x-clip bg-[#061426]" style={pageSkyStyle}>
      <div className="mx-auto w-full min-w-0 max-w-none space-y-3 px-4 pt-[max(env(safe-area-inset-top),0.25rem)] pb-24 sm:max-w-2xl sm:space-y-5 sm:px-3 sm:py-4 sm:pb-28">
        {notice && (
          <div role="status" className="rounded-xl border border-amber-300/25 bg-amber-300/[0.06] p-3 text-xs text-amber-100">
            <p>{notice.message}</p>
            <button type="button" disabled={notice.busy} onClick={() => void refetch()} className="mt-2 min-h-10 rounded-lg border border-amber-300/30 px-3 font-semibold disabled:opacity-50">{notice.button}</button>
          </div>
        )}
        <ForecastByDaySection
          locationName={activeLocation?.name ?? DEFAULT_OFFICIAL_FORECAST_LOCATION.name}
          hours={displayHours}
          activeHourMeasurementLabel={stationTemperature?.provenanceLabel ?? null}
          dailyDays={data.days ?? []}
          dailySources={data.modelsUsed ?? []}
          activeHourIndex={currentHourIdx}
          hourlyWeighting={data.officialSnapshot?.hourlyWeighting}
          officialProvenance={{
            source: data.officialSnapshot?.source,
            sourceKind: data.officialSnapshot?.sourceKind,
            computedAt: data.officialSnapshot?.computedAt,
            hourlyComputedAt: data.officialSnapshot?.hourlyComputedAt,
          }}
        />
        {isEnrichingDiagnostics && <p role="status" className="rounded-xl border border-sky-300/20 bg-sky-300/[0.05] px-3 py-2 text-[11px] text-sky-100">Les valeurs essentielles sont affichées. Les diagnostics horaires détaillés se complètent en arrière-plan.</p>}
        {detailedForecastError && !detailedForecast && <p role="status" className="rounded-xl border border-amber-300/20 bg-amber-300/[0.05] px-3 py-2 text-[11px] text-amber-100">Les diagnostics détaillés ne sont pas encore disponibles ; les prévisions essentielles affichées restent utilisables.</p>}

        {/* ═══ SECTION : CARTE MÉTÉO ANIMÉE ═══ */}
        <MeteoSurface as="section" tone="default" className="min-w-0 w-full max-w-full rounded-2xl border border-white/10 bg-[rgba(26,48,70,0.56)] p-2 sm:rounded-[26px] sm:p-4">
          <div className="mb-3 flex items-center gap-2.5">
            <span className="weather-icon-bare grid h-10 w-10 place-items-center rounded-2xl border border-sky-200/20 bg-sky-300/10 text-lg">🌍</span>
            <div>
              <p className="text-[9px] font-semibold uppercase tracking-[0.2em] text-sky-100/55">Temps réel</p>
              <h2 className="mt-0.5 text-lg font-semibold tracking-tight text-white">Carte météorologique</h2>
            </div>
          </div>
          {activeLocation ? (
            <WindyMap lat={activeLocation.lat} lon={activeLocation.lon} locationName={activeLocation.name} favoriteId={activeLocation.favoriteId} />
          ) : (
            <p className="text-xs text-slate-400">Sélectionnez un lieu favori pour afficher la carte météo.</p>
          )}
        </MeteoSurface>

        <MeteoSurface as="section" tone="default" className="min-w-0 w-full max-w-full rounded-2xl border border-emerald-400/35 bg-emerald-400/[0.06] p-2 shadow-[0_0_24px_rgba(52,211,153,0.08)] sm:rounded-[24px] sm:p-3">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2"><span className="weather-icon-bare grid h-8 w-8 place-items-center rounded-full border border-emerald-300/25 bg-emerald-400/10"><MeteoIcon name="calendar" size={15} /></span><h2 className="text-sm font-semibold text-white">Historique des prévisions</h2></div>
              <p className="mt-2 text-[11px] leading-relaxed text-slate-300">Graphiques, observations archivées et comparaisons par modèle.</p>
            </div>
            <Link href="/history" className="shrink-0 rounded-xl border border-emerald-300/70 bg-emerald-400/10 px-3 py-2 text-xs font-semibold text-emerald-100 transition-colors hover:bg-emerald-400/20 active:scale-[0.97]">Ouvrir <span aria-hidden="true">→</span></Link>
          </div>
        </MeteoSurface>

      </div>
      <BackToTopButton />
    </div>
  );
}

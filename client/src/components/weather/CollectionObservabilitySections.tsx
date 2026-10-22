import { useEffect, useMemo, useRef, useState } from "react";
import { Activity, ChevronDown, X } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useLocation } from "@/contexts/LocationContext";
import { useOfficialForecast } from "@/hooks/useOfficialForecast";
import { countArchivedSnapshotSlots, formatCollectionDuration } from "@/lib/collectionHealth";
import { formatCollectionTimestamp } from "@/lib/collectionTimestamp";
import { getDashboardObservability } from "@/lib/dashboardObservability";
import { formatDashboardNumber } from "@/lib/dashboardPresentation";
import { DEFAULT_OFFICIAL_FORECAST_LOCATION, getOfficialForecastCoordinates } from "@/lib/officialForecast";
import { trpc } from "@/lib/trpc";
import type { OfficialRegimeInputDiagnostic, RegimeInputStatus } from "@shared/regimeInputDiagnostics";

type HourlyCollectionTrace = {
  status: "stored" | "no_station" | "failed" | "missing";
  date: string;
  hour: number;
  attempts: number|null;
  stationCount: number;
  reason?: string | null;
};

type ForecastRunStatus = "completed" | "partial" | "failed";

const regimeInputStatusLabels: Record<RegimeInputStatus, string> = {
  available: "Disponible",
  missing: "Absente",
  invalid: "Invalide",
  stale: "Périmée",
};

function formatCollectionDateTime(value: string | Date | null | undefined): string {
  return value ? formatCollectionTimestamp(value) : "Aucun succès vérifiable";
}

function hourlyCollectionPresentation(trace: HourlyCollectionTrace) {
  if (trace.status === "stored" && trace.reason?.startsWith("Archivé via la reprise automatique")) return { label: "Archivé via reprise", className: "border-cyan-300/25 bg-cyan-300/10 text-cyan-100" };
  if (trace.status === "stored") return { label: "Données archivées", className: "border-emerald-300/25 bg-emerald-300/10 text-emerald-100" };
  if (trace.status === "no_station") return { label: "Aucune station qualifiée", className: "border-amber-300/25 bg-amber-300/10 text-amber-100" };
  if (trace.status === "missing") return { label: "Créneau sans trace", className: "border-orange-300/25 bg-orange-300/10 text-orange-100" };
  return { label: "Erreur technique", className: "border-red-300/25 bg-red-300/10 text-red-100" };
}

function hourlyCollectionMoment(trace: HourlyCollectionTrace) {
  return `${new Date(`${trace.date}T12:00:00`).toLocaleDateString("fr-FR", { day: "numeric", month: "short", timeZone: "Europe/Paris" })} · ${String(trace.hour).padStart(2, "0")} h`;
}

/**
 * Deux sections de traçabilité affichées en bas de la page Stations :
 * la santé du dernier lot global (job planifié, distinct des relevés physiques)
 * et la couverture du lieu choisi (entrées réellement retenues pour le régime).
 * Le Dashboard ne les affiche plus afin d’éviter un doublon.
 */
export function CollectionObservabilitySections() {
  const { activeLocation } = useLocation();
  const [isCollectionHealthOpen, setIsCollectionHealthOpen] = useState(false);
  const [collectionUpdateNotice, setCollectionUpdateNotice] = useState<HourlyCollectionTrace | null>(null);
  const latestCollectionTraceKeyRef = useRef<string | null>(null);
  const selectedLocationLabel = activeLocation?.name ?? DEFAULT_OFFICIAL_FORECAST_LOCATION.name;
  const coordsInput = useMemo(
    () => ({ ...getOfficialForecastCoordinates(activeLocation) }),
    [activeLocation?.lat, activeLocation?.lon],
  );
  // Même contrat officiel que le Dashboard et la page Prévisions : le diagnostic
  // de couverture décrit les entrées réellement retenues, jamais une estimation.
  const { query: officialForecastQuery } = useOfficialForecast(activeLocation);
  const officialRegime = (officialForecastQuery.data as { regime?: { inputDiagnostics?: unknown } } | undefined)?.regime ?? null;
  const { data: collectionHealthReport,isLoading:collectionLoading,isError:collectionError } = trpc.weather.getForecastCollectionReport.useQuery(
    coordsInput,
    {
      staleTime: 15_000,
      refetchInterval: 60_000,
      refetchIntervalInBackground: false,
      refetchOnWindowFocus: true,
    }
  );
  const hourlyCollectionHistory = (collectionHealthReport?.hourlyHistory ?? []) as HourlyCollectionTrace[];
  const archivedSnapshotSlots = countArchivedSnapshotSlots(hourlyCollectionHistory);
  const technicalFailureStreak = collectionHealthReport?.technicalFailureStreak ?? null;
  const serviceDescription=(collectionHealthReport as unknown as {collectionService?:{description?:string}}|undefined)?.collectionService?.description;
  const latestHourlyCollection = hourlyCollectionHistory[0] ?? null;
  const latestForecastRun = collectionHealthReport?.lastForecastRun ?? null;
  const latestForecastRunStatus: ForecastRunStatus | null = latestForecastRun?.status === "failed"
    ? "failed"
    : latestForecastRun?.status === "partial"
      ? "partial"
      : latestForecastRun?.status === "completed"
        ? "completed"
        : null;
  const latestForecastSuccessAt = collectionHealthReport?.lastForecastSuccess?.collectedAt ?? null;
  const latestForecastSuccessDurationMs = collectionHealthReport?.lastForecastSuccess?.status === "completed" && latestForecastRun?.status === "completed" && latestForecastSuccessAt && latestForecastRun.collectedAt
    && new Date(latestForecastSuccessAt).getTime() === new Date(latestForecastRun.collectedAt).getTime()
    ? latestForecastRun.durationMs
    : null;
  const latestCollectionTraceKey = latestHourlyCollection
    ? [
        latestHourlyCollection.date,
        latestHourlyCollection.hour,
        latestHourlyCollection.status,
        latestHourlyCollection.stationCount,
        latestHourlyCollection.attempts,
        latestHourlyCollection.reason ?? "",
      ].join("|")
    : null;
  const regimeInputDiagnostics = Array.isArray(officialRegime?.inputDiagnostics)
    ? officialRegime.inputDiagnostics as OfficialRegimeInputDiagnostic[]
    : null;
  const dashboardObservability = getDashboardObservability({
    selectedLocationLabel,
    selectedLocationRegimeInputs: regimeInputDiagnostics,
    latestGlobalBatchStatus: latestForecastRunStatus,
    latestGlobalBatchAt: latestForecastRun?.collectedAt ?? null,
  });
  const regimeInputCoverage = dashboardObservability.selectedLocationCoverage;
  const collectionHealth = dashboardObservability.latestGlobalBatchHealth;

  useEffect(() => {
    latestCollectionTraceKeyRef.current = null;
    setCollectionUpdateNotice(null);
  }, [coordsInput.lat, coordsInput.lon]);

  useEffect(() => {
    if (!latestCollectionTraceKey || !latestHourlyCollection) return;
    const previousKey = latestCollectionTraceKeyRef.current;
    latestCollectionTraceKeyRef.current = latestCollectionTraceKey;
    if (previousKey && previousKey !== latestCollectionTraceKey && latestHourlyCollection.status !== "missing") {
      setCollectionUpdateNotice(latestHourlyCollection);
    }
  }, [latestCollectionTraceKey, latestHourlyCollection]);

  return (
    <>
      <section className="mb-4 rounded-2xl border border-slate-800 bg-[#10131a] p-3" aria-labelledby="collection-health-title">
        <div className="mb-3 min-w-0">
          <h2 id="collection-health-title" className="text-sm font-semibold text-white">Santé du dernier lot global</h2>
          <p className="mt-1 text-[11px] leading-relaxed text-slate-400">Le statut du dernier lot de prévisions est global ; les créneaux physiques détaillés concernent {selectedLocationLabel}.</p>
        </div>
        <button type="button" onClick={() => setIsCollectionHealthOpen(true)} aria-haspopup="dialog" aria-expanded={isCollectionHealthOpen} aria-controls="collection-health-panel" aria-label={`Ouvrir l’historique des collectes : ${collectionHealth.detail}`} className={`flex min-h-11 w-full items-center justify-between gap-2 rounded-xl border px-3 py-2 text-left shadow-sm transition-colors hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300 ${collectionHealth.tone}`}>
          <span className="flex min-w-0 items-center gap-2"><span className={`h-2.5 w-2.5 shrink-0 rounded-full ${collectionHealth.dot}`} aria-hidden="true" /><span className="min-w-0"><span className="block text-[9px] font-semibold uppercase tracking-[0.12em] opacity-75">Santé du dernier lot global</span><strong className="block truncate text-[11px]">{collectionLoading?"Chargement du bilan…":collectionError?"Bilan indisponible":collectionHealth.label}</strong><span className="block truncate text-[9px] opacity-80">{collectionLoading?"Lecture des archives en cours":collectionError?"Aucune absence de données ne peut être conclue":collectionHealth.detail}</span>{collectionUpdateNotice && <span className="mt-0.5 flex items-center gap-1 text-[9px] font-semibold text-cyan-100" role="status" aria-live="polite"><Activity className="h-3 w-3 shrink-0" aria-hidden="true" />Trace · {hourlyCollectionMoment(collectionUpdateNotice)} · {hourlyCollectionPresentation(collectionUpdateNotice).label}</span>}</span></span><span className="shrink-0 text-[9px] font-semibold text-white/80">Détails&nbsp;→</span>
          <span className="shrink-0 text-right text-[9px] leading-tight opacity-85">{collectionHealthReport&&hourlyCollectionHistory.length ? `${archivedSnapshotSlots}/${hourlyCollectionHistory.length}` : "—"}<br />créneaux archivés pour ce lieu</span>
        </button>
        {serviceDescription&&<p className="mt-2 text-[10px] leading-relaxed text-slate-400">{serviceDescription}</p>}
      </section>

      <details className="mb-4 rounded-2xl border border-slate-800 bg-[#10131a] p-3">
        <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 text-sm font-semibold text-white [&::-webkit-details-marker]:hidden">
          <span>Couverture du lieu choisi · {dashboardObservability.selectedLocationLabel} · {regimeInputCoverage.status === "unavailable" ? "diagnostic indisponible" : `${regimeInputCoverage.available}/${regimeInputCoverage.total} disponibles`}</span>
          <ChevronDown className="h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />
        </summary>
        <div className="mt-3 space-y-1.5" aria-label="Entrées réellement retenues pour le régime">
          <p className="text-[10px] leading-relaxed text-slate-400">Valeurs exactes retenues pour ce calcul ; elles ne prouvent pas, à elles seules, la cause d’un régime indisponible.</p>
          {regimeInputDiagnostics?.length ? regimeInputDiagnostics.map((input) => {
            const sourceTime = formatCollectionTimestamp(input.sourceUpdatedAt);
            const validityTime = input.validAt && input.validAt !== input.sourceUpdatedAt
              ? ` · validité ${formatCollectionTimestamp(input.validAt)}`
              : "";
            const sourceAge = input.sourceAgeMinutes == null ? "âge inconnu" : `âge ${input.sourceAgeMinutes} min`;
            return (
              <div key={input.key} className="rounded-lg border border-slate-800 bg-black/20 px-2.5 py-2">
                <div className="flex flex-wrap items-baseline justify-between gap-x-2">
                  <span className="text-[11px] font-semibold text-slate-100">{input.label}</span>
                  <span className="text-[11px] font-medium text-slate-200">
                    {regimeInputStatusLabels[input.status]} · {input.value == null ? "—" : `${formatDashboardNumber(input.value)} ${input.unit}`}
                  </span>
                </div>
                <p className="mt-0.5 break-words text-[10px] leading-relaxed text-slate-400">{input.sourceLabel ?? "Source indisponible"} · source {sourceTime}{validityTime} · {sourceAge}</p>
              </div>
            );
          }) : <p className="text-[10px] text-slate-400">Diagnostic détaillé des valeurs sélectionnées indisponible.</p>}
        </div>
      </details>

      <Dialog open={isCollectionHealthOpen} onOpenChange={setIsCollectionHealthOpen}>
        <DialogContent id="collection-health-panel" showCloseButton={false} className="max-h-[calc(100dvh-1rem)] overflow-y-auto border-slate-700 bg-[#10131a] p-4 text-slate-100 sm:max-w-xl" aria-label="Santé des collectes automatiques">
          <DialogHeader><div className="flex items-start justify-between gap-3"><div><DialogTitle className="text-white">Santé des collectes</DialogTitle><p className="mt-1 text-[11px] leading-relaxed text-slate-400">Les 24 derniers créneaux physiques pour ce lieu. Une absence de station qualifiée n’est pas une erreur technique ; un créneau sans trace est affiché explicitement.</p></div><button type="button" onClick={() => setIsCollectionHealthOpen(false)} aria-label="Fermer l’historique des collectes" className="weather-icon-bare grid h-8 w-8 shrink-0 place-items-center rounded-full border border-slate-600 text-slate-300 hover:bg-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300"><X className="h-4 w-4" /></button></div></DialogHeader>
          <p className="mt-2 text-[10px] leading-relaxed text-slate-400">Le statut du dernier lot est global; snapshots de couverture et créneaux physiques ci-dessous concernent <strong>{selectedLocationLabel}</strong>.</p>
          {collectionUpdateNotice && <div className="mt-3 flex items-center gap-2 rounded-xl border border-cyan-300/35 bg-cyan-400/10 px-3 py-2 text-cyan-50" role="status" aria-live="polite"><Activity className="h-4 w-4 shrink-0" aria-hidden="true" /><div><p className="text-[11px] font-semibold">Trace horaire mise à jour</p><p className="mt-0.5 text-[10px] text-cyan-100/80">Passage de {hourlyCollectionMoment(collectionUpdateNotice)} · {hourlyCollectionPresentation(collectionUpdateNotice).label}.</p></div></div>}
          <div className="mt-3 grid gap-2 sm:grid-cols-2"><div className="rounded-xl border border-white/10 bg-black/20 p-3"><p className="text-[10px] uppercase tracking-[0.12em] text-sky-200/75">Couverture du lieu choisi</p><p className="mt-1 text-sm font-semibold text-slate-100">{formatCollectionDateTime(collectionHealthReport?.lastForecastSuccess?.collectedAt)}</p><p className="mt-1 text-[10px] text-slate-400">{collectionHealthReport?.lastForecastSuccess?.status === "completed" ? "Dernier snapshot complet pour ce lieu" : collectionHealthReport?.lastForecastSuccess?.status === "partial" ? "Dernier snapshot partiel pour ce lieu" : collectionHealthReport?.lastForecastSuccess ? "Dernière capture locale vérifiée ; complétude indiquée dans AI Lab" : "Aucun snapshot local vérifiable"} · durée {formatCollectionDuration(latestForecastSuccessDurationMs)} · prochain passage global {collectionHealthReport?.nextForecastRun ? formatCollectionDateTime(collectionHealthReport.nextForecastRun) : "non connu"}.</p></div><div className="rounded-xl border border-white/10 bg-black/20 p-3"><p className="text-[10px] uppercase tracking-[0.12em] text-cyan-200/75">Stations physiques du lieu</p><p className="mt-1 text-sm font-semibold text-slate-100">{latestHourlyCollection ? hourlyCollectionMoment(latestHourlyCollection) : "Aucun passage vérifiable"}</p><p className="mt-1 text-[10px] text-slate-400">{technicalFailureStreak ? `${technicalFailureStreak} échec(s) technique(s) consécutif(s).` : "Série d’échecs techniques non déterminée."}</p></div></div>
          <div className="mt-3 space-y-2" aria-label="Deux dernières collectes globales de prévisions">
            <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-300">Deux derniers lots globaux de prévisions</p>
            <p className="text-[10px] leading-relaxed text-slate-400">Le total horaire exige une série archivée complète, sa projection attendue et le résultat du modèle dans le journal du lot. La couverture par lieu et les relevés physiques restent suivis séparément.</p>
            {(collectionHealthReport?.recentForecastRuns ?? []).length > 0 ? collectionHealthReport!.recentForecastRuns.map((run, index) => (
              <article key={`${run.startedAt}-${index}`} className="rounded-xl border border-white/10 bg-black/20 p-3">
                <div className="flex items-start justify-between gap-2">
                  <p className="text-[11px] font-semibold text-slate-100">{formatCollectionDateTime(run.startedAt)}</p>
                  <span className="shrink-0 text-[10px] font-medium text-slate-300">{run.status === "completed" ? "Terminée" : run.status === "partial" ? "Partielle" : run.status === "failed" ? "Échec" : "En cours"}</span>
                </div>
                <p className="mt-1 text-[10px] text-slate-400">Journalier {run.dailyModelsCollected}/{run.dailyModelsExpected} · horaire {run.hourlyModelsCollected}/{run.hourlyModelsExpected} · {run.locationsProcessed} lieu(x).</p>
                {run.errorMessage && <p className="mt-1 text-[10px] leading-relaxed text-amber-200/90">{run.errorMessage}</p>}
              </article>
            )) : <p className="rounded-xl border border-slate-700 bg-black/20 p-3 text-[10px] text-slate-400">Aucun reçu de lot global disponible dans cette lecture ; les captures météo sont suivies séparément.</p>}
          </div>
          <div className="mt-3 space-y-2" aria-label="Historique des 24 derniers créneaux horaires">{hourlyCollectionHistory.length ? hourlyCollectionHistory.map((trace) => { const presentation = hourlyCollectionPresentation(trace); return <article key={`${trace.date}-${trace.hour}`} className={`rounded-xl border p-3 ${presentation.className}`}><div className="flex items-start justify-between gap-2"><div className="min-w-0"><p className="text-[11px] font-semibold">{hourlyCollectionMoment(trace)} · {presentation.label}</p><p className="mt-1 text-[10px] leading-relaxed opacity-85">{trace.status === "stored" ? `${trace.stationCount} relevé(s) physique(s) archivé(s)${trace.attempts==null?" ; nombre de tentatives non archivé":` après ${trace.attempts} tentative${(trace.attempts??0) > 1 ? "s" : ""}`}.` : trace.status === "no_station" ? `Passage terminé après ${trace.attempts} tentative${(trace.attempts??0) > 1 ? "s" : ""} ; aucune station qualifiée.` : trace.status === "missing" ? "Le créneau est arrivé à échéance sans trace archivée ; la reprise automatique devait le rattraper." : `Échec après ${trace.attempts} tentative${(trace.attempts??0) > 1 ? "s" : ""}.`}{trace.reason ? ` ${trace.reason}` : ""}</p></div><span className="shrink-0 text-[10px] font-semibold">{trace.status === "stored" ? "✓" : trace.status === "no_station" ? "—" : trace.status === "missing" ? "?" : "!"}</span></div></article>; }) : <p className="rounded-xl border border-slate-700 bg-black/20 p-3 text-xs text-slate-400">Aucun passage horaire vérifiable disponible dans cette lecture.</p>}</div>
        </DialogContent>
      </Dialog>
    </>
  );
}

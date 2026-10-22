import { useEffect, useState } from "react";
import { trpc } from "@/lib/trpc";

type Coordinates = { lat: number; lon: number } | undefined;
type HistoryCursor = { validDate: string; id: number };
type HistoryFilters = {
  validDateFrom: string;
  validDateTo: string;
  serviceName: string;
  variable: string;
  horizonBucket: string;
};

const PAGE_SIZE = 25;
const EMPTY_FILTERS: HistoryFilters = {
  validDateFrom: "",
  validDateTo: "",
  serviceName: "",
  variable: "",
  horizonBucket: "",
};

const VARIABLE_META: Record<string, { label: string; unit: string }> = {
  temperature_max: { label: "Température maximale", unit: "°C" },
  temperature_min: { label: "Température minimale", unit: "°C" },
  precipitation_sum: { label: "Précipitations cumulées", unit: "mm" },
  wind_speed_max: { label: "Vitesse maximale du vent", unit: "km/h" },
  wind_gust_max: { label: "Rafale maximale", unit: "km/h" },
};

const HORIZON_LABELS: Record<string, string> = {
  "0-6h": "0 à 6 h",
  "6-24h": "6 à 24 h",
  "1-3d": "1 à 3 jours",
  "4-7d": "4 à 7 jours",
  "8-15d": "8 à 15 jours",
};

function formatNumber(value: number): string {
  return new Intl.NumberFormat("fr-FR", { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(value);
}

function formatValidDate(value: string): string {
  return new Date(`${value}T12:00:00.000Z`).toLocaleDateString("fr-FR", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "Europe/Paris",
  });
}

export default function DailyPhysicalComparisonsPanel({ coordinates }: { coordinates: Coordinates }) {
  const [filters, setFilters] = useState<HistoryFilters>(EMPTY_FILTERS);
  const [cursorStack, setCursorStack] = useState<Array<HistoryCursor | undefined>>([undefined]);
  const cursor = cursorStack[cursorStack.length - 1];
  const dateRangeInvalid = Boolean(filters.validDateFrom && filters.validDateTo && filters.validDateFrom > filters.validDateTo);

  useEffect(() => {
    setCursorStack([undefined]);
  }, [coordinates?.lat, coordinates?.lon]);

  const queryInput = {
    lat: coordinates?.lat,
    lon: coordinates?.lon,
    validDateFrom: filters.validDateFrom || undefined,
    validDateTo: filters.validDateTo || undefined,
    serviceName: filters.serviceName || undefined,
    variable: filters.variable ? filters.variable as "temperature_max" | "temperature_min" | "precipitation_sum" | "wind_speed_max" | "wind_gust_max" : undefined,
    horizonBucket: filters.horizonBucket ? filters.horizonBucket as "0-6h" | "6-24h" | "1-3d" | "4-7d" | "8-15d" : undefined,
    cursor,
    pageSize: PAGE_SIZE,
  };
  const historyQuery = trpc.weather.dailyPhysicalComparisons.getHistory.useQuery(queryInput, {
    retry: false,
    refetchOnWindowFocus: false,
    staleTime: 60_000,
    enabled: !dateRangeInvalid,
  });

  function updateFilter<Key extends keyof HistoryFilters>(key: Key, value: HistoryFilters[Key]) {
    setFilters((current) => ({ ...current, [key]: value }));
    setCursorStack([undefined]);
  }

  function clearFilters() {
    setFilters(EMPTY_FILTERS);
    setCursorStack([undefined]);
  }

  return (
    <section className="mt-5 rounded-2xl border border-sky-400/20 bg-sky-400/[0.035] p-4" aria-labelledby="daily-physical-history-title">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.15em] text-sky-200/80">Preuves utilisées pour l’analyse des pondérations</p>
          <h2 id="daily-physical-history-title" className="mt-1 text-base font-semibold text-white">Comparaisons physiques quotidiennes</h2>
          <p className="mt-1 max-w-3xl text-xs leading-relaxed text-muted-foreground">
            Vue de la projection courante : une ligne par comparaison, utilisée pour les pondérations. Les révisions capturées sont conservées séparément et ne sont pas mélangées au scoring ; aucune version historique manquante n’est reconstruite. Open-Meteo Best Match reste une référence dérivée, pas un modèle indépendant.
          </p>
        </div>
        <span className="rounded-full border border-emerald-300/20 bg-emerald-300/[0.06] px-2.5 py-1 text-[10px] font-semibold text-emerald-100">Lecture seule · physique qualifiée</span>
      </div>

      <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
        <label className="text-[11px] text-muted-foreground">
          Date valide · depuis
          <input type="date" value={filters.validDateFrom} onChange={(event) => updateFilter("validDateFrom", event.target.value)} className="mt-1 block min-h-10 w-full rounded-lg border border-border bg-background px-2.5 text-xs text-foreground" />
        </label>
        <label className="text-[11px] text-muted-foreground">
          Date valide · jusqu’au
          <input type="date" value={filters.validDateTo} onChange={(event) => updateFilter("validDateTo", event.target.value)} className="mt-1 block min-h-10 w-full rounded-lg border border-border bg-background px-2.5 text-xs text-foreground" />
        </label>
        <label className="text-[11px] text-muted-foreground">
          Modèle archivé
          <select value={filters.serviceName} onChange={(event) => updateFilter("serviceName", event.target.value)} className="mt-1 block min-h-10 w-full rounded-lg border border-border bg-background px-2.5 text-xs text-foreground">
            <option value="">Tous les modèles</option>
            {historyQuery.data?.modelOptions.map((model) => (
              <option key={`${model.serviceName}-${model.modelId}`} value={model.serviceName}>
                {model.isDerivedReference ? `${model.serviceName} · référence dérivée` : model.serviceName}
              </option>
            ))}
          </select>
        </label>
        <label className="text-[11px] text-muted-foreground">
          Variable
          <select value={filters.variable} onChange={(event) => updateFilter("variable", event.target.value)} className="mt-1 block min-h-10 w-full rounded-lg border border-border bg-background px-2.5 text-xs text-foreground">
            <option value="">Toutes les variables</option>
            {Object.entries(VARIABLE_META).map(([value, meta]) => <option key={value} value={value}>{meta.label}</option>)}
          </select>
        </label>
        <label className="text-[11px] text-muted-foreground">
          Horizon archivé
          <select value={filters.horizonBucket} onChange={(event) => updateFilter("horizonBucket", event.target.value)} className="mt-1 block min-h-10 w-full rounded-lg border border-border bg-background px-2.5 text-xs text-foreground">
            <option value="">Tous les horizons</option>
            {Object.entries(HORIZON_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>
      </div>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
        <p className="text-[10px] text-muted-foreground">Lieu : {coordinates ? `${coordinates.lat.toFixed(3)}, ${coordinates.lon.toFixed(3)}` : "lieu par défaut"}. Le fournisseur de prévision enregistré est indiqué ; la source de l’observation n’est pas enregistrée.</p>
        <button type="button" onClick={clearFilters} className="min-h-9 rounded-lg border border-border px-3 text-[11px] font-medium text-sky-200 hover:bg-white/5">Effacer les filtres</button>
      </div>

      {dateRangeInvalid ? (
        <p role="alert" className="mt-3 rounded-xl border border-amber-300/20 bg-amber-300/[0.05] p-3 text-xs text-amber-100">La date de début doit être antérieure ou égale à la date de fin.</p>
      ) : historyQuery.isLoading ? (
        <p role="status" className="mt-3 rounded-xl border border-border bg-background/40 p-3 text-xs text-muted-foreground">Chargement de l’archive de production…</p>
      ) : historyQuery.error ? (
        <p role="alert" className="mt-3 rounded-xl border border-amber-300/20 bg-amber-300/[0.05] p-3 text-xs leading-relaxed text-amber-100">La lecture de l’historique a échoué. Aucune comparaison shadow n’est utilisée en remplacement.</p>
      ) : historyQuery.data?.status === "unavailable" ? (
        <div role="status" className="mt-3 rounded-xl border border-amber-300/20 bg-amber-300/[0.05] p-3 text-xs leading-relaxed text-amber-100">
          {historyQuery.data.reason === "table_unavailable" ? (
            <>L’archive de comparaisons physiques de production n’est pas accessible actuellement ; la cause de cette indisponibilité n’est pas déterminée. Aucune table Phase 8 shadow ne sert de substitut.</>
          ) : (
            <>La base de données n’est pas disponible ; aucune archive physique n’a pu être lue. Aucune table Phase 8 shadow ne sert de substitut.</>
          )}
        </div>
      ) : historyQuery.data?.status === "empty" ? (
        <p role="status" className="mt-3 rounded-xl border border-border bg-background/40 p-3 text-xs leading-relaxed text-muted-foreground">Aucune comparaison physique qualifiée ne correspond à ces filtres dans l’archive de production. Les résultats shadow ne sont ni mélangés ni affichés comme preuve de production.</p>
      ) : (
        <>
          <div className="mt-3 space-y-2">
            {historyQuery.data?.rows.map((row) => {
              const variable = VARIABLE_META[row.variable] ?? { label: row.variable, unit: "" };
              const signedError = Number(row.signedError);
              const absoluteError = Number(row.absoluteError);
              const modelLabel = row.modelId === "best_match"
                ? `${row.serviceName} · Best Match (référence dérivée)`
                : `${row.serviceName} · ${row.modelId}`;
              return (
                <article key={row.id} className="rounded-xl border border-border bg-background/45 p-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <h3 className="text-xs font-semibold text-white">{formatValidDate(row.validDate)} · {variable.label}</h3>
                      <p className="mt-0.5 text-[10px] text-sky-100">{modelLabel}</p>
                    </div>
                    <span className="rounded-full border border-white/10 px-2 py-0.5 text-[10px] text-slate-300">{HORIZON_LABELS[row.horizonBucket] ?? row.horizonBucket}</span>
                  </div>
                  <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-[10px] sm:grid-cols-3">
                    <p className="text-muted-foreground">Prévision <span className="font-mono text-foreground">{formatNumber(Number(row.forecastValue))} {variable.unit}</span></p>
                    <p className="text-muted-foreground">Observé <span className="font-mono text-foreground">{formatNumber(Number(row.observedValue))} {variable.unit}</span></p>
                    <p className="text-muted-foreground">Erreur signée <span className="font-mono text-foreground">{signedError > 0 ? "+" : ""}{formatNumber(signedError)} {variable.unit}</span></p>
                    <p className="text-muted-foreground">Erreur absolue <span className="font-mono text-foreground">{formatNumber(absoluteError)} {variable.unit}</span></p>
                    <p className="text-muted-foreground">Délai d’émission <span className="font-mono text-foreground">{row.leadTimeMinutes.toLocaleString("fr-FR")} min</span></p>
                    <p className="text-muted-foreground">Couverture physique <span className="font-mono text-foreground">{row.observationCoverageHours} h qualifiées</span></p>
                  </div>
                  <p className="mt-2 text-[9px] text-muted-foreground">Fournisseur de la prévision : {row.provider} · la source de l’observation physique n’est pas enregistrée.</p>
                </article>
              );
            })}
          </div>
          <div className="mt-3 flex items-center justify-between gap-2">
            <button type="button" disabled={cursorStack.length <= 1 || historyQuery.isFetching} onClick={() => setCursorStack((current) => current.slice(0, -1))} className="min-h-9 rounded-lg border border-border px-3 text-[11px] font-medium text-sky-200 disabled:cursor-not-allowed disabled:opacity-40">Précédent</button>
            <span className="text-[10px] text-muted-foreground">Page {cursorStack.length} · {PAGE_SIZE} lignes au maximum</span>
            <button type="button" disabled={!historyQuery.data?.hasMore || !historyQuery.data?.nextCursor || historyQuery.isFetching} onClick={() => {
              const nextCursor = historyQuery.data?.nextCursor;
              if (nextCursor) setCursorStack((current) => [...current, nextCursor]);
            }} className="min-h-9 rounded-lg border border-border px-3 text-[11px] font-medium text-sky-200 disabled:cursor-not-allowed disabled:opacity-40">Charger la suite</button>
          </div>
        </>
      )}
    </section>
  );
}

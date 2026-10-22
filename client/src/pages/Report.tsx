import { trpc } from "@/lib/trpc";
import { useState } from "react";
import { FileText, Thermometer, Droplets, Wind, Cloud } from "lucide-react";
import { useLocation } from "@/contexts/LocationContext";
import { MeteoSurface } from "@/components/weather/MeteoSurface";
import {archivedCalculationLabel} from '@/lib/archivedCalculation';
import {ArchiveReadNotice} from '@/components/weather/ArchiveReadNotice';

type DailyError = {
  comparisonCount: number;
  signedDifference: number | null;
  absoluteError: number | null;
};

function MetricCard({ icon, label, value, small = false }: { icon: React.ReactNode; label: string; value: string; small?: boolean }) {
  return <div className="space-y-1">
    <div className="flex items-center gap-1.5 text-muted-foreground text-xs">{icon}<span>{label}</span></div>
    <p className={`font-bold ${small ? "text-sm" : "text-lg"}`}>{value}</p>
  </div>;
}

function formatRange(measure: { min: number | null; max: number | null; range: number | null; standardDeviation: number | null }, unit: string) {
  if (measure.range == null || measure.min == null || measure.max == null) return measure.min == null ? "Aucune valeur disponible" : `Valeur unique ${measure.min.toFixed(1)} ${unit} ; étendue non calculable`;
  const deviation = measure.standardDeviation == null ? "σ population indisponible" : `σ population ${measure.standardDeviation.toFixed(1)} ${unit}`;
  return `${measure.min.toFixed(1)}–${measure.max.toFixed(1)} ${unit} · étendue ${measure.range.toFixed(1)} ${unit} · ${deviation}`;
}

function archivedValue(value:unknown,unit:string){return typeof value==='number'&&Number.isFinite(value)?`${value} ${unit}`:'—';}

function formatDailyError(error: DailyError | undefined, unit: string) {
  if (!error || error.comparisonCount === 0 || error.signedDifference == null || error.absoluteError == null) return "—";
  const sign = error.signedDifference > 0 ? "+" : "";
  return `Δ ${sign}${error.signedDifference.toFixed(1)} ${unit} · |Δ| ${error.absoluteError.toFixed(1)} ${unit}`;
}

export default function Report() {
  const { activeLocation } = useLocation();
  const [date] = useState(() => new Date().toLocaleDateString("en-CA", { timeZone: "Europe/Paris" }));
  const { data, isLoading, isError, refetch } = trpc.weather.getReport.useQuery({
    date,
    ...(activeLocation ? { lat: activeLocation.lat, lon: activeLocation.lon } : {}),
  }, { staleTime: 5 * 60 * 1000, refetchOnWindowFocus: false, retry: 1 });

  if(isError&&!data)return <div className="p-4 text-slate-200"><p role="alert">Le rapport archivé ne peut pas être lu.</p><button className="mt-3 rounded-xl border border-sky-300/40 p-3" onClick={()=>void refetch()}>Réessayer</button></div>;
  if (isLoading) {
    return <div className="min-h-screen bg-background p-4"><div className="max-w-3xl mx-auto space-y-4 animate-pulse"><div className="h-8 w-48 bg-muted rounded" /><div className="h-40 bg-muted rounded-xl" /><div className="h-64 bg-muted rounded-xl" /></div></div>;
  }

  const agreement = data?.modelAgreement;
  const independentForecasts = (data?.forecasts ?? []).map(f=>({...f,collectedAt:(f as {collectedAt?:string}).collectedAt})).filter((forecast) => forecast.serviceCategory === "expert" && forecast.serviceName !== "Open-Meteo");
  const observations = (data?.observationComparisons ?? []) as Array<{
    modelName: string;
    targetDate: string;
    horizonDays: number | null;
    temperatureMax: DailyError;
    temperatureMin: DailyError;
    precipitation: DailyError;
    windSpeed: DailyError;
    windGust: DailyError;
    cloudCover: DailyError;
  }>;

  const agreementRows = agreement ? [
    { label: "Température maximale", measure: agreement.tempMax, unit: "°C" },
    { label: "Température minimale", measure: agreement.tempMin, unit: "°C" },
    { label: "Pluie · toutes valeurs", measure: agreement.precipitation, unit: "mm" },
    { label: `Pluie · valeurs ≥${agreement.precipitationOccurrence.thresholdMm.toFixed(1)} mm`, measure: agreement.precipitationWetAmounts, unit: "mm" },
    { label: "Vent maximal journalier", measure: agreement.windSpeed, unit: "km/h" },
    { label: "Rafales", measure: agreement.windGust, unit: "km/h" },
  ] : [];

  return <div className="min-h-screen bg-background">
    <div className="max-w-3xl mx-auto px-3 py-4 space-y-4 sm:px-6 sm:py-8 sm:space-y-6">
      <header>
        <h1 className="text-xl sm:text-3xl font-bold tracking-tight flex items-center gap-2"><FileText className="h-6 w-6 sm:h-8 sm:w-8 text-primary" />Rapport détaillé</h1>
        <p className="text-muted-foreground mt-1 text-xs sm:text-sm">Prévisions et mesures pour le {data?.date ?? date} — {activeLocation?.name ?? "Position actuelle"}</p>
      </header>
      <ArchiveReadNotice data={data} onRetry={()=>void refetch()} />

      {data?.meteoAI && <MeteoSurface className="rounded-xl p-4 sm:p-6">
        <h2 className="text-base sm:text-lg font-semibold mb-3">Synthèse MeteoAI</h2>
        <p className="mb-3 text-xs text-muted-foreground">{archivedCalculationLabel((data.meteoAI as {computedAt?:unknown}).computedAt)}</p>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <MetricCard icon={<Thermometer className="h-4 w-4" />} label="Temp. max" value={data.meteoAI.tempMax == null ? "—" : `${data.meteoAI.tempMax} °C`} />
          <MetricCard icon={<Thermometer className="h-4 w-4" />} label="Temp. min" value={data.meteoAI.tempMin == null ? "—" : `${data.meteoAI.tempMin} °C`} />
          <MetricCard icon={<Droplets className="h-4 w-4" />} label="Précipitations" value={data.meteoAI.precipitation == null ? "—" : `${data.meteoAI.precipitation} mm`} />
          <MetricCard icon={<Wind className="h-4 w-4" />} label="Vent" value={data.meteoAI.windSpeed == null ? "—" : `${data.meteoAI.windSpeed} km/h`} />
        </div>
        {data.meteoAI.explanation && <p className="mt-3 rounded-lg bg-background/50 p-3 text-xs italic text-foreground/80">{data.meteoAI.explanation}</p>}
      </MeteoSurface>}

      {agreement && <MeteoSurface as="section" className="rounded-xl p-4 sm:p-6" aria-label="Accord inter-modèles par variable">
        <h2 className="text-base sm:text-lg font-semibold">Modèles reçus · statistiques descriptives</h2>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">Valeurs des modèles nommés pour la date cible. Best Match et agrégateurs exclus. Moyennes et extrêmes calculés sur les seules valeurs disponibles. Les heures d’émission ne sont pas documentées : aucun cycle ni horizon commun n’est garanti. Ces statistiques ne mesurent pas la fiabilité historique.</p>
        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
          {agreementRows.map(({ label, measure, unit }) => <MetricCard key={label} icon={label.includes("Température") ? <Thermometer className="h-4 w-4" /> : label.includes("Pluie") ? <Droplets className="h-4 w-4" /> : <Wind className="h-4 w-4" />} label={label} value={`${formatRange(measure, unit)} · ${measure.availableModelCount}/${agreement.expectedModelCount} modèles`} small />)}
        </div>
        <p className="mt-3 text-[10px] text-muted-foreground">Modèles indépendants attendus : {agreement.modelsExpected.join(", ") || "aucun"}. Nombre de modèles disponibles indiqué séparément pour chaque variable.</p>
        {agreement && <p className="mt-2 text-xs text-muted-foreground">Pluie au seuil ≥{agreement.precipitationOccurrence.thresholdMm.toFixed(1)} mm : {agreement.precipitationOccurrence.rainModelCount}/{agreement.precipitationOccurrence.availableModelCount} modèles disponibles ({agreement.precipitationOccurrence.availableModelCount}/{agreement.precipitationOccurrence.expectedModelCount} valeurs). Fréquence brute de modèles, non calibrée comme probabilité.</p>}
      </MeteoSurface>}

      {data?.observation && <MeteoSurface as="section" className="rounded-xl p-4 sm:p-6">
        <h2 className="text-base sm:text-lg font-semibold mb-3">Observations archivées</h2>
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          <MetricCard icon={<Thermometer className="h-4 w-4" />} label="Temp. max" value={archivedValue(data.observation.tempMax,"°C")} />
          <MetricCard icon={<Thermometer className="h-4 w-4" />} label="Temp. min" value={archivedValue(data.observation.tempMin,"°C")} />
          <MetricCard icon={<Droplets className="h-4 w-4" />} label="Précipitations" value={archivedValue(data.observation.precipitation,"mm")} />
          <MetricCard icon={<Wind className="h-4 w-4" />} label="Vent" value={archivedValue(data.observation.windSpeed,"km/h")} />
          <MetricCard icon={<Cloud className="h-4 w-4" />} label="Source" value={data.observation.source ?? "Non documentée"} small />
        </div>
      </MeteoSurface>}

      <MeteoSurface as="section" className="rounded-xl p-4 sm:p-6">
        <h2 className="text-base sm:text-lg font-semibold">Écarts du jour face aux observations</h2>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">Comparaison brute prévision archivée − observation physique pour cette seule date (n indiqué par cellule). Ce résultat ponctuel n’est ni une MAE historique ni une mesure de fiabilité; La dernière prévision admissible est retenue par modèle et variable ; les horizons peuvent différer. Best Match exclu.</p>
        {data?.observation && observations.length > 0 ? <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[740px] text-[10px] sm:text-xs">
            <thead><tr className="border-b border-border text-muted-foreground"><th className="p-2 text-left">Modèle</th><th className="p-2 text-right">Tmax</th><th className="p-2 text-right">Tmin</th><th className="p-2 text-right">Pluie</th><th className="p-2 text-right">Vent</th><th className="p-2 text-right">Rafales</th></tr></thead>
            <tbody>{observations.map((row) => <tr key={row.modelName} className="border-b border-border/50"><td className="p-2 font-medium">{row.modelName}</td><td className="p-2 text-right font-mono">{formatDailyError(row.temperatureMax, "°C")}</td><td className="p-2 text-right font-mono">{formatDailyError(row.temperatureMin, "°C")}</td><td className="p-2 text-right font-mono">{formatDailyError(row.precipitation, "mm")}</td><td className="p-2 text-right font-mono">{formatDailyError(row.windSpeed, "km/h")}</td><td className="p-2 text-right font-mono">{formatDailyError(row.windGust, "km/h")}</td></tr>)}</tbody>
          </table>
        </div> : <p className="mt-3 text-xs text-muted-foreground">Observation ou comparaison de cette date indisponible; aucun écart n’est fabriqué.</p>}
      </MeteoSurface>

      <MeteoSurface as="section" className="rounded-xl p-4 sm:p-6">
        <h2 className="text-base sm:text-lg font-semibold mb-3">Prévisions brutes des modèles nommés</h2>
        {independentForecasts.length > 0 ? <div className="overflow-x-auto"><table className="w-full min-w-[620px] text-xs">
          <thead><tr className="border-b border-border text-muted-foreground"><th className="p-2 text-left">Modèle</th><th className="p-2 text-right">Tmax</th><th className="p-2 text-right">Tmin</th><th className="p-2 text-right">Pluie</th><th className="p-2 text-right">Vent</th><th className="p-2 text-right">Rafales</th></tr></thead>
          <tbody>{independentForecasts.map((forecast) => <tr key={forecast.serviceName} className="border-b border-border/50"><td className="p-2 font-medium">{forecast.serviceName}<span className="block text-[9px] font-normal text-slate-400">Reçue : {forecast.collectedAt ? new Date(forecast.collectedAt).toLocaleString("fr-FR",{timeZone:"Europe/Paris"}) : "heure inconnue"} (Paris)</span></td><td className="p-2 text-right font-mono">{forecast.tempMax == null ? "—" : `${forecast.tempMax} °C`}</td><td className="p-2 text-right font-mono">{forecast.tempMin == null ? "—" : `${forecast.tempMin} °C`}</td><td className="p-2 text-right font-mono">{forecast.precipitation == null ? "—" : `${forecast.precipitation} mm`}</td><td className="p-2 text-right font-mono">{forecast.windSpeed == null ? "—" : `${forecast.windSpeed} km/h`}</td><td className="p-2 text-right font-mono">{forecast.windGust == null ? "—" : `${forecast.windGust} km/h`}</td></tr>)}</tbody>
        </table></div> : <p className="text-xs text-muted-foreground">Aucune prévision de modèle indépendant persistée pour cette date.</p>}
      </MeteoSurface>
    </div>
  </div>;
}

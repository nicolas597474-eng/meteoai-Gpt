import type { ReactNode } from 'react';
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { X } from 'lucide-react';
import { formatDashboardNumber, type CurrentStateFieldLike } from '@/lib/dashboardPresentation';
import { OBSERVATION_DETAILS, observationForecastDetail, observationForecastInstant, observationInstant, type ObservationDetailKey } from '@/lib/observationDetail';
import type { DashboardFusionTrace } from '@shared/dashboardFusionTrace';

/** Bouton natif : mêmes cartes, ouverture au toucher comme au clavier. */
export function ObservationDetailButton({ metric, onOpen, className, title, children }: {
  metric: ObservationDetailKey; onOpen: (key: ObservationDetailKey, trigger: HTMLButtonElement) => void;
  className: string; title?: string; children: ReactNode;
}) {
  return <button type="button" aria-haspopup="dialog" aria-label={`Détails : ${OBSERVATION_DETAILS[metric].label}`} onClick={event => onOpen(metric, event.currentTarget)} title={title}
    className={`${className} min-h-11 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white`}>{children}</button>;
}

/** Lecture seulement : les modèles restent des prévisions, les stations des mesures. */
export function DashboardObservationDetails({ metric, field, locationName, points, forecastValidAt, computedAt, stale, onClose, restoreFocus }: {
  metric: ObservationDetailKey | null; field: CurrentStateFieldLike | null; locationName: string;
  points: DashboardFusionTrace; forecastValidAt: number | null; computedAt: string | null; stale: boolean; onClose: () => void; restoreFocus: () => void;
}) {
  if (!metric) return null;
  const info = OBSERVATION_DETAILS[metric];
  const provenance = field?.provenance;
  const physical = provenance?.kind === 'physical_stations';
  const forecast = provenance?.kind === 'official_hourly_forecast';
  const { row, availableModels, spread } = observationForecastDetail(points, forecastValidAt, metric);
  const format = (value: number | null | undefined, unit = info.unit) => `${formatDashboardNumber(value, metric === 'precipitation' ? 2 : 1)}${typeof value === 'number' && Number.isFinite(value) && unit ? ` ${unit}` : ''}`;
  const value = typeof field?.value === 'number' && Number.isFinite(field.value) ? field.value : null;
  return <Dialog open onOpenChange={open => { if (!open) onClose(); }}>
    <DialogContent showCloseButton={false} onCloseAutoFocus={event => { event.preventDefault(); restoreFocus(); }} className="max-h-[85dvh] overflow-y-auto border-slate-600 bg-[#101923] p-4 text-slate-100 sm:max-w-lg">
      <DialogClose aria-label="Fermer le détail" className="absolute right-2 top-2 grid size-11 place-items-center rounded-lg text-slate-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"><X className="size-4" aria-hidden="true" /></DialogClose>
      <DialogHeader><DialogTitle className="pr-7 text-white">{info.label}</DialogTitle><DialogDescription className="text-slate-300">{locationName} · détail de la valeur affichée</DialogDescription></DialogHeader>
      <p className="text-3xl font-bold tabular-nums text-sky-200">{format(value)}</p>
      <p className="text-sm leading-relaxed text-slate-200">{info.explanation}</p>
      <section aria-label="Source de la valeur affichée" className="space-y-2 rounded-xl border border-slate-600/50 bg-black/20 p-3 text-xs leading-relaxed">
        <h3 className="font-semibold text-white">{value === null || !provenance || provenance.kind === 'unavailable' ? 'Valeur indisponible' : physical ? 'Mesure de stations physiques' : forecast ? 'Prévision horaire' : 'Snapshot courant du modèle'}</h3>
        <p>Source : {provenance?.stationSources.join(' + ') || 'Non documentée'}.</p>
        {physical && !provenance.observedAt && provenance.measurements.length > 0
          ? <p>Heures des mesures : chaque station conserve son horodatage, consultable ci-dessous.</p>
          : <p>{forecast ? 'Échéance' : physical ? 'Relevé source' : 'Instant du snapshot'} : {observationInstant(provenance?.observedAt)}.</p>}
        {forecast && <p>Calcul : {observationInstant(provenance?.computedAt)}.</p>}
        {!forecast && provenance?.ageMinutes != null && <p>Âge lors de la collecte : {provenance.ageMinutes} min{physical ? ' pour la plus ancienne mesure contributrice' : ''}.</p>}
        {physical && <p>{provenance?.stationCount ?? 0} station(s) contributrice(s). Les poids des modèles ci-dessous ne s’appliquent pas à cette mesure.</p>}
        {provenance?.reason && <p className="text-slate-300">{provenance.reason}</p>}
        {!!provenance?.measurements.length && <details><summary className="min-h-11 cursor-pointer content-center font-semibold text-sky-100">Stations et heures des relevés</summary><ul className="space-y-2">{provenance.measurements.map((measurement, index) => <li key={`${measurement.stationName}/${index}`} className="rounded-lg border border-slate-700 p-2"><p className="break-words text-white">{measurement.stationName} · {measurement.source}</p><p>{observationInstant(measurement.observedAt)}</p></li>)}</ul></details>}
      </section>
      <section aria-label="Prévision et modèles pour cette variable" className="min-w-0 space-y-2 rounded-xl border border-sky-400/20 bg-black/20 p-3 text-xs leading-relaxed">
        <h3 className="font-semibold text-white">Prévision des modèles · lecture séparée</h3>
        <p>Échéance : {observationInstant(observationForecastInstant(forecastValidAt))}.</p>
        <p>Calcul : {observationInstant(computedAt)}.{stale ? ' Dernière prévision mise en cache ; actualisation non confirmée.' : ''}</p>
        {!row ? <p role="status">Aucune trace de fusion reçue pour cette variable à cette heure. Aucune valeur d’une autre heure n’est substituée.</p> : <>
          <p className="font-semibold text-sky-100">Valeur finale prévue : {format(row.value)}.</p>
          <p>Écart entre les valeurs de modèles disponibles : {format(spread)} · {availableModels} modèle(s) avec une valeur.</p>
          <p className="text-amber-100">{row.status === 'CALIBRATED' ? 'Calibration historique qualifiée pour cette variable.' : row.status === 'PARTIALLY_CALIBRATED' ? 'Calibration historique partielle.' : 'Calibration historique indisponible. Aucun score de confiance ou MAE n’est déduit de l’accord entre modèles.'}</p>
          <ul aria-label="Valeurs et poids des modèles" className="space-y-2">{row.models.map(model => <li key={model.name} className="rounded-lg border border-slate-600/40 p-2"><div className="flex flex-wrap justify-between gap-2"><span className="font-semibold text-white">{model.name}</span><span>{format(model.value)} · {formatDashboardNumber(model.weight === null ? null : model.weight * 100, 2)} %</span></div>{!model.contributes && <p className="text-slate-400">Sans contribution à la valeur finale.</p>}</li>)}</ul>
          {row.precipitation && <p>{row.precipitation.rainModels}/{row.precipitation.availableModels} modèles dépassent le seuil de {format(row.precipitation.thresholdMm)}. Cette fréquence n’est pas une probabilité de pluie calibrée.</p>}
          {row.excluded.length > 0 && <p className="text-slate-400">Modèles exclus ou indisponibles à cette échéance : {row.excluded.map(model => model.name).join(', ')}.</p>}
        </>}
        <p className="text-slate-400">Les modèles décrivent une prévision à leur échéance, pas une mesure Netatmo. Best Match reste une référence séparée. Une différence avec la valeur affichée peut provenir de la source ou de la période considérée.</p>
      </section>
    </DialogContent>
  </Dialog>;
}

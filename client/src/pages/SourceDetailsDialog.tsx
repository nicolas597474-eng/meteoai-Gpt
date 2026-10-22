import React from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { formatSourceNumber as raw, formatSourceTimestamp, sourceDetailContribution, type SourceDetailsSelection } from "@shared/stationSourceDetails";

function SourceReading({ label, value }: { label: string; value: string }) {
  return <div className="min-w-0 rounded-lg border border-slate-800 bg-[#090b10] px-3 py-2"><p className="text-[10px] uppercase tracking-wide text-slate-500">{label}</p><p className="mt-1 text-sm font-medium text-slate-100">{value}</p></div>;
}

/** Même contenu dans la fenêtre et les vérifications de rendu. */
export function SourceDetailsContent({ selection, groundTruth }: { selection: SourceDetailsSelection; groundTruth: any }) {
  const source = selection?.source;
  if (!source) return null;
  const isModel = selection?.kind === "model";
  const {contribution, fieldWeights, temperatureUsed, exclusionReason} = sourceDetailContribution(selection, groundTruth);
  const participation = isModel
    ? "Référence de modèle : poids de fusion locale 0 %. Les prévisions restent séparées des observations physiques et ne modifient pas la température locale."
    : contribution
      ? "Station physique utilisée dans la synthèse locale. Sa contribution dépend de la mesure et des contrôles propres à cette mesure."
      : "Cette source ne participe pas au calcul local sur ce cycle : elle est absente, écartée ou ne passe pas les contrôles de qualité.";
  const coherence = isModel && typeof source.coherenceWeight === "number" && Number.isFinite(source.coherenceWeight) && source.coherenceWeight >= 0 && source.coherenceWeight <= 1
    ? `${Math.round(source.coherenceWeight * 100)} % (indicateur, pas un poids de fusion)`
    : "Aucune note publiée ; seul l’écart brut aux observations est présenté";

  return <div className="space-y-4">
    <section className="rounded-xl border border-blue-500/20 bg-blue-500/5 p-3">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-blue-200">Rôle dans la synthèse locale</h3>
      <p className="mt-1.5 text-sm leading-relaxed text-slate-200">{participation}</p>
      {exclusionReason ? <p className="mt-2 text-[11px] text-amber-200">Motif : {exclusionReason}</p> : null}
      {isModel && <p className="mt-2 text-[11px] text-violet-200">Cohérence locale : {coherence}</p>}
    </section>
    <section>
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">{isModel ? 'Prévisions brutes à l’échéance indiquée' : 'Données brutes du dernier relevé'}</h3>
      <div className="grid grid-cols-2 gap-2">
        <SourceReading label="Température" value={raw(source.temperature, " °C")} />
        <SourceReading label="Humidité" value={raw(source.humidity, " %", 0)} />
        <SourceReading label="Pression" value={raw(source.pressure, " hPa", 0)} />
        <SourceReading label="Vent" value={raw(source.windSpeed, " km/h")} />
        <SourceReading label="Rafales" value={raw(source.windGust, " km/h")} />
        <SourceReading label="Direction" value={raw(source.windDirection, "°", 0)} />
        <SourceReading label="Précipitations (1 h)" value={raw(source.precipitation, " mm")} />
        <SourceReading label="Altitude" value={raw(source.altitude, " m", 0)} />
      </div>
    </section>
    <section className="rounded-xl border border-slate-800 bg-[#090b10] p-3">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400">Provenance et fraîcheur</h3>
      <dl className="mt-2 space-y-1.5 text-xs">
        <div className="flex justify-between gap-4"><dt className="text-slate-500">Identifiant</dt><dd className="min-w-0 break-all text-right text-slate-200">{source.stationId ?? source.id ?? "—"}</dd></div>
        {!isModel && <div className="flex justify-between gap-4"><dt className="text-slate-500">Source</dt><dd className="text-right text-slate-200">{source.source ?? "—"}</dd></div>}
        <div className="flex justify-between gap-4"><dt className="text-slate-500">{isModel ? 'Échéance (Paris)' : 'Température relevée (Paris)'}</dt><dd className="text-right text-slate-200">{formatSourceTimestamp(source.updatedAt)}</dd></div>
        {isModel ? <div className="flex justify-between gap-4"><dt className="text-slate-500">Reçu (Paris)</dt><dd className="text-right text-slate-200">{formatSourceTimestamp(source.collectedAt)}</dd></div> : Object.entries(source.measurementTimes??{}).filter(([field])=>field!=='temperature').map(([field,at])=><div key={field} className="flex justify-between gap-4"><dt className="text-slate-500">{{humidity:'Humidité',pressure:'Pression',windSpeed:'Vent',windGust:'Rafales',windDirection:'Direction',precipitation:'Pluie'}[field]??field} (Paris)</dt><dd className="text-right text-slate-200">{formatSourceTimestamp(at)}</dd></div>)}
        {!isModel && <div className="flex justify-between gap-4"><dt className="text-slate-500">Distance</dt><dd className="text-right text-slate-200">{raw(source.distanceKm, " km")}</dd></div>}
      </dl>
    </section>
    {contribution && <section>
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Décomposition du poids appliqué</h3>
      <p className="mb-2 text-[11px] leading-relaxed text-slate-400">Poids par mesure dans la synthèse locale. Une mesure absente ne reçoit aucun poids affiché.</p>
      <div className="grid grid-cols-2 gap-2">
        {fieldWeights.map(({field, label, weight}) => <SourceReading key={field} label={`Poids ${label.toLowerCase()}`} value={raw(weight * 100, " %")} />)}
      </div>
      {temperatureUsed ? <>
        <p className="mb-2 mt-3 text-[11px] text-slate-400">Composantes normalisées de la température, avant pondération finale par bande de distance.</p>
        <div className="grid grid-cols-2 gap-2">
          <SourceReading label="Distance" value={raw(contribution.distanceWeight, "", 3)} />
          <SourceReading label="Priorité technique" value={raw(contribution.qualityWeight, "", 3)} />
          <SourceReading label="Fraîcheur" value={raw(contribution.freshnessWeight, "", 3)} />
        </div>
      </> : null}
    </section>}
  </div>;
}

export function SourceDetailsDialog({ selection, groundTruth, onOpenChange }: { selection: SourceDetailsSelection; groundTruth: any; onOpenChange: (open: boolean) => void }) {
  return <Dialog open={Boolean(selection)} onOpenChange={onOpenChange}>
    <DialogContent className="max-h-[85vh] overflow-y-auto border-slate-700 bg-[#10131a] p-5 text-slate-100 sm:max-w-xl">
      <DialogHeader>
        <DialogTitle className="pr-8 text-white">{selection?.source?.name ?? "Détails de la source"}</DialogTitle>
        <DialogDescription className="text-slate-400">{selection?.kind === "model" ? "Référence de modèle au point du lieu — non station" : "Relevé et statut de station pour le lieu actif"}</DialogDescription>
      </DialogHeader>
      <SourceDetailsContent selection={selection} groundTruth={groundTruth} />
    </DialogContent>
  </Dialog>;
}

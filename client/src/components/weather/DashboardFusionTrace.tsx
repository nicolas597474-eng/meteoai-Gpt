import {useState} from 'react';
import {ChevronDown,X} from 'lucide-react';
import {selectFusionTarget,type DashboardFusionTrace as Trace} from '@shared/dashboardFusionTrace';

const number=new Intl.NumberFormat('fr-FR',{maximumFractionDigits:2});
const instant=new Intl.DateTimeFormat('fr-FR',{timeZone:'Europe/Paris',day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'});
const show=(value:number|null)=>value===null?'—':number.format(value);
const reasons:Record<string,string>={no_model_data:'Valeur non fournie',no_candidate:'Aucun run admissible',no_run:'Run absent',outside_horizon:'Hors portée',missing_variable:'Variable non fournie',timeout:'Délai fournisseur dépassé',provider_http_4xx:'Requête fournisseur refusée',provider_http_5xx:'Erreur fournisseur',no_usable_data:'Aucune valeur exploitable',future_available_at:'Run non encore disponible'};

/** Les contrôles n'affectent que la lecture, jamais le moteur météorologique. */
export function DashboardFusionTrace({points,preferredValidAt,computedAt,stale}:{points:Trace;preferredValidAt:number|null;computedAt:string|null;stale:boolean}) {
  const [expanded,setExpanded]=useState(false);
  const [selected,setSelected]=useState<number|null>(null);
  const [variable,setVariable]=useState('temperature');
  const target=selectFusionTarget(points,selected,preferredValidAt);
  const row=target?.variables.find(item=>item.key===variable)??target?.variables[0];
  const contributors=row?.models.filter(model=>model.contributes&&model.weight!==null&&model.weight>0)??[];
  const calibrated=row?.status==='CALIBRATED';
  return <details onToggle={event=>setExpanded(event.currentTarget.open)} className="weather-chart-3d min-w-0 rounded-[22px] border p-3">
    <summary aria-label={`${expanded?'Fermer':'Ouvrir'} le panneau Fusion des modèles`} aria-expanded={expanded} className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 rounded-lg text-sm font-semibold text-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300 [&::-webkit-details-marker]:hidden">
      <span>Fusion des modèles · détail du calcul</span>
      <span className="weather-icon-bare grid size-11 shrink-0 place-items-center rounded-full border border-sky-300/30 text-sky-200" aria-hidden="true">{expanded?<X className="size-5"/>:<ChevronDown className="size-5"/>}</span>
    </summary>
    <div className="mt-2 min-w-0 space-y-3 text-xs text-slate-300">
      <p>Prévision Open-Meteo · {computedAt&&Number.isFinite(Date.parse(computedAt))?`calcul du ${instant.format(new Date(computedAt))} (Paris)`:'horodatage indisponible'}. {stale?'Dernière prévision mise en cache.':'Snapshot chargé.'}</p>
      <p className="text-amber-100">{!row||row.status==='UNAVAILABLE'?'Trace ou variable indisponible pour cette échéance.':calibrated?'Calibration historique qualifiée pour cette variable.':row?.status==='PARTIALLY_CALIBRATED'?'Calibration historique partielle.':'Calibration historique non disponible pour cette variable. Les poids affichés sont ceux du repli réellement appliqué, sans score MAE inventé.'}</p>
      {!row?<p role="status">La trace détaillée n’est pas disponible dans cette prévision. Elle apparaîtra au prochain chargement réussi.</p>:<>
        <div className="grid min-w-0 grid-cols-1 gap-2 sm:grid-cols-2">
          <label>Échéance (Paris)<select aria-label="Échéance du détail de fusion" value={target!.validAt} onChange={event=>setSelected(Number(event.target.value))} className="mt-1 min-h-11 w-full rounded-lg border border-slate-600 bg-slate-950 px-2 text-white">{points.map(point=><option key={point.validAt} value={point.validAt}>{instant.format(point.validAt)}</option>)}</select></label>
          <label>Variable<select aria-label="Variable du détail de fusion" value={row.key} onChange={event=>setVariable(event.target.value)} className="mt-1 min-h-11 w-full rounded-lg border border-slate-600 bg-slate-950 px-2 text-white">{target!.variables.map(item=><option key={item.key} value={item.key}>{item.label}</option>)}</select></label>
        </div>
        <p className="font-semibold text-sky-100">{row.label} : {show(row.value)} {row.value===null?'':row.unit} · {contributors.length} modèle{contributors.length>1?'s':''} contributeur{contributors.length>1?'s':''}</p>
        <p>{row.value===null?'Aucune valeur finale disponible pour cette échéance.':row.selection==='only_available_model'?'Valeur d’un seul modèle disponible, sans classement comparatif.':row.selection==='qualified_best_model'?'Modèle retenu sur preuve historique comparable.':'Les barres représentent les poids finaux du moteur pour cette variable et cette heure.'}</p>
        {row.precipitation&&row.selection==='weighted_ensemble_fallback'&&<p className="rounded-lg border border-sky-300/20 p-2 text-sky-100">{row.precipitation.rainModels}/{row.precipitation.availableModels} modèles disponibles dépassent le seuil de {show(row.precipitation.thresholdMm)} mm. {row.precipitation.rainModels===0?'Aucun modèle ne prévoit de pluie au-dessus de ce seuil.':`Le consensus combine leur moyenne conditionnelle (${show(row.precipitation.conditionalMeanMm)} mm) et leur fréquence (${show(row.precipitation.frequencyPercent)} %).`} Cette fréquence n’est pas une probabilité de pluie calibrée.</p>}
        <ul className="space-y-2" aria-label="Valeurs et poids appliqués par modèle">{row.models.map(model=><li key={model.name} className="rounded-lg border border-slate-600/40 bg-slate-950/25 p-2">
          <div className="flex flex-wrap justify-between gap-1"><span className="font-semibold text-white">{model.name}</span><span>{show(model.value)} {model.value===null?'':row.unit} · {show(model.weight===null?null:model.weight*100)} %</span></div>
          <div aria-hidden="true" className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-slate-700/50"><div className="h-full rounded-full bg-sky-400" style={{width:`${Math.max(0,Math.min(100,(model.weight??0)*100))}%`}} /></div>
          {!model.contributes&&<p className="mt-1 text-slate-400">Valeur disponible, sans contribution à la valeur finale.</p>}
        </li>)}</ul>
        {row.excluded.length>0&&<details className="rounded-lg border border-slate-600/40 p-2"><summary className="min-h-11 cursor-pointer content-center">Modèles exclus ou indisponibles ({row.excluded.length})</summary><ul className="space-y-2 text-amber-100">{row.excluded.map(model=><li key={model.name}>{model.name} · {reasons[model.reason]??model.reason}</li>)}</ul></details>}
        <p className="text-slate-400">Best Match reste une référence séparée et n’entre pas dans la fusion des sept modèles experts. Les observations Netatmo ne remplacent pas ces prévisions. Un accord entre modèles ne mesure pas la fiabilité historique.</p>
      </>}
    </div>
  </details>;
}

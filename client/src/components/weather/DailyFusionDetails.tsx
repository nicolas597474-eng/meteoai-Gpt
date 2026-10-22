import {useState} from 'react';
import type {DailyFusionDetails as Trace} from '@shared/dashboardDailyFusion';
import {formatHourlyDetailNumber as number} from '@/lib/hourlyDetail';

export function DailyFusionDetails({trace}:{trace:Trace|undefined}) {
  const [variable,setVariable]=useState('tempMax');
  const row=trace?.find(item=>item.key===variable)??trace?.[0];
  return <details className="mt-3 rounded-xl border border-sky-300/20 bg-slate-950/25 p-3 text-xs text-slate-300">
    <summary className="min-h-11 cursor-pointer content-center font-semibold text-sky-100">Modèles et poids de cette journée</summary>
    {!row?<p className="mt-2">La trace détaillée est indisponible dans la prévision chargée. Aucune pondération n’est reconstituée.</p>:<div className="mt-2 space-y-3">
      <label className="block">Variable<select aria-label="Variable de la fusion quotidienne" value={row.key} onChange={event=>setVariable(event.target.value)} className="mt-1 min-h-11 w-full rounded-lg border border-slate-600 bg-slate-950 px-2 text-white">{trace!.map(item=><option key={item.key} value={item.key}>{item.label}</option>)}</select></label>
      <p>{row.availability==='UNAVAILABLE'?'Aucune valeur admissible.':row.availability==='SINGLE_MODEL'?'Un seul modèle disponible pour cette variable.':'Fusion de plusieurs modèles disponibles.'} {row.calibration==='CALIBRATED'?'Calibration historique qualifiée.':row.calibration==='PARTIALLY_CALIBRATED'?'Calibration historique partielle.':row.calibration==='UNCALIBRATED_ROBUST'?'Repli robuste non calibré sur l’historique.':'Calibration indisponible.'}</p>
      <p>Sources disponibles : {row.availableModels.join(', ')||'non précisées'}. Contributeurs : {row.contributingCount??'—'}.</p>
      <ul className="space-y-2" aria-label="Poids quotidiens réellement appliqués">{row.models.map(model=><li key={model.name} className="rounded-lg border border-slate-600/40 bg-slate-950/25 p-2"><div className="flex justify-between gap-2"><span className="font-semibold text-white">{model.name}</span><span>{number(model.weight===null?null:model.weight*100,2)} %</span></div><div aria-hidden="true" className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-slate-700/50"><div className="h-full rounded-full bg-sky-400" style={{width:`${Math.max(0,Math.min(100,(model.weight??0)*100))}%`}}/></div></li>)}</ul>
      {row.excluded.length>0&&<details><summary className="min-h-11 cursor-pointer content-center">Sources exclues ou indisponibles ({row.excluded.length})</summary><ul className="space-y-2 text-amber-100">{row.excluded.map(model=><li key={model.name}>{model.name} · {model.reason}</li>)}</ul></details>}
      <p className="text-slate-400">Ces poids concernent uniquement cette date et cette variable. Best Match reste une référence séparée. Le nombre de modèles et leur accord ne constituent pas un score de fiabilité historique.</p>
    </div>}
  </details>;
}

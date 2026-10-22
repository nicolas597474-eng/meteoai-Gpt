import type {AuxiliaryReferences,AuxiliaryReferenceField} from '../shared/physicalAuxiliaryReference';
import {AUXILIARY_FIELDS} from './physical-auxiliary';
const HOUR=3600000;
/** Références séparées par grandeur. Aucune interpolation ni cumul de fenêtres chevauchantes. */
export function buildAuxiliaryReferences(stations:Map<string,any>,weights:Array<{source:{id:string};finalWeight:number}>,validAt:number):AuxiliaryReferences{
 const result={} as AuxiliaryReferences;
 for(const field of AUXILIARY_FIELDS){
  const unit=field==='pressure'?'hPa':field==='precipitation'?'mm':'km/h';
  let rows=weights.flatMap(w=>{const p=stations.get(w.source.id)?.auxiliary?.[field];return p&&typeof p.value==='number'&&Number.isFinite(p.value)&&Number.isSafeInteger(p.measuredAt)&&w.finalWeight>0?[{...p,stationId:w.source.id,weight:w.finalWeight}]:[];});
  // Une pression très éloignée de la médiane régionale ne devient pas la référence.
  if(field==='pressure'&&rows.length){const sorted=rows.map(r=>r.value).sort((a,b)=>a-b),median=sorted[Math.floor(sorted.length/2)];rows=rows.filter(r=>Math.abs(r.value-median)<=8);}
  const total=rows.reduce((s,r)=>s+r.weight,0),value=total>0?rows.reduce((s,r)=>s+r.value*r.weight,0)/total:null;
  const compatible=rows.filter(r=>{
   if(field==='pressure')return r.basis==='mean_sea_level'&&r.periodMinutes===null&&Math.abs(r.measuredAt-validAt)<=5*60000;
   if(field==='precipitation')return r.basis==='rolling_liquid_rain'&&r.periodMinutes===60&&r.measuredAt===validAt;
   // Le réseau public ne documente ni la hauteur du capteur ni ces fenêtres.
   // Conserver le contexte physique sans qualifier le vent comme une mesure à 10 m.
   return false;
  });
  const mass=compatible.reduce((s,r)=>s+r.weight,0),eligible=compatible.length>=3&&mass>0;
  const reason=rows.length<3?'insufficient_physical_sensors':field==='windSpeed'?'wind_height_and_averaging_unknown':field==='windGust'?'gust_height_and_window_unknown':eligible?'compatible':field==='pressure'?'pressure_instant_not_aligned':'rain_window_not_aligned';
  result[field as AuxiliaryReferenceField]={value,scoreValue:eligible?compatible.reduce((s,r)=>s+r.value*r.weight,0)/mass:null,unit,basis:field==='pressure'?'mean_sea_level':field==='precipitation'?'liquid_rain_60min':'sensor_definition_unspecified',stationCount:rows.length,scoreEligible:eligible,reason,validAt,windowStartAt:field==='precipitation'?validAt-HOUR:null,windowEndAt:field==='precipitation'?validAt:null,contributors:eligible?compatible.map(r=>({stationId:r.stationId,measuredAt:r.measuredAt,value:r.value,weight:r.weight/mass})):[]};
 }
 return result;
}

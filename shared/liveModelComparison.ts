import {OFFICIAL_HOURLY_MODELS} from '../server/officialModels';
export const LIVE_VARIABLES=[
 {key:'temperature',label:'Température',unit:'°C',consensus:'temp'},
 {key:'precipitation',label:'Pluie',unit:'mm',consensus:'precipitation'},
 {key:'windSpeed',label:'Vent',unit:'km/h',consensus:'windSpeed'},
 {key:'humidity',label:'Humidité',unit:'%',consensus:'humidity'},
 {key:'pressure',label:'Pression',unit:'hPa',consensus:'pressure'},
] as const;
export type LiveVariable=typeof LIVE_VARIABLES[number]['key'];
type Values=Record<LiveVariable,number|null>;
export type LiveModel={name:string;modelId:string|null;reference:boolean;collectedAt:number|null;status:string;errorCode:string|null;hours:Array<Values&{validAt:number;windGust?:number|null;windDirection?:number|null}>};
export type LiveComparison={collectedAt:string;models:LiveModel[];consensus:Array<Values&{validAt:number}>;slots:number[];stale:boolean;calibration:string};
const finite=(value:unknown):number|null=>typeof value==='number'&&Number.isFinite(value)?value:null;
/** Diagnostic à l'heure et pour la variable choisies, jamais un score de fiabilité. */
export function describeLiveModel(model:LiveModel,validAt:number,variable:LiveVariable):string{
 const hour=model.hours.find(h=>h.validAt===validAt);
 if(hour&&finite(hour[variable])!==null)return model.status==='partial'?'Valeur reçue · certaines autres variables sont incomplètes':'Valeur reçue';
 if(hour)return 'Variable non fournie à cette échéance';
 if(model.hours.length)return 'Aucune valeur reçue pour cette heure';
 switch(model.errorCode){
  case 'timeout':return 'Le fournisseur n’a pas répondu dans le délai';
  case 'provider_http_4xx':return 'Requête refusée par le fournisseur';
  case 'provider_http_5xx':case 'provider_http_error':return 'Erreur du fournisseur';
  case 'invalid_response':return 'Réponse fournisseur inexploitable';
  case 'no_usable_data':return 'Aucune valeur exploitable reçue';
  default:return 'Source momentanément indisponible';
 }
}
export function selectLiveComparisonSlot(slots:readonly number[],previous:number,now=Date.now()):number{
 return slots.includes(previous)?previous:slots.find(t=>t>=now)??slots[0]??0;
}
/** Projection des seules valeurs reçues. Aucun remplissage par un autre modèle. */
export function projectLiveComparison(collection:any,hours:any[],now=Date.now()):LiveComparison{
 const definitions=[...OFFICIAL_HOURLY_MODELS,{name:'best_match',modelId:null}];
 const models:LiveModel[]=definitions.map(definition=>{
  const forecast=collection.forecasts.find((f:any)=>f.modelName===definition.name),diagnostic=collection.diagnostics.find((d:any)=>d.modelName===definition.name);
  return {name:definition.name,modelId:definition.modelId,reference:definition.name==='best_match',collectedAt:finite(forecast?.availableAt),status:diagnostic?.status??'failed',errorCode:diagnostic?.errorCode??null,hours:(forecast?.hours??[]).filter((h:any)=>Number.isFinite(h.validAt)).map((h:any)=>({validAt:h.validAt,windGust:finite(h.windGust),windDirection:finite(h.windDirection),...Object.fromEntries(LIVE_VARIABLES.map(v=>[v.key,finite(h[v.key])]))}))};
 });
 const slots=Array.from(new Set<number>(models.flatMap(m=>m.hours.filter(h=>h.validAt>=Math.floor(now/3600000)*3600000&&h.validAt<=now+48*3600000).map(h=>h.validAt)))).sort((a,b)=>a-b);
 return {collectedAt:collection.collectedAt??new Date(now).toISOString(),models,slots,consensus:hours.map(h=>({validAt:h.validAt,...Object.fromEntries(LIVE_VARIABLES.map(v=>[v.key,finite(h[v.consensus])]))})) as LiveComparison['consensus'],stale:collection.controlCache?.stale===true,calibration:'robust_fallback'};
}
export function summarizeLiveComparison(data:LiveComparison,validAt:number,variable:LiveVariable){
 const members=data.models.map(model=>({...model,value:model.hours.find(h=>h.validAt===validAt)?.[variable]??null}));
 const contributors=members.filter(m=>!m.reference&&m.value!==null),values=contributors.map(m=>m.value!);
 return {members,contributors:values.length,min:values.length?Math.min(...values):null,max:values.length?Math.max(...values):null,spread:values.length>=2?Math.max(...values)-Math.min(...values):null,consensus:data.consensus.find(h=>h.validAt===validAt)?.[variable]??null};
}

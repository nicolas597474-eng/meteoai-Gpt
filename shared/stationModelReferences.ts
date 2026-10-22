import type {LiveComparison} from './liveModelComparison';

const fields=['temperature','humidity','pressure','windSpeed','windGust','windDirection','precipitation'] as const;
const finite=(v:unknown):v is number=>typeof v==='number'&&Number.isFinite(v);
/** Prévisions de l'heure courante uniquement. Best match n'est pas un modèle indépendant.
 * Aucun mélange avec groundTruth, aucune note de cohérence ou de fiabilité inventée. */
export function stationModelReferences(data:LiveComparison|undefined,groundTruth:any,now=Date.now()){
 const validAt=Math.floor(now/3600000)*3600000,seen=new Set<string>();
 if(!data||data.stale)return [];
 return data.models.flatMap(model=>{
  if(model.reference||!model.modelId||seen.has(model.modelId)||!finite(model.collectedAt)||model.collectedAt>now||now-model.collectedAt>30*60000)return [];
  const hour=model.hours.find(h=>h.validAt===validAt);
  if(!hour||!fields.some(field=>finite(hour[field])))return [];
  seen.add(model.modelId);
  const contributors=(groundTruth?.stationsUsed??[]).filter((s:any)=>(s.fieldWeights?.temperature??s.weight)>0&&finite(Date.parse(s.measurementTimes?.temperature??s.observedAt??''))&&Math.abs(validAt-Date.parse(s.measurementTimes?.temperature??s.observedAt))<=3600000);
  const local=finite(groundTruth?.temperature)&&contributors.length>0?groundTruth.temperature:null;
  return [{id:`openmeteo-${model.modelId}`,name:model.name,...Object.fromEntries(fields.map(field=>[field,finite(hour[field])?hour[field]:null])),
   updatedAt:new Date(validAt).toISOString(),collectedAt:new Date(model.collectedAt).toISOString(),
   source:'Open-Meteo',localTemperature:local,localDeltaC:local!==null&&finite(hour.temperature)?hour.temperature-local:null,localStationCount:contributors.length,
   coherenceWeight:null,sourceKind:'model' as const}];
 });
}

/** Effectifs et fraîcheur des seules observations réellement pondérées par variable. */
export function stationSummaryCoverage(groundTruth:any,field:string){
 const stations=(groundTruth?.stationsUsed??[]).filter((s:any)=>(s.fieldWeights?.[field]??(field==='temperature'?s.weight:0))>0);
 const times=stations.map((s:any)=>Date.parse(s.measurementTimes?.[field]??(field==='temperature'?s.observedAt:'')??'')).filter(Number.isFinite);
 return {count:stations.length,oldestAt:times.length?Math.min(...times):null,newestAt:times.length?Math.max(...times):null};
}

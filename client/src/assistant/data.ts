import {publicGeography} from '../lib/publicGeography';
import {getNetatmoStationCollection} from '../lib/netatmoStations';
import {dateAt,finite,type DataPort,type Forecast,type Variable} from './contracts';
type WeatherRead='getDetailedForecast'|'get15DayForecast'|'getModelComparison'|'getReliabilityLaboratory';
type ReadName=WeatherRead|'getCurrentDashboardWeather';
type Read=(name:ReadName,input:unknown,staleTime:number)=>Promise<any>;
type Query={fetch:(input:any,options:{staleTime:number})=>Promise<any>};
/** Même transport et mêmes clés de cache que les pages de l'application.
 * Les accès sont explicites pour que TypeScript vérifie aussi leur service. */
export function createAssistantRead(utils:{favorites:{getCurrentDashboardWeather:Query};weather:Record<Exclude<WeatherRead,'getModelComparison'>,Query>},comparison:Query):Read{
 const queries={getCurrentDashboardWeather:utils.favorites.getCurrentDashboardWeather,getDetailedForecast:utils.weather.getDetailedForecast,get15DayForecast:utils.weather.get15DayForecast,getModelComparison:comparison,getReliabilityLaboratory:utils.weather.getReliabilityLaboratory};
 return (name,input,staleTime)=>queries[name].fetch(input,{staleTime});
}
/** Attend le rafraîchissement déjà lancé par le cache de l'application.
 * Aucun polling, aucune requête fournisseur forcée, aucun contournement de quota. */
export async function readFreshAssistantData(read:Read,name:ReadName,input:unknown){
 if(typeof window==='undefined')return read(name,input,60000);
 let finish!:()=>void,timer:ReturnType<typeof setTimeout>|undefined,didRefresh=false;
 const refreshed=new Promise<void>(resolve=>{finish=resolve;timer=setTimeout(resolve,10000);});
 const onRefresh=(event:Event)=>{if((event as CustomEvent).detail?.name==='weather.'+name){didRefresh=true;finish();}};
 window.addEventListener('meteoai-weather-refreshed',onRefresh);
 try{
  const first=await read(name,input,60000);
  if(!first?.controlCache?.stale&&!first?.stale)return first;
  if(typeof navigator!=='undefined'&&!navigator.onLine)return first;
  await refreshed;
  if(!didRefresh)return first;
  // staleTime zéro ne contourne que le cache de requête de la conversation :
  // le transport conserve ses caches métier et la même requête en cours.
  return read(name,input,0);
 }finally{clearTimeout(timer);window.removeEventListener('meteoai-weather-refreshed',onRefresh);}
}
export function forecastFromResponse(value:any,now=Date.now()):Forecast{
 const hours=Array.isArray(value?.hours)?value.hours.filter((h:any)=>finite(h.validAt)&&typeof h.hour==='string').map((h:any)=>({...h,date:dateAt(h.validAt)})):[];
 const receipts=hours.flatMap((h:any)=>(h.forecastWeighting?.variableWeightings??[]).flatMap((v:any)=>(v.modelWeights??[]).filter((m:any)=>m.contributedToValue&&finite(m.availableAt)).map((m:any)=>m.availableAt)));
 const at=Date.parse(value?.collectedAt??'');if(finite(at))receipts.push(at);
 const received=receipts.length?Math.min(...receipts):null;
 // Une disponibilité de cycle ancienne n'est pas l'âge du cache navigateur.
 // Le transport existant signale séparément ses réponses périmées/hors ligne.
 return {hours,days:Array.isArray(value?.days)?value.days:[],models:Array.isArray(value?.modelsUsed)?value.modelsUsed.filter((m:any)=>typeof m==='string'):[],updatedAt:received===null?undefined:new Date(received).toISOString(),stale:value?.controlCache?.stale===true||value?.officialSnapshot?.snapshotStatus==='stale'||received===null||received>now+60000||now-received>24*3600000};
}
export function createDataPort(read:Read,filters:{period:string;horizon:string}):DataPort{
 return {
  resolvePlace:async query=>(await publicGeography.search(query,6)).map(p=>({name:[p.name,p.admin1,p.country].filter(Boolean).join(', '),lat:p.latitude,lon:p.longitude})),
  async current(place,variable){
   const value=await read('getCurrentDashboardWeather',{lat:place.lat,lon:place.lon},60000);
   const key=variable==='apparentTemperature'?'apparentTemperature':variable==='temperature'?'temperature':variable;
   const field=value?.fields?.[key],provenance=field?.provenance,measurements=provenance?.kind==='physical_stations'&&Array.isArray(provenance.measurements)?provenance.measurements:[];
   // Une synthèse de plusieurs stations n'a pas d'instant unique. Tous ses
   // contributeurs doivent être récents ; on ne recalcule jamais leur valeur.
   const times=measurements.length?measurements.map((m:any)=>Date.parse(m.observedAt??'')):[Date.parse(provenance?.observedAt??'')],now=Date.now();
   const recent=times.every((at:number)=>finite(at)&&at<=now+60000&&now-at<=30*60000),at=recent?Math.min(...times):NaN;
   const reason=recent?[provenance?.reason,measurements.length>1?'Synthèse de plusieurs stations ; l’horodatage indiqué correspond au plus ancien relevé utilisé.':null].filter(Boolean).join(' '):'Aucune valeur récente avec horodatage vérifiable.';
   return {value:recent&&finite(field?.value)?field.value:null,kind:provenance?.kind==='physical_stations'?'observation':'forecast',label:provenance?.label??'Source indisponible',updatedAt:recent?new Date(at).toISOString():undefined,reason};
  },
  async forecast(place,days){return forecastFromResponse(await readFreshAssistantData(read,days?'get15DayForecast':'getDetailedForecast',{lat:place.lat,lon:place.lon,...(!days?{includeExtendedPeriods:true}:{})}));},
  async stations(place){return (await getNetatmoStationCollection(place.lat,place.lon)).stations.filter(s=>!s.anomaly&&s.distance<=50&&s.time<=Date.now()+60000&&Date.now()-s.time<=30*60000).map(s=>({name:s.name,temp:s.temp,distance:s.distance,time:s.time,anomaly:s.anomaly}));},
  async comparison(place){return readFreshAssistantData(read,'getModelComparison',{lat:place.lat,lon:place.lon});},
  async reliability(place){return read('getReliabilityLaboratory',{lat:place.lat,lon:place.lon,...filters},60000);},
 };
}

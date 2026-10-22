/** Lecture partagée par Stations et Dashboard : une seule collecte par lieu. */
export const NETATMO_RADIUS_KM=50;
export const NETATMO_SOURCE='';
export type NetatmoStation={id:string;name:string;lat?:number;lon?:number;temp:number;humidity?:number|null;pressure?:number|null;windSpeed?:number|null;windGust?:number|null;windDirection?:number|null;precipitation?:number|null;precipitationPeriodMinutes?:number;measurementTimes?:Record<string,number>;distance:number;time:number;reliability:number;elevation:number|null;anomaly:boolean};
export type NetatmoStationCollection={stations:NetatmoStation[];fetchedAt:string|null;fromCache:boolean};
export class NetatmoStationsError extends Error {
 constructor(message:string,public code:string){super(message);}
}
const cache=new Map<string,{expires:number;collection:NetatmoStationCollection}>();
const flights=new Map<string,Promise<NetatmoStationCollection>>();
export async function getNetatmoStationCollection(lat:number,lon:number):Promise<NetatmoStationCollection>{
 const key=lat+','+lon,prior=cache.get(key);
 if(prior&&prior.expires>Date.now())return {...prior.collection,fromCache:true};
 if(flights.has(key))return flights.get(key)!;
 const pending=(async()=>{
  const r=await fetch(NETATMO_SOURCE+'/api/netatmo/stations?'+new URLSearchParams({lat:String(lat),lon:String(lon),radiusKm:String(NETATMO_RADIUS_KM)}),{credentials:'same-origin',cache:'no-store',redirect:'error',signal:AbortSignal.timeout(55000)});
  const value=await r.json();
  if(!r.ok)throw new NetatmoStationsError(r.status===401||r.status===409?'Connectez Netatmo dans les réglages de cette application.':'Stations momentanément indisponibles.',typeof value.code==='string'?value.code:'NETATMO_UNAVAILABLE');
  if(value.radiusKm!==NETATMO_RADIUS_KM)throw Error('Le raccordement Netatmo ne confirme pas encore la recherche à 50 km.');
  if(!Array.isArray(value.stations))throw Error('Réponse stations inexploitable.');
  const stations=value.stations.filter((s:any)=>typeof s.id==='string'&&typeof s.name==='string'&&Number.isFinite(s.temp)&&Number.isFinite(s.time)&&Number.isFinite(s.distance)&&Number.isFinite(s.reliability)&&s.distance>=0&&s.distance<=NETATMO_RADIUS_KM);
  const expires=Math.min(Date.now()+600000,Number.isFinite(value.expiresAt)?value.expiresAt:Date.now()+600000);
  if(cache.size>=8&&!cache.has(key))cache.delete(cache.keys().next().value!);
  const collection={stations,fetchedAt:Number.isFinite(value.at)?new Date(value.at).toISOString():null,fromCache:value.cacheHit===true};
  // Le serveur a terminé sa tentative d’archivage ; relire uniquement le bilan physique.
  if(typeof window!=='undefined')window.dispatchEvent(new CustomEvent('meteoai-weather-refreshed',{detail:{name:'weather.getEvidenceStatus'}}));
  cache.set(key,{expires,collection});return collection;
 })().finally(()=>flights.delete(key));flights.set(key,pending);return pending;
}
export async function getNetatmoStations(lat:number,lon:number):Promise<NetatmoStation[]>{
 return (await getNetatmoStationCollection(lat,lon)).stations;
}

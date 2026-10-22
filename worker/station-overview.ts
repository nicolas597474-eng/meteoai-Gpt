import {stationSearchInput} from '../shared/stationSearchReadModel';
import {readServerObservations} from './server-observations';
import {searchStations} from './station-search';
import {ApiError} from './api-error';
import {readProviderComparisonValues} from './learning-provider-runs';
import {buildStationComparison,stationComparisonWindow} from './station-comparison';
import {deriveStationQualityProfile} from '../server/stationQualityService';
import {deriveStationPerformanceProfiles} from '../server/stationPerformanceService';

const HOUR=3600000;
const stationKey=async(id:string)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(id)))).map(v=>v.toString(16).padStart(2,'0')).join('');
type ArchiveRead={history:any;forecast:any};
const cache=new WeakMap<object,{until:number;hour:number;value:Promise<ArchiveRead>}>();
async function readArchives(env:any,now:number):Promise<ArchiveRead>{
 const {start,end}=stationComparisonWindow(now),prior=cache.get(env.DB);
 if(prior&&prior.until>now&&prior.hour===end)return prior.value;
 // Promesse protégée partagée : une panne ne fuit pas vers le second lecteur.
 const value=Promise.allSettled([readServerObservations(env,now),readProviderComparisonValues(env,start,end,now)]).then(([observations,models])=>{
  const result={history:observations.status==='fulfilled'?observations.value:null,forecast:models.status==='fulfilled'?models.value:null};
  if(!result.history||!result.forecast||result.history.boundedRead||result.history.rejectedArchives||result.history.conflictingMeasurements||result.forecast.boundedRead||result.forecast.filesRejected){if(cache.get(env.DB)?.value===value)cache.delete(env.DB);}
  return result;
 });
 cache.set(env.DB,{until:now+5*60000,hour:end,value});return value;
}

/** Les coordonnées viennent du relevé courant ; les mesures historiques restent
 * celles des fichiers serveur vérifiés, jamais des valeurs courantes antidatées. */
export async function buildStationOverview(input:any,live:any,history:any,now:number,forecast:any=null){
 const periodDays=input?.periodDays??1,coords=stationSearchInput(input);
 if(periodDays!==1&&periodDays!==7)throw new ApiError('Période des stations invalide.');
 const stations=await Promise.all(live.stations.map(async(station:any)=>{
  const key=await stationKey(station.stationId);
  const profileReadings=(history?.rows??[]).filter((r:any)=>r.stationKey===key&&r.measuredAt>=now-7*24*HOUR&&r.measuredAt<=now&&r.distance<=coords.radiusKm&&r.flags.length===0).sort((a:any,b:any)=>a.measuredAt-b.measuredAt).map((r:any)=>({observedAt:r.measuredAt,measurementTimes:{temperature:new Date(r.measuredAt).toISOString(),...(Number.isFinite(r.humidity)?{humidity:new Date(r.measuredAt).toISOString()}:{})},temperature:r.temperature,humidity:r.humidity??null,pressure:null,windSpeed:null,windGust:null,precipitation:null}));
  const readings=profileReadings.filter((r:any)=>r.observedAt>=now-periodDays*24*HOUR);
  const latest=readings.at(-1)??null;
  return {...station,readings,profileReadings,latest,ageMinutes:latest?Math.max(0,Math.round((now-latest.observedAt)/60000)):null,qualityProfile:history?.status==='verified'&&!history.boundedRead?deriveStationQualityProfile({stationId:station.stationId,observations:profileReadings,nowMs:now}):null};
 }));
 // Éligibilité de lecture physique seulement : source Netatmo authentifiée,
 // station active et mesures serveur vérifiées. Aucun score n'est qualifié ici.
 const profiles=deriveStationPerformanceProfiles({stations:stations.map(s=>({...s,qualificationStatus:s.source==='netatmo'&&s.isActive&&s.qualityProfile&&s.profileReadings.length?'validated':null,readings:s.profileReadings})),maxDistanceKm:coords.radiusKm,asOf:now});
 return {presentationStatus:'live',center:{lat:coords.lat,lon:coords.lon},periodDays,radiusKm:coords.radiusKm,performanceWindowDays:7,collectedAt:live.fetchedAt,latestGroundTruth:null,latestCollection:null,availabilityHistory:[],stations:stations.map(({profileReadings,...s})=>({...s,stationPerformance:history?.status==='verified'&&!history.boundedRead?profiles.get(s.stationId)??null:null})),...buildStationComparison(history,forecast,coords.radiusKm,now),
  archiveStatus:history?{status:history.status,checkedArchives:history.checkedArchives,rejectedArchives:history.rejectedArchives,boundedRead:history.boundedRead}: {status:'unavailable',checkedArchives:0,rejectedArchives:0,boundedRead:false},
 };
}

export async function readStationOverview(input:any,request:Request,env:any,now=Date.now()){
 const coords=stationSearchInput(input),periodDays=input?.periodDays??1;
 if(periodDays!==1&&periodDays!==7)throw new ApiError('Période des stations invalide.');
 const live=await searchStations(input,request,env);
 let history=null,forecast=null;
 // Le compte est vérifié par Netatmo ; aucune archive physique n'est lue
 // sans identité ou pour un lieu dont la collecte n'est pas raccordée.
 if(request.headers.get('oai-authenticated-user-id')&&coords.lat===50.7567&&coords.lon===2.5204){
  ({history,forecast}=await readArchives(env,now));
 }
 return buildStationOverview(input,live,history,now,forecast);
}

import {getOpenMeteoTrafficBuckets,getTrafficInstanceId} from '../server/openMeteoTraffic';
import {validTrafficBucket,type TrafficBucket} from '../shared/openMeteoTraffic';
import {readCollectionServiceStatus} from './collection-service-status';
const PREFIX='open_meteo_traffic_v1/';
const flushed=new Map<string,number>();
let cleanupAt=0;
export function hasUnflushedOpenMeteoTraffic(){return getOpenMeteoTrafficBuckets().some(row=>row.revision>(flushed.get(row.hour)??0));}
/** Monotonic per-isolate snapshots: concurrent request completions cannot double-count attempts. */
export async function flushOpenMeteoTraffic(env:any,now=Date.now()){
 const buckets=getOpenMeteoTrafficBuckets().filter(row=>row.revision>(flushed.get(row.hour)??0));
 if(!buckets.length)return;
 try{
  const instance=getTrafficInstanceId();
  for(const row of buckets){
   await env.DB.prepare("INSERT INTO weather_collection_status(channel,attempted_at,status,message) VALUES (?,?,?,?) ON CONFLICT(channel) DO UPDATE SET attempted_at=excluded.attempted_at,message=excluded.message WHERE COALESCE(json_extract(weather_collection_status.message,'$.revision'),0)<json_extract(excluded.message,'$.revision')")
    .bind(PREFIX+row.hour+'/'+instance,row.lastObservedAt,'traffic_v1',JSON.stringify(row)).run();
   flushed.set(row.hour,Math.max(row.revision,flushed.get(row.hour)??0));
  }
  if(now-cleanupAt>3600000){
   await env.DB.prepare('DELETE FROM weather_collection_status WHERE substr(channel,1,?)=? AND attempted_at<?').bind(PREFIX.length,PREFIX,new Date(now-72*3600000).toISOString()).run();
   cleanupAt=now;
   for(const key of flushed.keys())if(Date.parse(key)<now-72*3600000)flushed.delete(key);
  }
 }catch{console.warn('Compteurs Open-Meteo non enregistrés ; collecte météo conservée.');}
}
export type OpenMeteoDiagnostic = {
 version:1;checkedAt:string;traffic:{available:boolean;bounded:boolean;buckets:TrafficBucket[]};
 limits:Array<{endpoint:'forecast'|'single_runs';observedAt:string;period:string;retryAt:string;active:boolean}>;
 daily:{attemptedAt:string;status:string;models:string[];dates:string[];httpStatus:number|null;mode:string|null;requestStatus?:string|null;retryAt?:string|null;reusedExisting?:boolean}|null;
 service:Awaited<ReturnType<typeof readCollectionServiceStatus>>;
 journalAvailable:boolean;
};
/** Pure reads: this endpoint never calls a provider or triggers a weather refresh. */
export async function readOpenMeteoDiagnostic(env:any,now=Date.now()):Promise<OpenMeteoDiagnostic>{
 const traffic={available:false,bounded:false,buckets:[] as TrafficBucket[]},limits:OpenMeteoDiagnostic['limits']=[];
 let daily:OpenMeteoDiagnostic['daily']=null,journalAvailable=false;
 try{
  const result=await env.DB.prepare('SELECT message FROM weather_collection_status WHERE substr(channel,1,?)=? AND attempted_at>=? ORDER BY attempted_at DESC LIMIT 1001').bind(PREFIX.length,PREFIX,new Date(Math.floor(now/3600000)*3600000-47*3600000).toISOString()).all();
  if(!Array.isArray(result.results))throw Error('Compteurs indisponibles');
  traffic.bounded=result.results.length>1000;
  for(const row of result.results.slice(0,1000)){const value=JSON.parse(row.message);if(!validTrafficBucket(value))throw Error('Compteur invalide');traffic.buckets.push(value);}
  traffic.available=true;
 }catch{traffic.buckets=[];}
 try{
  const result=await env.DB.prepare('SELECT channel,attempted_at,status,message FROM weather_collection_status WHERE channel IN (?,?,?)').bind('learning_open_meteo_limit_v1/forecast','learning_open_meteo_limit_v1/single_runs','learning_daily_collection_v1').all();
  if(!Array.isArray(result.results))throw Error('Journal indisponible');
  for(const row of result.results){
   if(!Number.isFinite(Date.parse(row.attempted_at))||Date.parse(row.attempted_at)>now)continue;
   let message:any;
   try{message=JSON.parse(row.message);}catch{
    if(row.channel==='learning_daily_collection_v1')daily={attemptedAt:row.attempted_at,status:row.status,models:[],dates:[],httpStatus:null,mode:null};
    continue;
   }
   if(row.channel.startsWith('learning_open_meteo_limit_v1/')&&message.version===1&&['minute','hour','day','unknown'].includes(message.period)&&Number.isSafeInteger(message.retryAt)&&message.retryAt<=now+7*86400000){
    limits.push({endpoint:row.channel.endsWith('/forecast')?'forecast':'single_runs',observedAt:row.attempted_at,period:message.period,retryAt:new Date(message.retryAt).toISOString(),active:message.retryAt>now});
   }else if(row.channel==='learning_daily_collection_v1'&&message.version===1){
    const accepted=['AROME','ARPEGE','ICON','ECMWF','GFS','GEM','UKMET'];
    daily={attemptedAt:row.attempted_at,status:row.status,models:Array.isArray(message.models)?Array.from(new Set<string>(message.models.filter((m:any)=>accepted.includes(m)))):[],dates:Array.isArray(message.dates)?message.dates.filter((d:any)=>typeof d==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(d)).slice(0,16):[],httpStatus:Number.isInteger(message.forecastApiStatus)?message.forecastApiStatus:null,mode:['forecast_api','mixed','verified_hourly_cycles'].includes(message.mode)?message.mode:null,requestStatus:['response','suspended','network_error'].includes(message.forecastApiRequestStatus)?message.forecastApiRequestStatus:null,retryAt:Number.isSafeInteger(message.retryAt)&&message.retryAt<=now+7*86400000?new Date(message.retryAt).toISOString():null,reusedExisting:message.reusedExisting===true};
   }
  }
  journalAvailable=true;
 }catch{}
 return {version:1,checkedAt:new Date(now).toISOString(),traffic,limits,daily,service:await readCollectionServiceStatus(env,now),journalAvailable};
}

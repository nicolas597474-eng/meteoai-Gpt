import {OFFICIAL_HOURLY_MODELS} from '../server/officialModels';
import {getParisDateAndHour,parisLocalHourToUniqueEpochMs} from '../server/parisHourlyTime';
import {fetchWeather} from '../server/weatherFetch';
import {readFutureProviderModels} from './learning-provider-runs';
import {normalizeDailyCapture} from './daily-archive';
import {readProviderRateLimit} from '../server/providerRateLimit';
import {readLearningProviderLimit,recordLearningProviderLimit} from './provider-rate-limit';

const HOUR=3600000,coords={lat:50.7567,lon:2.5204};
const fields={tempMax:'temperature_2m_max',tempMin:'temperature_2m_min',precipitation:'precipitation_sum',windSpeed:'wind_speed_10m_max',windGust:'wind_gusts_10m_max',humidity:'relative_humidity_2m_mean',cloudCover:'cloud_cover_mean'} as const;
export type DailySourceSummary={mode:'forecast_api'|'verified_hourly_cycles'|'mixed';models:string[];dates:string[];forecastApiStatus:number|null;forecastApiRequestStatus?:'response'|'suspended'|'network_error';retryAt?:number|null};
const finite=(v:unknown):v is number=>typeof v==='number'&&Number.isFinite(v);

/** Extrêmes d'un seul cycle, sur toutes les heures réelles d'une journée future de Paris. */
export function aggregateVerifiedDailyTemperatures(models:any[],now:number){
 const days=new Map<string,any[]>(),coverage:any[]=[];
 for(const model of models){
  if(!OFFICIAL_HOURLY_MODELS.some(m=>m.name===model.modelName&&m.modelId===model.modelId))continue;
  const byTime=new Map<number,any>(),duplicates=new Set<number>();
  for(const hour of model.hours??[]){if(byTime.has(hour.validAt))duplicates.add(hour.validAt);byTime.set(hour.validAt,hour);}
  const dates=Array.from(new Set<string>(Array.from(byTime.keys()).flatMap(time=>getParisDateAndHour(time)?.date??[]))).sort();
  for(const date of dates){
   const next=new Date(Date.parse(date+'T12:00:00Z')+86400000).toISOString().slice(0,10);
   const start=parisLocalHourToUniqueEpochMs(date,0),end=parisLocalHourToUniqueEpochMs(next,0);
   if(start==null||end==null||start<=now||model.availableAt>=start)continue;
   const times=Array.from({length:(end-start)/HOUR},(_,i)=>start+i*HOUR);
   if(![23,24,25].includes(times.length)||times.some(t=>duplicates.has(t)||!finite(byTime.get(t)?.temperature)))continue;
   const values=times.map(t=>byTime.get(t).temperature);
   const row={serviceName:model.modelName,modelId:model.modelId,tempMax:Math.max(...values),tempMin:Math.min(...values),precipitation:null,windSpeed:null,windGust:null,humidity:null,cloudCover:null,requestStartedAt:null,availableAt:null};
   days.set(date,[...(days.get(date)??[]),row]);
   coverage.push({date,model:model.modelName,modelId:model.modelId,providerRunAt:model.providerRunAt,availableAt:model.availableAt,expectedHours:times.length,firstValidAt:start,lastValidAt:end-HOUR});
  }
 }
 return {days:Array.from(days,([date,forecasts])=>({date,forecasts})).sort((a,b)=>a.date.localeCompare(b.date)),coverage};
}
export async function deriveDailyFromVerifiedCycles(env:any,now:number){
 const verified=await readFutureProviderModels(env,now);
 return {...aggregateVerifiedDailyTemperatures(verified.models,now),sourceRevision:verified.revision,filesRejected:verified.filesRejected};
}

/** Une seule requête pour les sept modèles ; aucune rotation d'IP ou de clé. */
export async function collectDailyForecastBatch(now=Date.now(),env?:any){
 const suspended=env?await readLearningProviderLimit(env,'forecast',now):null;
 if(suspended)return {days:[],httpStatus:null,requestStatus:'suspended' as const,retryAt:suspended.retryAt};
 const url=new URL('https://api.open-meteo.com/v1/forecast');
 for(const [key,value] of Object.entries({latitude:String(coords.lat),longitude:String(coords.lon),models:OFFICIAL_HOURLY_MODELS.map(m=>m.modelId).join(','),daily:Object.values(fields).join(','),timezone:'Europe/Paris',forecast_days:'16',temperature_unit:'celsius',wind_speed_unit:'kmh',precipitation_unit:'mm'}))url.searchParams.set(key,value);
 try{
  // Le bail SQL et l'archive horaire font déjà cache ; ne pas redater une ancienne réponse HTTP.
  const requestStartedAt=Date.now(),response=await fetchWeather(url,{}, {timeoutMs:6000,attempts:1,cacheTtlMs:0,quotaStore:env?.openMeteoQuota});
  if(response.headers.get('X-MeteoAI-Quota-Suspended')==='1')return {days:[],httpStatus:null,requestStatus:'suspended' as const,retryAt:(await readLearningProviderLimit(env,'forecast',now))?.retryAt??null};
  if(!response.ok){const limit=await readProviderRateLimit(response,now);if(limit&&env)await recordLearningProviderLimit(env,'forecast',limit,now);return {days:[],httpStatus:response.status,requestStatus:'response' as const,retryAt:limit?.retryAt??null};}
  const value=await response.json(),availableAt=Date.now(),daily=value.daily;
  if(value.timezone!=='Europe/Paris'||!Array.isArray(daily?.time)||daily.time.length>16||new Set(daily.time).size!==daily.time.length)throw Error('Réponse quotidienne invalide');
  const days=daily.time.map((date:string,index:number)=>({date,forecasts:OFFICIAL_HOURLY_MODELS.map(model=>({serviceName:model.name,modelId:model.modelId,requestStartedAt,availableAt,...Object.fromEntries(Object.entries(fields).map(([field,api])=>{
   const key=api+'_'+model.modelId,raw=daily[key]?.[index],unit=value.daily_units?.[key],expected=field==='tempMax'||field==='tempMin'?'°C':field==='precipitation'?'mm':field==='humidity'||field==='cloudCover'?'%':'km/h';
   return [field,unit===expected&&finite(raw)?raw:null];
  }))})).filter((row:any)=>Object.keys(fields).some(k=>finite(row[k])))}));
  return {days:normalizeDailyCapture({...coords,capturedAt:availableAt,days},availableAt).days,httpStatus:200,requestStatus:'response' as const,retryAt:null};
 }catch{return {days:[],httpStatus:null,requestStatus:'network_error' as const,retryAt:null};}
}
export function mergeDailySources(primary:any[],derived:any[]){
 const result=new Map<string,Map<string,any>>();let derivedUsed=false;
 for(const [isDerived,days] of [[false,primary],[true,derived]] as const)for(const day of days){const models=result.get(day.date)??new Map<string,any>();for(const row of day.forecasts){if(!models.has(row.serviceName)){models.set(row.serviceName,row);derivedUsed||=isDerived;}}result.set(day.date,models);}
 return {days:Array.from(result,([date,models])=>({date,forecasts:Array.from(models.values())})).filter(d=>d.forecasts.length).sort((a,b)=>a.date.localeCompare(b.date)),derivedUsed};
}

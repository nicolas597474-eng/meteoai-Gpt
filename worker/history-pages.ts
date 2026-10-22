import {verifyDailyCapture} from './daily-archive';
import {scanVerifiedLearningDays,readSigned} from './learning-store';
import {readFusionSnapshots} from './fusion-snapshots';
import {OFFICIAL_HOURLY_MODELS} from '../server/officialModels';
import {summarizeDailyModelAgreement} from '../shared/modelAgreement';
import {summarizePrecipitationModels} from '../shared/precipitationConsensus';
import {coordinates} from './weather';
import {ApiError} from './api-error';
const LOCATION='50.757_2.520',DAY=86400000,names=OFFICIAL_HOURLY_MODELS.map(m=>m.name);
const number=(v:any)=>typeof v==='number'&&Number.isFinite(v)?v:null;
const date=(t:number)=>new Date(t).toLocaleDateString('en-CA',{timeZone:'Europe/Paris'});
const shift=(s:string,n:number)=>new Date(Date.parse(s+'T12:00:00Z')+n*DAY).toISOString().slice(0,10);
const canonical=(v:any):any=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
const sha=async(text:string)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text)))).map(v=>v.toString(16).padStart(2,'0')).join('');
const cache=new WeakMap<object,Map<string,{until:number;promise:Promise<any>}>>();
async function loadRange(start:string,end:string,env:any,now:number){
 const key=start+'/'+end;let entries=cache.get(env.DB);if(!entries){entries=new Map();cache.set(env.DB,entries);}const old=entries.get(key);if(old&&old.until>now)return old.promise;
 const promise=readRange(start,end,env,now).catch(error=>{entries!.delete(key);throw error;});if(entries.size>=8)entries.delete(entries.keys().next().value!);entries.set(key,{until:now+60000,promise});return promise;
}
async function readRange(start:string,end:string,env:any,now:number){
 const forecasts=new Map<string,any>(),observations=new Map<string,any>(),meteo=new Map<string,any>(),eveningEvidence:any[]=[],qualified:any[]=[];
 const archiveRead={partial:false,rejectedFiles:0,boundedRead:false,unavailableSources:[] as string[]};
 const family=async(name:string,read:()=>Promise<void>)=>{try{await read();}catch{archiveRead.unavailableSources.push(name);}};
 const rows=(result:any,limit:number)=>{if(!Array.isArray(result?.results))throw Error('Index indisponible');if(result.results.length>limit)archiveRead.boundedRead=true;return result.results.slice(0,limit);};
 const file=async(read:()=>Promise<void>)=>{try{await read();}catch{archiveRead.rejectedFiles++;}};
 const inside=(d:any)=>typeof d==='string'&&d>=start&&d<=end;
 const admit=(r:any)=>{
  if(!inside(r.date)||!names.includes(r.serviceName))return;const k=r.date+'/'+r.serviceName,old=forecasts.get(k);
  if(!old||Date.parse(r.collectedAt)>Date.parse(old.collectedAt))forecasts.set(k,r);
 };
 await family('restored',async()=>{
 const recovered=await env.DB.prepare("SELECT source_table,payload,digest FROM recovery_weather_history WHERE weather_date>=? AND weather_date<=? AND source_table IN ('forecasts','observations') ORDER BY weather_date DESC LIMIT 401").bind(shift(start,-15),end).all();
 for(const row of rows(recovered,400))await file(async()=>{const p=JSON.parse(row.payload);if(await sha(JSON.stringify(canonical(p)))!==row.digest)throw new ApiError('Archive restaurée non vérifiable.',503);
  // Alias documenté de l'ancien Hondeghem uniquement ; jamais Erquinghem-Lys.
  if(!['50.756_2.521',LOCATION].includes(p.locationKey))return;
  const clean={date:p.date,tempMax:number(p.tempMax),tempMin:number(p.tempMin),precipitation:number(p.precipitation),windSpeed:number(p.windSpeed),windGust:number(p.windGust),humidity:number(p.humidity),cloudCover:number(p.cloudCover),collectedAt:p.collectedAt,origin:'restored',source:p.source??'Archive d’origine',isQualified:false};
  if(row.source_table==='forecasts'){
   const candidates=[{...clean,serviceName:p.serviceName,serviceCategory:'expert'}];
   const daily=p.rawData?.daily;
   if(Array.isArray(daily?.time)&&daily.time.length<=16)daily.time.forEach((d:any,i:number)=>{
    if(!inside(d))return;const values:Record<string,number|null>={};
    for(const [field,key] of [['tempMax','temperature_2m_max'],['tempMin','temperature_2m_min'],['precipitation','precipitation_sum'],['windSpeed','wind_speed_10m_max'],['windGust','wind_gusts_10m_max'],['humidity','relative_humidity_2m_mean'],['cloudCover','cloud_cover_mean']])values[field]=number(daily[key]?.[i]);
    if(Object.values(values).some(v=>v!==null))candidates.push({...clean,...values,date:d,serviceName:p.serviceName,serviceCategory:'expert'});
   });
   candidates.forEach(admit);
  }
  else if(inside(p.date)){const old=observations.get(p.date);if(!old||Date.parse(clean.collectedAt)>Date.parse(old.collectedAt))observations.set(p.date,clean);}
 });
 });
 // Une réception représentative par date et origine ; toutes les fenêtres restent bornées.
 const since=shift(start,-15)+'T00:00:00.000Z';
 await family('daily_captures',async()=>{
 const metadata=await env.DB.prepare('SELECT * FROM weather_daily_captures WHERE location_key=? AND received_at IN (SELECT MAX(received_at) FROM weather_daily_captures WHERE location_key=? AND received_at>=? AND received_at<=? GROUP BY substr(received_at,1,10),origin) ORDER BY received_at DESC LIMIT 97').bind(LOCATION,LOCATION,since,new Date(now).toISOString()).all();
 for(const row of rows(metadata,96))await file(async()=>{const v=await verifyDailyCapture(row,env,now);for(const day of v.payload.days){if(inside(day.date))for(const f of day.forecasts)admit({...f,date:day.date,collectedAt:v.receivedAt,serviceCategory:'expert',origin:row.origin});}});
 });
 await family('server_forecasts',async()=>{
 const signed=await env.DB.prepare('SELECT * FROM weather_learning_forecasts WHERE location_key=? AND received_at IN (SELECT MAX(received_at) FROM weather_learning_forecasts WHERE location_key=? AND received_at>=? AND received_at<=? GROUP BY CAST(received_at/86400000 AS INTEGER)) ORDER BY received_at DESC LIMIT 47').bind(LOCATION,LOCATION,Date.parse(since),now).all();
 for(const row of rows(signed,46))await file(async()=>{
  const p=await readSigned(row,'forecasts',env);
  if(p.kind!=='server_daily_forecast'||p.availableAt!==row.received_at||p.availableAt>now||!Array.isArray(p.days))throw new ApiError('Capture serveur invalide.',503);
  const candidates=p.days.flatMap((day:any)=>{
   if(!day||!Array.isArray(day.forecasts))throw new ApiError('Capture serveur invalide.',503);
   return inside(day.date)?day.forecasts.map((f:any)=>({...f,date:day.date,collectedAt:new Date(p.availableAt).toISOString(),serviceCategory:'expert',origin:'server'})):[];
  });
  candidates.forEach(admit);
 });
 });
 await family('qualified_days',async()=>{
 const scanned=await scanVerifiedLearningDays(env,now,p=>{if(!inside(p.date)||p.kind!=='qualified_learning_day')return;qualified.push(p);observations.set(p.date,{date:p.date,...p.observation,isQualified:true,origin:'qualified_server'});eveningEvidence.push({date:p.date,...p.observation,isQualified:true});},{startDate:start,endDate:end});
 archiveRead.rejectedFiles+=scanned.filesRejected;archiveRead.boundedRead||=scanned.boundedRead;
 });
 await family('fusion_snapshots',async()=>{for(const p of await readFusionSnapshots(env,now,{start,end},()=>{archiveRead.rejectedFiles++;}))if(inside(p.date)&&!meteo.has(p.date))meteo.set(p.date,{date:p.date,...p.values,computedAt:p.computedAt,origin:p.origin});});
 archiveRead.partial=archiveRead.rejectedFiles>0||archiveRead.boundedRead||archiveRead.unavailableSources.length>0;
 if(archiveRead.partial&&!forecasts.size&&!observations.size&&!meteo.size&&!qualified.length)throw new ApiError('Aucune archive vérifiable disponible pour cette lecture.',503);
 return {forecasts:Array.from(forecasts.values()),observations:Array.from(observations.values()),meteoAIForecasts:Array.from(meteo.values()),eveningEvidence,qualified,startDate:start,endDate:end,archiveRead};
}
export async function readHistoryPage(input:any,env:any,now=Date.now()){
 const days=input?.days??14;if(![7,14,30].includes(days))throw new ApiError('Période historique invalide.');
 const c=coordinates(input),end=date(now),start=shift(end,1-days);
 if(c.lat!==50.7567||c.lon!==2.5204)return {forecasts:[],observations:[],meteoAIForecasts:[],eveningEvidence:[],startDate:start,endDate:end};
 const {qualified,...result}=await loadRange(start,end,env,now);return result;
}
export async function readReportPage(input:any,env:any,now=Date.now()){
 const target=input?.date??date(now);if(typeof target!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(target)||!Number.isFinite(Date.parse(target+'T12:00:00Z'))||shift(target,0)!==target||target<shift(date(now),-365)||target>shift(date(now),15))throw new ApiError('Date de rapport invalide.');
 const c=coordinates(input),empty={forecasts:[],observations:[],meteoAIForecasts:[],qualified:[]},h=c.lat===50.7567&&c.lon===2.5204?await loadRange(target,target,env,now):empty;
 const observation=h.observations.find((o:any)=>o.date===target)??null,actual=h.meteoAIForecasts.find((f:any)=>f.date===target)??null;
 const latest=new Map<string,any>();for(const p of h.qualified)for(const pair of p.pairs){const key=pair.serviceName+'/'+pair.variable,old=latest.get(key);if(!old||pair.forecastAvailableAt>old.forecastAvailableAt)latest.set(key,pair);}
 const groups=new Map<string,any>();for(const pair of latest.values()){let r=groups.get(pair.serviceName);if(!r){r={modelName:pair.serviceName,targetDate:target,horizonDays:null};groups.set(pair.serviceName,r);}const key=({temperature_max:'temperatureMax',temperature_min:'temperatureMin',precipitation_sum:'precipitation',wind_speed_max:'windSpeed',wind_gust_max:'windGust',cloud_cover:'cloudCover'} as any)[pair.variable];if(key){const diff=pair.forecastValue-pair.observedValue;r[key]={comparisonCount:1,signedDifference:diff,absoluteError:Math.abs(diff)};}}
 return {archiveRead:'archiveRead' in h?h.archiveRead:undefined,date:target,forecasts:h.forecasts,observation,meteoAI:{tempMax:null,tempMin:null,precipitation:null,windSpeed:null,...actual,explanation:actual?'Sortie fusionnée archivée au calcul indiqué ; distincte d’une mesure et d’un score qualifié.':'Aucune sortie fusionnée immuable archivée pour cette date. Les modèles disponibles restent détaillés ci-dessous.'},modelAgreement:summarizeDailyModelAgreement(h.forecasts.map((f:any)=>({...f,modelName:f.serviceName})),names,null),precipitationConsensus:summarizePrecipitationModels(h.forecasts.map((f:any)=>({modelName:f.serviceName,amountMm:f.precipitation})),names),observationComparisons:Array.from(groups.values())};
}

import {buildAuxiliaryLearningComparisons,isAdmissibleAuxiliaryComparison} from './auxiliary-learning';
import {collectProviderRunBatch} from '../server/providerRunCollection';
import {evaluateProviderRunForecasts,structurallyValidProviderRunValue,type ProviderRunForecastValue} from '../server/providerRunHorizon';
import {getDailyForecastValidTime} from '../server/dailyForecastVerification';
import {getParisDateAndHour} from '../server/parisHourlyTime';
import {getForecastHorizonWindow} from '../shared/forecastHorizon';
import {saveSigned,readSigned} from './learning-store';
import {readLearningProviderLimit,recordLearningProviderLimit} from './provider-rate-limit';
// Plan groupé : contrôle des cycles déjà signés et suspension persistante après 429.
const LOCATION='50.757_2.520',HOUR=3600000,CHANNEL='learning_provider_runs_v3';
const fields:Record<string,string>={temperature:'temperature',precipitation:'precipitation',wind_speed:'windSpeed',wind_gust:'windGusts',humidity:'humidity',pressure:'pressure'};

/** Archives internes de cycles réellement datés ; aucun cycle n'est déduit de la réception. */
export async function recordLearningProviderRun(values:ProviderRunForecastValue[],env:any,now=Date.now()){
 if(!values.length||values.length>1500)throw Error('Cycle fournisseur vide ou trop grand');
 const first=values[0],seen=new Set<string>();
 for(const row of values){
  const key=row.validTime+'/'+row.variable;
  if(!structurallyValidProviderRunValue(row)||row.locationKey!==LOCATION||row.modelId!==first.modelId||row.modelName!==first.modelName||row.captureRunId!==first.captureRunId||row.metadataPublicationBasis!==first.metadataPublicationBasis||row.providerRunAt!==first.providerRunAt||row.availableAt!==first.availableAt||row.availableAt>now||now-row.availableAt>600000||row.validTime>row.availableAt+72*HOUR||getParisDateAndHour(row.validTime)?.date!==row.targetDate||!['temperature','precipitation','wind_speed','wind_gust','humidity','pressure','pressure_msl','rain','showers','snowfall'].includes(row.variable)||row.value!==null&&(!Number.isFinite(row.value)||Math.abs(row.value)>100000)||seen.has(key))throw Error('Cycle fournisseur non vérifiable');
  seen.add(key);
 }
 const id=LOCATION+'/'+first.modelId+'/'+first.providerRunAt;
 if(await env.DB.prepare('SELECT id FROM weather_learning_provider_runs WHERE id=?').bind(id).first())return {stored:false};
 const payload={version:1,kind:'server_provider_run',location:LOCATION,modelId:first.modelId,providerRunAt:first.providerRunAt,availableAt:first.availableAt,values};
 const {digest,objectKey}=await saveSigned(payload,'runs',env);
 await env.DB.prepare('INSERT INTO weather_learning_provider_runs(id,location_key,model_id,provider_run_at,received_at,object_key,digest) VALUES (?,?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING').bind(id,LOCATION,first.modelId,first.providerRunAt,first.availableAt,objectKey,digest).run();
 return {stored:true};
}
async function verifyRun(index:any,env:any,now:number){
 const p=await readSigned(index,'runs',env);
 if(p.kind!=='server_provider_run'||p.modelId!==index.model_id||p.providerRunAt!==index.provider_run_at||p.availableAt!==index.received_at||p.availableAt>now||index.id!==LOCATION+'/'+p.modelId+'/'+p.providerRunAt||!Array.isArray(p.values)||!p.values.length||p.values.length>1500)throw Error('Cycle fournisseur incohérent');
 const seen=new Set<string>();
 for(const value of p.values){const key=value.validTime+'/'+value.variable;
  if(!structurallyValidProviderRunValue(value)||value.locationKey!==LOCATION||value.providerRunAt!==p.providerRunAt||value.modelId!==p.modelId||value.availableAt!==p.availableAt||value.metadataPublicationBasis!==p.values[0].metadataPublicationBasis||seen.has(key)||getParisDateAndHour(value.validTime)?.date!==value.targetDate)throw Error('Valeur de cycle incohérente');seen.add(key);
 }
 return p;
}

/** Lecture descriptive bornée des cycles signés, sans collecte ni écriture.
 * Les réceptions tardives seront écartées par l'appariement aux observations. */
export async function readProviderComparisonValues(env:any,start:number,end:number,now=Date.now()){
 if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start>=end||end>now||end-start>8*24*HOUR)throw Error('Fenêtre de comparaison invalide');
 const result=await env.DB.prepare('SELECT * FROM weather_learning_provider_runs WHERE location_key=? AND received_at>=? AND received_at<=? ORDER BY received_at DESC,id ASC LIMIT 65').bind(LOCATION,start-72*HOUR,Math.min(end,now)).all();
 if(!Array.isArray(result?.results))throw Error('Archives de modèles indisponibles');
 const values:ProviderRunForecastValue[]=[];let filesRejected=0;
 for(const index of result.results.slice(0,64)){
  try{const p=await verifyRun(index,env,now);values.push(...p.values.filter((v:any)=>v.variable==='temperature'&&v.validTime>=start&&v.validTime<end));}catch{filesRejected++;}
 }
 return {values,filesRejected,filesChecked:Math.min(64,result.results.length),boundedRead:result.results.length>64};
}
export async function collectLearningProviderRuns(env:any,now=Date.now()){
 const suspended=await readLearningProviderLimit(env,'single_runs',now);
 if(suspended)return {attempted:false,status:'rate_limited',retryAt:suspended.retryAt,stored:0};
 const at=new Date(now).toISOString(),cutoff=new Date(now-3600000).toISOString();
 const lease=await env.DB.prepare('INSERT INTO weather_collection_status(channel,attempted_at,status,message) VALUES (?,?,?,?) ON CONFLICT(channel) DO UPDATE SET attempted_at=excluded.attempted_at,status=excluded.status,message=excluded.message WHERE weather_collection_status.attempted_at<=? RETURNING channel').bind(CHANNEL,at,'running','Cycles fournisseur exacts',cutoff).first();
 if(!lease)return {attempted:false,status:'cached'};
 let stored=0;try{
  const batch=await collectProviderRunBatch({targetDate:getParisDateAndHour(now)!.date,locationKey:LOCATION,latitude:50.7567,longitude:2.5204,
   hasCapturedRun:async(_modelName,modelId,providerRunAt)=>{
    const index=await env.DB.prepare('SELECT * FROM weather_learning_provider_runs WHERE id=?').bind(LOCATION+'/'+modelId+'/'+providerRunAt).first();
    if(!index)return false;
    await verifyRun(index,env,now);return true;
   }});
  if(batch.rateLimit)await recordLearningProviderLimit(env,'single_runs',batch.rateLimit,Date.now());
  for(const capture of batch.captures){const values=batch.values.filter(v=>v.captureRunId===capture.captureRunId);if(values.length){const result=await recordLearningProviderRun(values,env);if(result.stored)stored++;}}
  const status=batch.rateLimit?'rate_limited':batch.values.length||batch.captures.some(c=>c.status==='already_archived')?'ok':'failed';
  const summary={version:2,models:batch.captures.filter(c=>['succeeded','already_archived'].includes(c.status)).map(c=>c.modelName),attempts:batch.captures.map(c=>({model:c.modelName,status:c.status,httpStatus:c.responseStatus,reasonCode:c.reasonCode,
   metadataHttpStatus:c.metadataHttpStatus,metadataAvailableAt:c.metadataAvailableAt,providerRunAt:c.providerRunAt,requestStartedAt:c.requestStartedAt,availableAt:c.availableAt,
   collectionLatencyMilliseconds:c.collectionLatencyMilliseconds,valuesStored:c.valuesStored,minimumForecastLeadMilliseconds:c.minimumForecastLeadMilliseconds,maximumForecastLeadMilliseconds:c.maximumForecastLeadMilliseconds,
   ...('metadataPublicationBasis' in c?{metadataPublicationBasis:c.metadataPublicationBasis}:{})})),retryAt:batch.rateLimit?.retryAt??null};
  await env.DB.prepare('UPDATE weather_collection_status SET status=?,message=? WHERE channel=? AND attempted_at=?').bind(status,JSON.stringify(summary),CHANNEL,at).run();
  return {attempted:true,status,stored,...summary};
 }catch{
  await env.DB.prepare('UPDATE weather_collection_status SET status=?,message=? WHERE channel=? AND attempted_at=?').bind('failed','Collecte de cycles indisponible ; archives conservées',CHANNEL,at).run();return {attempted:true,status:'failed',stored};
 }
}

export async function readProviderValuesForDay(env:any,date:string,now:number){
 const end=getDailyForecastValidTime(date);if(end==null||end>now)throw Error('Journée horaire non terminée');
 const result=await env.DB.prepare('SELECT * FROM weather_learning_provider_runs WHERE location_key=? AND received_at>=? AND received_at<? ORDER BY received_at DESC LIMIT 65').bind(LOCATION,end-4*24*HOUR,end).all();
 if(!Array.isArray(result?.results))throw Error('Cycles horaires indisponibles');
 const values:ProviderRunForecastValue[]=[],provenance:any[]=[];
 for(const index of result.results.slice(0,64)){const p=await verifyRun(index,env,now);provenance.push({id:index.id,digest:index.digest});values.push(...p.values.filter((v:any)=>v.targetDate===date));}
 return {values,provenance,boundedRead:result.results.length>64};
}
function scoreComparisons(comparisons:any[],computedAt:number){
 const bucket=new Map<string,any>(),exact=new Map<string,any>();
 for(const row of comparisons){
  const horizon=getForecastHorizonWindow(row.forecastLeadTimeMilliseconds/60000);if(!horizon)continue;
  const common=[row.modelName,row.modelId,row.variable,row.observationDate,row.validTime];
  for(const [map,key] of [[bucket,[...common,horizon.key].join('|')],[exact,[...common,row.forecastLeadTimeMilliseconds].join('|')]] as const){
   const previous=map.get(key);if(!previous||previous.availableAt<row.availableAt)map.set(key,row);
  }
 }
 const aggregate=(items:any[],exactLead:boolean)=>{
  const grouped=new Map<string,any[]>();for(const row of items){const h=getForecastHorizonWindow(row.forecastLeadTimeMilliseconds/60000)!.key,key=[row.modelName,row.modelId,row.variable,row.observationDate,exactLead?row.forecastLeadTimeMilliseconds:h].join('|');grouped.set(key,[...(grouped.get(key)??[]),row]);}
  return Array.from(grouped.values()).map(rows=>{
   const first=rows[0],errors=rows.map(r=>r.forecastValue-r.observedValue),n=rows.length;
   return {date:first.observationDate,sourceName:'open-meteo',modelName:first.modelName,modelId:first.modelId,variable:first.variable,horizonBucket:getForecastHorizonWindow(first.forecastLeadTimeMilliseconds/60000)!.key,...(exactLead?{horizonMilliseconds:first.forecastLeadTimeMilliseconds}:{}),leadBasis:'provider_run' as const,scoringValidationVersion:2,sampleSize:n,mae:errors.reduce((s,e)=>s+Math.abs(e),0)/n,rmse:Math.sqrt(errors.reduce((s,e)=>s+e*e,0)/n),bias:errors.reduce((s,e)=>s+e,0)/n,computedAt:new Date(computedAt).toISOString()};
  }).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)));
 };
 return {scores:aggregate(Array.from(bucket.values()),false),exactScores:aggregate(Array.from(exact.values()),true)};
}
export function buildProviderLearningScores(snapshots:any[],values:ProviderRunForecastValue[],now:number){
 const evaluation=evaluateProviderRunForecasts(snapshots,values);
 const comparisons=evaluation.comparisons.filter(row=>row.variable==='temperature'||row.variable==='humidity'&&(snapshots.find(s=>s.date===row.observationDate&&s.hour===row.observationHour)?.humidityStationCount??0)>=3&&row.observedValue>=0&&row.observedValue<=100&&row.forecastValue>=0&&row.forecastValue<=100).map(({stationsUsed:_stations,...row})=>({...row,...(row.variable==='humidity'?{stationCount:snapshots.find(s=>s.date===row.observationDate&&s.hour===row.observationHour)?.humidityStationCount??0}:{})}));
 const allComparisons=[...comparisons,...buildAuxiliaryLearningComparisons(snapshots,values)];
 return {comparisons:allComparisons,...scoreComparisons(allComparisons,now)};
}
export function verifyProviderLearningScores(hourly:any,date:string,computedAt:number){
 if(!Array.isArray(hourly?.comparisons)||hourly.comparisons.length>5000)throw Error('Comparaisons horaires invalides');
 for(const row of hourly.comparisons){if(row.locationKey!==LOCATION||!['temperature','humidity'].includes(row.variable)&&!isAdmissibleAuxiliaryComparison(row)||row.variable==='humidity'&&(row.stationCount<3||row.observedValue<0||row.observedValue>100||row.forecastValue<0||row.forecastValue>100)||row.observationDate!==date||row.availableAt>=row.validTime||row.validTime-row.providerRunAt!==row.forecastLeadTimeMilliseconds||!Number.isFinite(row.forecastValue)||!Number.isFinite(row.observedValue))throw Error('Comparaison horaire non admissible');}
 const expected=scoreComparisons(hourly.comparisons,computedAt);
 if(JSON.stringify(expected.scores)!==JSON.stringify(hourly.scores)||JSON.stringify(expected.exactScores)!==JSON.stringify(hourly.exactScores))throw Error('Scores horaires non reproductibles');
}
export async function readFutureProviderModels(env:any,now:number){
 const result=await env.DB.prepare('SELECT * FROM weather_learning_provider_runs WHERE location_key=? AND received_at>=? AND received_at<=? ORDER BY provider_run_at DESC,received_at ASC LIMIT 65').bind(LOCATION,now-24*HOUR,now).all();
 if(!Array.isArray(result?.results))throw Error('Cycles courants indisponibles');
 let filesRejected=0;const selected=new Map<string,any>(),revision:string[]=[];
 for(const index of result.results.slice(0,64)){
  if(selected.has(index.model_id))continue;
  try{const p=await verifyRun(index,env,now);selected.set(index.model_id,p);revision.push(index.digest);}catch{filesRejected++;}
 }
 const models=[];
 for(const p of Array.from(selected.values())){
  const first=p.values[0],hours=new Map<number,any>();
  for(const value of p.values){if(value.validTime<=now||value.value===null||!fields[value.variable])continue;const local=getParisDateAndHour(value.validTime);if(!local)continue;
   const hour=hours.get(value.validTime)??{date:local.date,hour:local.hour,validAt:value.validTime,temperature:null,precipitation:null,windSpeed:null,windGusts:null,humidity:null,pressure:null};hour[fields[value.variable]]=value.value;hours.set(value.validTime,hour);
  }
  if(hours.size)models.push({modelName:first.modelName,modelId:p.modelId,sourceName:'open-meteo',captureRunId:first.captureRunId,providerRunAt:p.providerRunAt,availableAt:p.availableAt,requestStartedAt:first.requestStartedAt,hours:Array.from(hours.values()).sort((a,b)=>a.validAt-b.validAt)});
 }
 return {models,filesRejected,boundedRead:result.results.length>64,revision:revision.join('|'),runCount:selected.size};
}

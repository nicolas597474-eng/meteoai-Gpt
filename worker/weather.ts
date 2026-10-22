import { collectCurrentWeatherSnapshot, collectHourlyForecastAllModelsWithDiagnostics, collect15DayForecast, HONDEGHEM } from '../server/weatherServices';
import { computeOfficialHourlyForecast } from '../server/officialHourlyForecast';
import { computeOfficialDailyForecastWithDiagnostics } from '../server/officialForecast';
import { buildOperationalRegime, findNextHourlyRegimeChange } from '../server/officialRegime';
import { findActiveHourlyForecastIndex } from '../shared/hourlyForecastTime';
import { projectHourlyForecastForDashboard, projectDailyForecastForDashboard } from '../server/forecastResponseProjection';
import { getParisDate, getParisHour } from '../server/weatherTime';
import { EXTENDED_REGIME_INFO } from '../server/fusionEngine';
import { makeLocationKey } from './history-bridge';
import {projectLiveComparison} from '../shared/liveModelComparison';
import {projectDashboardFusionTrace} from '../shared/dashboardFusionTrace';
import {buildAILabReadModel,type AILabDailyDetail} from '../shared/aiLabReadModel';
import {learningPerformance,selectLearnedProviderForecasts} from '../shared/qualifiedLearning';
import {HOURLY_FORECAST_CACHE_MS,DAILY_FORECAST_CACHE_MS,MAX_SAVED_FORECAST_MS} from '../shared/forecastCachePolicy';
import {recordMeteoAIForecast} from './meteoai-history';

const flights = new Map<string, Promise<any>>();
export async function cached(key: string, env: any, ctx: any, loader: () => Promise<any>, ttl = 300000): Promise<any> {
 const storageKey='controle/weather-v2/'+key;
 if(flights.has(key)) return flights.get(key);
 const stored=await env.BUCKET.get(storageKey).then((v:any)=>v?.json()).catch(()=>null);
 const previous=stored&&Number.isFinite(stored.at)&&stored.at<=Date.now()&&Date.now()-stored.at<=MAX_SAVED_FORECAST_MS?stored:null;
 if(previous && Number.isFinite(previous.at) && previous.at<=Date.now() && Date.now()-previous.at<ttl && !env.forceFreshWeather){
  // Optional browser accounting; a server archive read stays free of writes.
  env.onForecastCacheReuse?.(key);
  return previous.value;
 }
 // Une autre requête a pu démarrer pendant la lecture asynchrone du cache.
 if(flights.has(key)) return flights.get(key);
 const pending=loader().then(async value=>{if(value==null)throw new Error('La source météo courante est momentanément indisponible.');await env.BUCKET.put(storageKey,JSON.stringify({at:Date.now(),value}));return value;}).finally(()=>flights.delete(key));
 if(flights.size>=32) flights.delete(flights.keys().next().value!);
 flights.set(key,pending);
 // Le navigateur possède déjà son cache persistant avec rafraîchissement en
 // arrière-plan. Ne pas y enregistrer une seconde réponse périmée comme neuve.
 if(previous && !env.waitForFreshWeather){ctx.waitUntil(pending.catch(()=>{}));return {...previous.value,...(previous.value?.officialSnapshot?{officialSnapshot:{...previous.value.officialSnapshot,snapshotStatus:'stale',staleReason:'refreshing_previous_snapshot'}}:{}),controlCache:{stale:true,cachedAt:new Date(previous.at).toISOString()}};}
 return pending;
}
export function coordinates(input: any) {
 const lat=input?.lat??HONDEGHEM.lat,lon=input?.lon??HONDEGHEM.lon;
 if(!Number.isFinite(lat)||!Number.isFinite(lon)||lat < -90 || lat>90 || lon < -180 || lon>180) throw new Error('Coordonnées invalides');
 return {lat,lon};
}
export async function current(input: any,env: any,ctx: any){const coords=coordinates(input);return cached('current/'+makeLocationKey(coords.lat,coords.lon),env,ctx,()=>collectCurrentWeatherSnapshot(coords,{quotaStore:env.openMeteoQuota}),60000);}
async function modelCollection(input:any,env:any,ctx:any){
 const coords=coordinates(input),today=getParisDate();
 return cached('model-collection-v1/'+makeLocationKey(coords.lat,coords.lon)+'/'+today,env,ctx,async()=>{
  const startedAt=Date.now();
  const collection=await collectHourlyForecastAllModelsWithDiagnostics(today,coords,{includeBestMatch:true,includeNextDay:true,forecastDays:2,timeoutMs:6000,retryBudgetMs:0,quotaStore:env.openMeteoQuota});
  if(env.archiveCollectionJournal&&coords.lat===HONDEGHEM.lat&&coords.lon===HONDEGHEM.lon)ctx.waitUntil(env.archiveCollectionJournal({...coords,startedAt,completedAt:Date.now(),diagnostics:collection.diagnostics}).catch(()=>{}));
  if(!collection.forecasts.length)throw Error('Les sources Open-Meteo sont momentanément indisponibles.');
  const receivedAt=Date.now();
  // Archive only a newly received batch; recomputing from the device cache is not a new capture.
  if(env.archiveForecasts&&coords.lat===HONDEGHEM.lat&&coords.lon===HONDEGHEM.lon)ctx.waitUntil(env.archiveForecasts({capturedAt:receivedAt,...coords,models:collection.forecasts.filter((m:any)=>m.modelName!=='best_match')}).catch(()=>{}));
  return {...collection,collectedAt:new Date(receivedAt).toISOString()};
 },HOURLY_FORECAST_CACHE_MS);
}
async function hourly(input:any,env:any,ctx:any){
 const coords=coordinates(input),today=getParisDate();
 const learning=env.getLearningEvidence?await env.getLearningEvidence(coords).catch(()=>null):null;
 return cached('hourly-v5/'+makeLocationKey(coords.lat,coords.lon)+'/'+today+'/'+(learning?.revision??'unavailable'),env,ctx,async()=>{
  const [collection,snapshot]=await Promise.all([
   modelCollection(input,env,ctx),
   current(input,env,ctx).catch(()=>null),
  ]);
  const expertForecasts=collection.forecasts.filter((m:any)=>m.modelName!=='best_match');
  const referenceAt=Date.now();
  const selectedForecasts=selectLearnedProviderForecasts(expertForecasts,learning,referenceAt);
  const computed=computeOfficialHourlyForecast(selectedForecasts,learning?.hourlyScores??[],{historyAvailable:learning?.available===true,historyBasis:'provider_run',exactHistoryAvailable:learning?.available===true,exactHistoryScores:learning?.exactHourlyScores??[],referenceAt,availabilityReasonByModel:Object.fromEntries(collection.diagnostics.filter((d:any)=>d.status!=='succeeded'&&d.modelName!=='best_match').map((d:any)=>[d.modelName,d.errorCode??d.status]))});
  if(!computed.hours.length)throw new Error('Prévisions fournisseur indisponibles : '+collection.diagnostics.map((d:any)=>d.modelName+' '+(d.errorCode??d.status)).join(', '));
  const at=new Date().toISOString(),hours=computed.hours;
  await recordMeteoAIForecast('hourly',hours,coords,env,Date.parse(at)).catch(()=>console.warn('Archivage MeteoAI horaire indisponible ; prévisions conservées.'));
  const index=findActiveHourlyForecastIndex(hours,Date.now()),h=hours[index]??hours[0];
  const regime=buildOperationalRegime(null,null,h?{temp:h.temp,precipitation:h.precipitation,windSpeed:h.windSpeed,humidity:h.humidity,cloudCover:h.cloudCover,visibilityKm:h.visibility??null,validAt:h.validAt??null,updatedAt:new Date(at),sourceUpdatedAt:at,sourceLabel:'Prévision horaire officielle · moteur original'}:null);
  return {today,currentSnapshot:snapshot,hours,days:[],modelsUsed:expertForecasts.map((m:any)=>m.modelName),dailyStatus:'not_requested',dailyFallback:null,
   learningSummary:learning?{available:learning.available,scoreCount:learning.scoreCount,qualifiedDays:learning.qualifiedDays,hourlyEvidenceDays:learning.hourlyEvidenceDays,qualifiedGroups:learning.qualifiedGroups,lastScoreAt:learning.lastScoreAt,filesRejected:learning.filesRejected}:null,
   officialSnapshot:{validAt:h?.validAt?new Date(h.validAt).toISOString():null,computedAt:at,hourlyComputedAt:at,sourceKind:'official_forecast',source:'open-meteo',hourlyWeighting:computed.weighting,hourlyStatus:hours.length?'ready':'not_ready',snapshotStatus:'live',staleReason:null},
   regime:{...regime,snapshotComputedAt:regime.snapshotComputedAt},nextRegimeChange:h&&regime.primary?findNextHourlyRegimeChange(hours,`${getParisHour()}:00`,regime.primary.id,h.validAt):null,
   fusionDiagnostics:projectDashboardFusionTrace(hours),trace:{available:true,message:'Poids du calcul courant disponibles ; apprentissage conditionné aux preuves qualifiées du modèle et de son horizon.'},migration:{calibration:learning?.available?'configured':'unavailable',horizonHours:48},
  };
 });
}
async function fullDaily(input:any,env:any,ctx:any){
 const coords=coordinates(input);
 const learning=env.getLearningEvidence?await env.getLearningEvidence(coords).catch(()=>null):null;
 return cached('daily-full-v4/'+makeLocationKey(coords.lat,coords.lon)+'/'+getParisDate()+'/'+(learning?.revision??'unavailable'),env,ctx,async()=>{
 const issuedAt=Date.now();
 const aiLabDetails:Record<string,AILabDailyDetail>={};
 const archiveDays:{date:string;forecasts:any[]}[]=[];
 const value=await collect15DayForecast(coords,{issuedAt,quotaStore:env.openMeteoQuota,resolveOfficialFusion:async(date,forecasts,referenceAt,availabilityReasonByModel)=>{
  archiveDays.push({date,forecasts});
  const fusion=computeOfficialDailyForecastWithDiagnostics(forecasts,{locationKey:makeLocationKey(coords.lat,coords.lon),targetDate:date,issuedAt,referenceAt,evidenceStoreAvailable:learning?.available===true,evidence:learning?.available?learningPerformance(learning.units,date,referenceAt):[],availabilityReasonByModel});
  // Conserver les valeurs et la trace existantes, sans recopier les réponses brutes fournisseur.
  aiLabDetails[date]={forecasts:forecasts.map(({serviceName,tempMax,tempMin,precipitation,windSpeed,windGust,humidity,cloudCover})=>({serviceName,tempMax,tempMin,precipitation,windSpeed,windGust,humidity,cloudCover})),trace:fusion.trace};
  return fusion;
 }});
 if(env.archiveDailyForecasts&&archiveDays.some(day=>day.forecasts.some(row=>[row.tempMax,row.tempMin,row.precipitation,row.windSpeed,row.windGust,row.humidity,row.cloudCover].some(v=>v!==null)))&&coords.lat===HONDEGHEM.lat&&coords.lon===HONDEGHEM.lon){
  ctx.waitUntil(env.archiveDailyForecasts({...coords,capturedAt:Date.now(),days:archiveDays.sort((a,b)=>a.date.localeCompare(b.date)),fusionSnapshot:aiLabDetails[getParisDate()]?{date:getParisDate(),computedAt:aiLabDetails[getParisDate()].trace.referenceAt,trace:aiLabDetails[getParisDate()].trace,values:value.days.find(day=>day.date===getParisDate())}:undefined}).catch(()=>{}));
 }
  if(!value.days.some(day=>[day.tempMax,day.tempMin,day.precipitation,day.windSpeed,day.windGust].some(v=>typeof v==='number'&&Number.isFinite(v))))throw Error('Prévisions quotidiennes indisponibles ; dernière réception conservée.');
  await recordMeteoAIForecast('daily',value.days,coords,env).catch(()=>console.warn('Archivage MeteoAI quotidien indisponible ; prévisions conservées.'));
  return {days:value.days,modelsUsed:value.modelsUsed,dailyStatus:value.days.length?'ready':'not_ready',aiLabDetails,collectedAt:new Date().toISOString(),learningSummary:learning?{available:learning.available,scoreCount:learning.scoreCount,qualifiedDays:learning.qualifiedDays,hourlyEvidenceDays:learning.hourlyEvidenceDays,qualifiedGroups:learning.qualifiedGroups,lastScoreAt:learning.lastScoreAt,filesRejected:learning.filesRejected}:null};
},DAILY_FORECAST_CACHE_MS);}
export async function liveModelComparison(input:any,env:any,ctx:any){
 const [collection,official]=await Promise.all([modelCollection(input,env,ctx),hourly(input,env,ctx).catch(()=>null)]);
 return projectLiveComparison(collection,official?.hours??[]);
}
export async function daily(input:any,env:any,ctx:any){const value=await fullDaily(input,env,ctx);return {days:projectDailyForecastForDashboard(value.days),modelsUsed:value.modelsUsed,dailyStatus:value.dailyStatus,collectedAt:value.collectedAt,...(value.controlCache?{controlCache:value.controlCache}:{})};}
export async function aiLab(input:any,env:any,ctx:any){
 const coords=coordinates(input);
 const [hours,days]=await Promise.allSettled([hourly(input,env,ctx),fullDaily(input,env,ctx)]);
 if(days.status==='rejected')console.warn('[AI Lab] Prévision quotidienne indisponible :',days.reason instanceof Error?days.reason.message:'échec du calcul quotidien');
 if(hours.status==='rejected'&&days.status==='rejected')throw new Error('Les prévisions nécessaires à AI Lab sont momentanément indisponibles.');
 return buildAILabReadModel(hours.status==='fulfilled'?hours.value:null,days.status==='fulfilled'?days.value:null,coords);
}
export async function detailed(input:any,env:any,ctx:any){
 // La première réponse reste rapide ; l'enrichissement demandé par la page
 // Prévisions réutilise le même cache quotidien que le tableau de bord.
 const [data,periods]=await Promise.all([
  hourly(input,env,ctx),
  input?.includeExtendedPeriods===true
   ? fullDaily(input,env,ctx).catch(()=>({days:[],modelsUsed:[],dailyStatus:'not_ready'}))
   : Promise.resolve(null),
 ]);
 return {...data,...(periods?{days:periods.days,dailyStatus:periods.dailyStatus,dailyModelsUsed:periods.modelsUsed}:{}),hours:input?.includeExtendedPeriods===false?projectHourlyForecastForDashboard(data.hours):data.hours};
}
export const regimeCatalogue=()=>Object.entries(EXTENDED_REGIME_INFO).map(([id,info])=>({id,...info}));

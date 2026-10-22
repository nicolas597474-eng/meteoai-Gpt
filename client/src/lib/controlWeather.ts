/** Collecte publique depuis l'appareil : évite de concentrer tous les visiteurs
 * derrière l'IP serveur mutualisée dont Open-Meteo a épuisé le quota quotidien.
 * Les collecteurs et les calculs sont ceux de la source restaurée. */
import {current,detailed,daily,aiLab,liveModelComparison,coordinates} from '../../../worker/weather';
import {getLearningHistory,learningHistoryGeneration} from './learningHistory';
import {normalizeCollectionJournal} from '../../../worker/collection-journal';
import {normalizeDailyCapture} from '../../../worker/daily-archive';
import {collectEnvironmentalData} from './environmentCollection';
import {collectLocalDashboardWeather} from './localDashboardWeather';
import {collectCurrentDashboardWeather} from './currentDashboardWeather';
import {collectStationSearch} from './stationSearch';
import {takeForecastReload} from './forecastRefreshRequest';
import superjson from 'superjson';
import {ForecastOfflineCache,markCachedForecast,offlineForecastStatus} from './forecastOffline';
import {PublicModelCache} from './publicModelCache';
import {observeOpenMeteo} from '../../../server/openMeteoTraffic';
const offlineCache=new ForecastOfflineCache({origin:window.location.origin,storage:globalThis.caches,online:()=>navigator.onLine,
 onStatus(key,result){const [name,lat,lon]=JSON.parse(key);const status={key,name,lat,lon,savedAt:result.entry.savedAt,reason:result.reason};offlineForecastStatus.set(key,status);if(offlineForecastStatus.size>24)offlineForecastStatus.delete(offlineForecastStatus.keys().next().value!);window.dispatchEvent(new CustomEvent('meteoai-offline-status'));},
 onRefresh(key){const [name]=JSON.parse(key);window.setTimeout(()=>window.dispatchEvent(new CustomEvent('meteoai-weather-refreshed',{detail:{name}})),0);},
});
const records=new Map<string,string>();
const publicModels=new PublicModelCache({origin:window.location.origin,storage:globalThis.caches});
let lastAILabLearningGeneration=learningHistoryGeneration();
const env={waitForFreshWeather:true,getLearningEvidence:getLearningHistory,onForecastCacheReuse(key:string){
 if(key.startsWith('model-collection-v1/'))observeOpenMeteo('https://api.open-meteo.com/v1/forecast?hourly=batch','cache');
 if(key.startsWith('daily-full-v4/'))observeOpenMeteo('https://api.open-meteo.com/v1/forecast?daily=batch','cache');
},async archiveDailyForecasts(payload:unknown){
 const response=await fetch('/api/history/daily-capture',{method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},body:JSON.stringify({...normalizeDailyCapture(payload),fusionSnapshot:(payload as any).fusionSnapshot?{...(payload as any).fusionSnapshot,values:Object.fromEntries(['tempMax','tempMin','precipitation','windSpeed','windGust','humidity','cloudCover'].map(key=>[key,(payload as any).fusionSnapshot.values?.[key]??null])),trace:{parameterSources:Object.fromEntries(['tempMax','precipitation','windSpeed'].map(key=>[key,((payload as any).fusionSnapshot.trace?.parameterSources?.[key]??[]).map((s:any)=>({name:s.name,finalWeight:s.finalWeight}))]))}}:undefined}),signal:AbortSignal.timeout(8000)});
 if(!response.ok)throw new Error('Archivage quotidien indisponible');
 window.dispatchEvent(new CustomEvent('meteoai-weather-refreshed',{detail:{name:'weather.getForecastCollectionReport'}}));
},async archiveCollectionJournal(payload:unknown){
 // Seuls les compteurs autorisés voyagent : les traces détaillées restent sur l’appareil.
 const journal=normalizeCollectionJournal(payload);
 const response=await fetch('/api/history/collection-journal',{method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},body:JSON.stringify(journal),signal:AbortSignal.timeout(8000)});
 if(!response.ok)throw new Error('Journal de collecte non enregistré');
 // Le bilan peut avoir été lu avant cette écriture asynchrone. Seule sa lecture est relancée.
 window.dispatchEvent(new CustomEvent('meteoai-weather-refreshed',{detail:{name:'weather.getForecastCollectionReport'}}));
 },BUCKET:{async get(key:string){
  if(/^controle\/weather-v2\/(model-collection-v1|daily-full-v4)\//.test(key))return publicModels.get(key);
  const text=records.get(key);return text?{json:async()=>JSON.parse(text)}:null;
 },async put(key:string,text:string){
  if(/^controle\/weather-v2\/(model-collection-v1|daily-full-v4)\//.test(key)){await publicModels.put(key,text);return;}
  if(text.length>8000000)return;if(records.size>=6&&!records.has(key))records.delete(records.keys().next().value!);records.set(key,text);
 }},async archiveForecasts(payload:unknown){
 // Le Site enregistre une capture future par heure et par source, sans clé API.
 const response=await fetch('/api/history/capture',{method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload),signal:AbortSignal.timeout(8000)});
 if(!response.ok)throw new Error('Archivage indisponible');
}};
const ctx={waitUntil(p:Promise<unknown>){p.catch(()=>{});}};
const supported=new Set(['weather.getAILab','weather.getApparentAstronomyPosition','weather.getTerrainHorizonProfile','weather.getEclipseCircumstances','weather.getEnvironmentalSnapshot','favorites.getLocationWeather','favorites.getCurrentDashboardWeather','weather.getCurrentModelSnapshot','weather.getDetailedForecast','weather.getDashboardDailyForecast','weather.get15DayForecast','weather.getHourlyForecast','weather.getModelComparison']);
supported.add('weather.searchStations');
export async function collectControlWeather(input:RequestInfo|URL):Promise<Response|null>{
 const url=new URL(typeof input==='string'?input:input instanceof URL?input.toString():input.url,window.location.origin);
 const name=url.pathname.replace('/api/trpc/','');if(!supported.has(name))return null;
 const serialized=JSON.parse(url.searchParams.get('input')??'{}');
 const value=serialized?.json==null?undefined:superjson.deserialize<any>(serialized);
 try{
  if(name==='favorites.getLocationWeather'&&!['standard','local','ultra-local'].includes(value?.localMode))throw new Error('Mode local invalide.');
  const point=coordinates(value),manualRefresh=name==='weather.getDetailedForecast'&&takeForecastReload(point.lat,point.lon,value?.includeExtendedPeriods===true);
  const runtimeEnv=manualRefresh?{...env,forceFreshWeather:true}:env;
  const loader=()=>name==='weather.getAILab'?aiLab(value,runtimeEnv,ctx):name==='weather.getApparentAstronomyPosition'?collectEnvironmentalData(coordinates(value),'position'):name==='weather.getTerrainHorizonProfile'?collectEnvironmentalData(coordinates(value),'terrain'):name==='weather.getEclipseCircumstances'?collectEnvironmentalData(coordinates(value),'eclipse',value.eventId):name==='weather.getEnvironmentalSnapshot'?collectEnvironmentalData(coordinates(value)):name==='favorites.getLocationWeather'?collectLocalDashboardWeather(coordinates(value),value.localMode,current(value,runtimeEnv,ctx)):name==='favorites.getCurrentDashboardWeather'?collectCurrentDashboardWeather(coordinates(value),current(value,runtimeEnv,ctx)):name==='weather.getModelComparison'?liveModelComparison(value,runtimeEnv,ctx):name==='weather.getCurrentModelSnapshot'?current(value,runtimeEnv,ctx):name==='weather.getDashboardDailyForecast'||name==='weather.get15DayForecast'?daily(value,runtimeEnv,ctx):detailed(value,runtimeEnv,ctx);
  let result:any;
  if(name==='weather.searchStations'){result=await collectStationSearch(value);}
  else if(['weather.getEnvironmentalSnapshot','weather.getApparentAstronomyPosition','weather.getTerrainHorizonProfile','weather.getEclipseCircumstances'].includes(name)){result=await loader();}
  else if(name==='favorites.getLocationWeather'||name==='favorites.getCurrentDashboardWeather'||name==='weather.getCurrentModelSnapshot'){
   if(!navigator.onLine)throw new Error('Les mesures courantes nécessitent une connexion.');
   result=await loader();
  }else{
   const coords=coordinates(value),key=JSON.stringify([name,coords.lat,coords.lon,value?.includeExtendedPeriods??null]);
   const generation=learningHistoryGeneration();
   const cached=await offlineCache.get(key,async()=>{
    const data=await loader();
    if(!data||!data.hours?.length&&!data.days?.length&&!data.slots?.length&&!data.forecastComparison?.hourlyForecast?.points?.length&&!data.calculatedAt)throw new Error('Aucune prévision reçue.');
    const originalDate=data.controlCache?.cachedAt??data.officialSnapshot?.computedAt??data.collectedAt;
    const sourceAt=originalDate?Date.parse(originalDate):Date.now();
    return {savedAt:Number.isFinite(sourceAt)?sourceAt:Date.now(),payload:superjson.serialize(data)};
   },manualRefresh||name==='weather.getAILab'&&generation!==lastAILabLearningGeneration);
   if(name==='weather.getAILab'&&!cached.fromCache)lastAILabLearningGeneration=generation;
   result=superjson.deserialize(cached.entry.payload);
   if(cached.fromCache&&cached.reason!=='fresh')result=markCachedForecast(result,cached.entry.savedAt);
  }
  return Response.json({result:{data:superjson.serialize(result)}},{headers:{'Cache-Control':'no-store','X-MeteoAI-Collection':'browser-direct-open-meteo'}});
 }catch(error){return Response.json({error:{json:{message:'Météo temporairement indisponible depuis votre appareil. '+(error instanceof Error?error.message:''),code:-32603,data:{code:'INTERNAL_SERVER_ERROR',httpStatus:503,path:name}}}});}
}

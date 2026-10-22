import {HONDEGHEM} from '../server/weatherServices';
import {LEARNING_COLLECTION_CHANNEL,recordLearningForecast,readLearningHistory,finalizeLearningDays,readSigned} from './learning-store';
import {collectLearningProviderRuns} from './learning-provider-runs';
import {collectDailyForecastBatch,deriveDailyFromVerifiedCycles,mergeDailySources} from './daily-forecast-collection';
import {finalizeMeteoAIHistory} from './meteoai-history';

let refresh:Promise<any>|undefined;
/** Reprise partagée à la consultation ; les baux SQL empêchent les doubles collectes. */
export function refreshQualifiedLearning(env:any){
 if(refresh)return refresh;
 refresh=(async()=>{
  await readLearningHistory(env);
  // Un flux défaillant ne doit pas supprimer les collectes indépendantes.
  const providerCollection=await collectLearningProviderRuns(env).catch(()=>({attempted:false,status:'failed',stored:0}));
  const collection=await collectLearningForecasts(env).catch(()=>({attempted:false,status:'failed',stored:false}));
  const qualification=await finalizeLearningDays(env).catch(()=>({available:false,status:'failed',stored:0})),history=await readLearningHistory(env);
  await finalizeMeteoAIHistory(env).catch(()=>console.warn('Comparaisons MeteoAI indisponibles ; archives conservées.'));
  return {available:true,collection,providerCollection,qualification,qualifiedDays:history.qualifiedDays,scoreCount:history.scoreCount,qualifiedGroups:history.qualifiedGroups,providerRunCount:history.providerRunCount};
 })().finally(()=>{refresh=undefined;});return refresh;
}

/** Dix minutes entre essais d'un même créneau ; nouvelle heure après un essai terminé.
 * Un bail encore actif ne peut pas être repris au seul changement d'heure. */
export async function collectLearningForecasts(env:any,now=Date.now()){
 const at=new Date(now).toISOString(),cutoff=new Date(now-600000).toISOString();
 const lease=await env.DB.prepare("INSERT INTO weather_collection_status(channel,attempted_at,status,message) VALUES (?,?,?,?) ON CONFLICT(channel) DO UPDATE SET attempted_at=excluded.attempted_at,status=excluded.status,message=excluded.message WHERE weather_collection_status.attempted_at<=? OR (weather_collection_status.status<>'running' AND weather_collection_status.attempted_at<excluded.attempted_at AND substr(weather_collection_status.attempted_at,1,13)<>substr(excluded.attempted_at,1,13)) RETURNING channel").bind(LEARNING_COLLECTION_CHANNEL,at,'running','Collecte quotidienne serveur pour apprentissage',cutoff).first();
 if(!lease)return {attempted:false,status:'cached'};
 try{
  const id='50.757_2.520/'+new Date(now).toISOString().slice(0,13);
  const existing=await env.DB.prepare('SELECT * FROM weather_learning_forecasts WHERE id=?').bind(id).first();
  let result:any,days:any[],provenance:any;
  if(existing){const p=await readSigned(existing,'forecasts',env);if(p.kind!=='server_daily_forecast'||p.availableAt!==existing.received_at)throw Error('Capture existante invalide');days=p.days;provenance=p.provenance??{mode:'forecast_api'};result={stored:false};}
  else{
   const [batch,derived]=await Promise.all([collectDailyForecastBatch(now,env).catch(()=>({days:[],httpStatus:null})),deriveDailyFromVerifiedCycles(env,now).catch(()=>({days:[],coverage:[],sourceRevision:null}))]);
   const merged=mergeDailySources(batch.days,derived.days);days=merged.days;
   if(!days.length)throw Error('Aucune journée complète disponible');
   provenance={mode:merged.derivedUsed?(batch.days.length?'mixed':'verified_hourly_cycles'):'forecast_api',timeZone:'Europe/Paris',sourceRevision:derived.sourceRevision,coverage:derived.coverage,forecastApiStatus:batch.httpStatus,forecastApiRequestStatus:'requestStatus' in batch?batch.requestStatus:'network_error',retryAt:'retryAt' in batch?batch.retryAt:null};
   const receipt=Date.now();result=await recordLearningForecast({...HONDEGHEM,capturedAt:receipt,days},env,receipt,provenance);
  }
  const summary={version:1,mode:provenance.mode,models:Array.from(new Set(days.flatMap(d=>d.forecasts.map((f:any)=>f.serviceName)))),dates:days.map(d=>d.date),forecastApiStatus:provenance.forecastApiStatus??null,forecastApiRequestStatus:provenance.forecastApiRequestStatus??null,retryAt:provenance.retryAt??null,reusedExisting:!!existing};
  await env.DB.prepare('UPDATE weather_collection_status SET status=?,message=? WHERE channel=? AND attempted_at=?').bind('ok',JSON.stringify(summary),LEARNING_COLLECTION_CHANNEL,at).run();
  return {attempted:true,status:'ok',stored:result.stored,...summary};
 }catch{
  await env.DB.prepare('UPDATE weather_collection_status SET status=?,message=? WHERE channel=? AND attempted_at=?').bind('failed','Prévisions serveur indisponibles ; archives existantes conservées',LEARNING_COLLECTION_CHANNEL,at).run();
  return {attempted:true,status:'failed',stored:false};
 }
}

import {OFFICIAL_HOURLY_MODELS} from '../server/officialModels';
import {buildForecastFlowStatuses} from '../server/forecastFlowStatus';
import {verifyForecastArchive} from './forecast-integrity';
export {verifyForecastArchive} from './forecast-integrity';
import {ApiError} from './api-error';
import {coordinates} from './weather';
import {readVerifiedObservations,countOverlappingHours} from './observation-integrity';
import type {ArchiveDiagnostics} from '../shared/archiveDiagnostics';
import {readCollectionJournal} from './collection-journal';
import {readDailyCapture} from './daily-archive';
import {readCollectionServiceStatus} from './collection-service-status';
import {verifyServerObservationArchive} from './server-observations';
import {getParisDateAndHour} from '../server/parisHourlyTime';
import {readProviderCollectionJournal} from './provider-collection-journal';
const models=OFFICIAL_HOURLY_MODELS.map(model=>model.name),location='50.757_2.520';
const validTime=(value:unknown):value is number=>typeof value==='number'&&Number.isFinite(value)&&value>=0&&value<=8640000000000000;
const integer=(value:unknown):value is number=>typeof value==='number'&&Number.isSafeInteger(value)&&value>=0;


function emptyDiagnostics(scope:ArchiveDiagnostics['scope']):ArchiveDiagnostics{
 return {scope,forecastStatus:scope==='not_covered'?'not_covered':'none',checkedArchives:0,rejectedArchives:0,boundedRead:false,models:[],observationIndex:{status:scope==='not_covered'?'not_covered':'unavailable',windowHours:48,measurements:null,stations:null,rawHours:null,flagged:null,firstMeasuredAt:null,lastMeasuredAt:null,lastReceivedAt:null}};
}
function projectReport(diagnostics:ArchiveDiagnostics,capture:Awaited<ReturnType<typeof verifyForecastArchive>>|null,now:number,journal:Awaited<ReturnType<typeof readCollectionJournal>>|null=null,daily:Awaited<ReturnType<typeof readDailyCapture>>|null=null){
 const received=capture?.models.map(model=>model.model)??[];
 const dailyModels=daily?.models??[],dailyCount=daily&&daily.status!=='integrity_error'?daily.models.length:null;
 const receivedTimes=[capture?.receivedAt,daily?.receivedAt].filter((value):value is string=>!!value).sort(),collectedAt=receivedTimes.at(-1)??null;
 // Chaque statut utilise l’archive la plus ancienne de ses granularités : une réception récente ne rajeunit pas une archive périmée.
 const flowStatuses=models.map(model=>{
  const times=[received.includes(model)?capture?.receivedAt:null,dailyModels.includes(model)?daily?.receivedAt:null].filter((value):value is string=>!!value).sort();
  return buildForecastFlowStatuses({expectedModels:[model],dailyCollectedModels:dailyModels,hourlyCollectedModels:received,collectedAt:times[0]??null,now:new Date(now)})[0];
 });
 return {scheduledAt:null,scheduledTimes:null,forecastCadence:null,scheduleTimeZone:'Europe/Paris',scheduleManagedExternally:true,
  scheduleCoverage:diagnostics.scope==='not_covered'?'L’archivage restauré ne couvre actuellement que Hondeghem. Aucune archive d’un autre lieu n’est utilisée.':'Captures à la consultation ; collecte automatique application fermée inactive. Les relevés indexés ne sont pas des preuves qualifiées. Les périodes manquantes restent des lacunes.',
  expectedModels:models,expectedHourlyModels:models,hourlyModelCollectionAvailable:journal?.status==='verified',hourlyModelCollection:journal?.entries??[],journalDiagnostics:{status:journal?.status??'unavailable',origin:journal?.origin??null,completedAt:journal?.completedAt??null,timingScope:'batch',collection:'on_consultation',archiveWrites:'not_attested'},providerRunCollectionAvailable:false,providerRunCollection:[],providerRunSupport:[],bestMatchReference:null,flowStatuses,
  dailyArchiveDiagnostics:daily?{...daily,coverage:undefined}: {status:'unavailable',targetDate:null,receivedAt:null},
  lastForecastSuccess:collectedAt?{status:'capture_verified',collectedAt,dailyModelCount:dailyCount,hourlyModelCount:capture?received.length:null}:null,
  lastPhysicalCollection:null,noQualifiedStationSlots:[],hourlyHistory:[],technicalFailureStreak:null,missingSnapshotSlots:null,
  snapshot:collectedAt?{status:dailyModels.length===7&&received.length===7?'complete':'partial',collectedAt,dailyModelCount:dailyCount,hourlyModelCount:capture?received.length:null,dailyCollectedModels:dailyModels,hourlyCollectedModels:received,dailyMissingModels:models.filter(model=>!dailyModels.includes(model)),hourlyMissingModels:models.filter(model=>!received.includes(model)),dailyVariableCoverage:daily?.coverage??null}:null,
  archiveDiagnostics:diagnostics,
 };
}
/** Lecture bornée et sans fournisseur, correction, écriture ou reconstitution historique. */
export async function readArchiveCollectionReport(input:any,request:Request,env:any,now=Date.now()){
 const coords=coordinates(input);
 if(!request.headers.get('oai-authenticated-user-id'))throw new ApiError('Connexion ChatGPT requise pour consulter les archives.',401);
 if(coords.lat!==50.7567||coords.lon!==2.5204)return projectReport(emptyDiagnostics('not_covered'),null,now);
 const diagnostics=emptyDiagnostics('hondeghem');let capture:Awaited<ReturnType<typeof verifyForecastArchive>>|null=null;
 const [metadata,observation,physical,journal,daily]=await Promise.allSettled([
  Promise.resolve().then(()=>env.DB.prepare('SELECT id,location_key,captured_at,received_at,origin,model_count,forecast_count,object_key,digest FROM weather_captures WHERE location_key=? AND received_at<=? ORDER BY received_at DESC LIMIT 9').bind(location,new Date(now).toISOString()).all()),
  Promise.resolve().then(()=>env.DB.prepare('SELECT COUNT(*) AS measurements,COUNT(DISTINCT station_key) AS stations,COUNT(DISTINCT CAST(measured_at/3600000 AS INTEGER)) AS rawHours,SUM(CASE WHEN quality_flags != \'[]\' THEN 1 ELSE 0 END) AS flagged,MIN(measured_at) AS firstMeasuredAt,MAX(measured_at) AS lastMeasuredAt,MAX(received_at) AS lastReceivedAt FROM weather_station_observations WHERE measured_at>=? AND measured_at<=? AND received_at<=? AND source=?').bind(now-48*3600000,now,now,'netatmo_browser_bridge').first()),
  readVerifiedObservations(env,now),
  readCollectionJournal(env,now),
  readDailyCapture(env,now),
 ]);
 const verifiedCaptures:Awaited<ReturnType<typeof verifyForecastArchive>>[]=[];
 if(metadata.status==='fulfilled'&&Array.isArray(metadata.value?.results)){
  diagnostics.boundedRead=metadata.value.results.length>8;
  for(const row of metadata.value.results.slice(0,8)){
   diagnostics.checkedArchives++;
   try{const verified=await verifyForecastArchive(row,env,now);verifiedCaptures.push(verified);capture??=verified;}catch{diagnostics.rejectedArchives++;}
  }
  diagnostics.forecastStatus=capture?'verified':diagnostics.rejectedArchives?'integrity_error':'none';
 }else diagnostics.forecastStatus='unavailable';
 if(observation.status==='fulfilled'&&observation.value&&['measurements','stations','rawHours'].every(key=>integer(observation.value[key]))){
  const row=observation.value;
  diagnostics.observationIndex={status:'available',windowHours:48,measurements:row.measurements,stations:row.stations,rawHours:row.rawHours,flagged:integer(row.flagged)?row.flagged:row.measurements===0?0:null,firstMeasuredAt:validTime(row.firstMeasuredAt)?row.firstMeasuredAt:null,lastMeasuredAt:validTime(row.lastMeasuredAt)?row.lastMeasuredAt:null,lastReceivedAt:validTime(row.lastReceivedAt)?row.lastReceivedAt:null};
 }
 diagnostics.models=capture?.models??[];
 if(physical.status==='fulfilled'){
  const result=physical.value;
  diagnostics.observationFiles={status:result.rejectedArchives?'partial':result.checkedArchives?'verified':'none',checkedArchives:result.checkedArchives,rejectedArchives:result.rejectedArchives,boundedRead:result.boundedRead,measurements:result.rows.length,stations:new Set(result.rows.map(row=>row.stationKey)).size,rawHours:new Set(result.rows.map(row=>Math.floor(row.measuredAt/3600000))).size,overlappingHours:metadata.status==='fulfilled'&&verifiedCaptures.length?countOverlappingHours(result.rows,verifiedCaptures.flatMap(item=>item.forecastHours),now):null,forecastArchives:verifiedCaptures.length,forecastReadBounded:diagnostics.boundedRead};
 }else diagnostics.observationFiles={status:'unavailable',checkedArchives:0,rejectedArchives:0,boundedRead:false,measurements:0,stations:0,rawHours:0,overlappingHours:null,forecastArchives:verifiedCaptures.length,forecastReadBounded:diagnostics.boundedRead};
 const report=projectReport(diagnostics,capture,now,journal.status==='fulfilled'?journal.value:null,daily.status==='fulfilled'?daily.value:null);
  const [service,providerJournal]=await Promise.all([readCollectionServiceStatus(env,now),readProviderCollectionJournal(env,now)]);
 let physicalCollection:any=null,hourlyHistory:any[]=[],physicalArchiveStatus='none';
 try{
  const row=await env.DB.prepare('SELECT * FROM weather_server_observations WHERE location_key=? AND received_at<=? ORDER BY received_at DESC LIMIT 1').bind(location,now).first();
  if(row){const proof=await verifyServerObservationArchive(row,env,now),local=getParisDateAndHour(row.received_at);
   if(!proof.truncated&&local){physicalArchiveStatus='verified';physicalCollection={status:'capture_verified',collectedAt:new Date(row.received_at).toISOString(),stationCount:proof.rows.length};hourlyHistory=[{date:local.date,hour:local.hour,status:'stored',attempts:null,stationCount:proof.rows.length,reason:'Dernier lot serveur relu et vérifié ; nombre de tentatives non archivé. Ces relevés ne sont pas des scores qualifiés.'}];}
   else physicalArchiveStatus='partial';
  }
 }catch{physicalArchiveStatus='unavailable';}
  const counts=service.counts,run=counts&&service.lastAttemptAt?{startedAt:service.lastAttemptAt,collectedAt:service.lastAttemptAt,status:service.status==='failed'?'failed':service.receiptStatus==='complete'?'completed':'partial',dailyModelsCollected:counts.dailyModels,dailyModelsExpected:7,hourlyModelsCollected:counts.models,hourlyModelsExpected:7,locationsProcessed:1,durationMs:null,errorMessage:null}:null;
  return {...report,providerRunCollectionAvailable:providerJournal.available,providerRunCollection:providerJournal.results,scheduleCoverage:service.description,collectionService:service,lastPhysicalCollection:physicalCollection,physicalArchiveStatus,hourlyHistory,lastForecastRun:run,recentForecastRuns:run?[run]:[]};
}

import {normalizeDailyCapture} from './daily-archive';
import {readVerifiedPhysicalDay} from './physical-reference-store';
import {buildQualifiedDailyObservation} from '../server/physicalObservationAggregation';
import {buildDailyForecastVerificationReadModel,getDailyForecastValidTime} from '../server/dailyForecastVerification';
import {aggregateDailyForecastPerformance} from '../server/dailyForecastPerformance';
import {OFFICIAL_HOURLY_MODELS} from '../server/officialModels';
import {learningPerformance,countQualifiedHourlyGroups,type LearningHistory,type LearningUnit} from '../shared/qualifiedLearning';
import {getParisDateAndHour} from '../server/parisHourlyTime';
import {readProviderValuesForDay,buildProviderLearningScores,readFutureProviderModels,verifyProviderLearningScores} from './learning-provider-runs';
import {readQualificationCheckpoint,saveQualificationCheckpoint} from './learning-qualification-state';
import {readLearningProviderLimitStatus} from './provider-rate-limit';

const LOCATION='50.757_2.520',DAY=86400000,HOUR=3600000;
export const LEARNING_COLLECTION_CHANNEL='learning_daily_collection_v1';
const encoder=new TextEncoder();
const hex=(bytes:ArrayBuffer)=>Array.from(new Uint8Array(bytes)).map(v=>v.toString(16).padStart(2,'0')).join('');
const hash=async(text:string)=>hex(await crypto.subtle.digest('SHA-256',encoder.encode(text)));
const validDate=(date:unknown):date is string=>typeof date==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(date)&&Number.isFinite(Date.parse(date+'T12:00:00Z'))&&new Date(date+'T12:00:00Z').toISOString().slice(0,10)===date;
const registry=new Map<string,string>(OFFICIAL_HOURLY_MODELS.map(m=>[m.name,m.modelId]));

/** Sous-clé distincte du chiffrement OAuth ; ni clé ni signature ne sont exposées au navigateur. */
async function signingKey(env:any){
 const secret=env.NETATMO_ENCRYPTION_KEY;if(typeof secret!=='string')throw Error('Signature serveur indisponible');
 const raw=Uint8Array.from(atob(secret),c=>c.charCodeAt(0));if(raw.length!==32)throw Error('Signature serveur invalide');
 const material=await crypto.subtle.importKey('raw',raw,'HKDF',false,['deriveKey']);
 return crypto.subtle.deriveKey({name:'HKDF',hash:'SHA-256',salt:encoder.encode('MeteoAI Sites learning v1'),info:encoder.encode('appgprj_6ad312cc5b2081919065d1aeb38d1603/qualified-daily')},material,{name:'HMAC',hash:'SHA-256',length:256},false,['sign','verify']);
}
export async function saveSigned(payload:any,kind:'forecasts'|'days'|'runs',env:any){
 const text=JSON.stringify(payload),signature=hex(await crypto.subtle.sign('HMAC',await signingKey(env),encoder.encode(text)));
 const body=JSON.stringify({payload,signature});if(body.length>3000000)throw Error('Preuve d’apprentissage trop grande');
 const digest=await hash(body),objectKey='learning/'+kind+'/'+digest+'.json';
 await env.BUCKET.put(objectKey,body,{httpMetadata:{contentType:'application/json'}});return {digest,objectKey};
}
export async function readSigned(index:any,kind:'forecasts'|'days'|'runs',env:any){
 if(!/^[a-f0-9]{64}$/.test(index.digest??'')||index.object_key!=='learning/'+kind+'/'+index.digest+'.json'||index.location_key!==LOCATION)throw Error('Index d’apprentissage invalide');
 const object=await env.BUCKET.get(index.object_key);if(!object||object.size>3000000)throw Error('Preuve d’apprentissage absente');
 const bytes=await object.arrayBuffer();if(bytes.byteLength>3000000)throw Error('Preuve d’apprentissage trop grande');
 const body=new TextDecoder().decode(bytes);if(await hash(body)!==index.digest)throw Error('Empreinte d’apprentissage incorrecte');
 const value=JSON.parse(body);if(!/^[a-f0-9]{64}$/.test(value.signature??''))throw Error('Signature absente');
 const signature=Uint8Array.from(value.signature.match(/../g)!, (v:string)=>parseInt(v,16));
 if(!await crypto.subtle.verify('HMAC',await signingKey(env),signature,encoder.encode(JSON.stringify(value.payload))))throw Error('Signature d’apprentissage incorrecte');
 if(value.payload?.version!==1||value.payload.location!==LOCATION)throw Error('Portée d’apprentissage incorrecte');
 return value.payload;
}

/** Capacité interne, appelée uniquement après une collecte Open-Meteo faite par le serveur. */
export async function recordLearningForecast(input:any,env:any,now=Date.now(),provenance?:Record<string,unknown>){
 const normalized=normalizeDailyCapture(input,now),id=LOCATION+'/'+new Date(now).toISOString().slice(0,13);
 if(await env.DB.prepare('SELECT id FROM weather_learning_forecasts WHERE id=?').bind(id).first())return {stored:false};
 const payload={version:1,kind:'server_daily_forecast',location:LOCATION,availableAt:now,days:normalized.days,...(provenance?{provenance}:{})};
 const {digest,objectKey}=await saveSigned(payload,'forecasts',env);
 await env.DB.prepare('INSERT INTO weather_learning_forecasts(id,location_key,received_at,object_key,digest) VALUES (?,?,?,?,?) ON CONFLICT(id) DO NOTHING').bind(id,LOCATION,now,objectKey,digest).run();
 return {stored:true};
}

async function forecastsForDay(env:any,date:string,cutoff:number,now:number){
 const end=getDailyForecastValidTime(date);if(end==null)throw Error('Date de prévision invalide');
 const candidates=new Map<string,any>();let boundedRead=false;
 // Deux dernières réceptions de chaque horizon : aucune extrapolation ni préférence selon l'erreur.
 for(const [minimum,maximum] of [[0,6],[6,24],[24,72],[72,168],[168,360]]){
  const result=await env.DB.prepare('SELECT * FROM weather_learning_forecasts WHERE location_key=? AND received_at>=? AND received_at<? ORDER BY received_at DESC LIMIT 3').bind(LOCATION,end-maximum*HOUR,Math.min(cutoff,end-minimum*HOUR)).all();
  if(!Array.isArray(result?.results))throw Error('Lecture des prévisions serveur indisponible');
  boundedRead ||= result.results.length>2;
  for(const row of result.results.slice(0,2))candidates.set(row.id,row);
 }
 const forecasts:any[]=[],provenance:any[]=[];let runId=1;
 for(const index of Array.from(candidates.values()).sort((a,b)=>a.id.localeCompare(b.id))){
  const p=await readSigned(index,'forecasts',env);
  if(p.kind!=='server_daily_forecast'||p.availableAt!==index.received_at||p.availableAt>=cutoff||p.availableAt>now||index.id!==LOCATION+'/'+new Date(p.availableAt).toISOString().slice(0,13)||!Array.isArray(p.days))throw Error('Prévision serveur incohérente');
  provenance.push({id:index.id,digest:index.digest});
  for(const row of p.days.find((d:any)=>d.date===date)?.forecasts??[]){
   if(registry.get(row.serviceName)!==row.modelId)throw Error('Modèle serveur incohérent');
   // Identifiant logique local au calcul original ; la provenance durable est l'archive signée.
   forecasts.push({...row,id:runId++,locationKey:LOCATION,validDate:date,provider:'open-meteo',sourceKind:'model_forecast',issuedAt:p.availableAt,capturedAt:new Date(p.availableAt)});
  }
 }
 return {forecasts,provenance,boundedRead};
}
function lastPairs(pairs:any[]){
 const groups=new Map<string,any[]>();
 for(const row of pairs){const key=[row.serviceName,row.variable,row.horizonBucket].join('|');groups.set(key,[...(groups.get(key)??[]),row]);}
 return Array.from(groups.values()).flatMap(rows=>{
  rows.sort((a,b)=>b.forecastAvailableAt-a.forecastAvailableAt);
  const latest=rows[0];if(rows.some(r=>r.forecastAvailableAt===latest.forecastAvailableAt&&r.forecastValue!==latest.forecastValue))return [];
  return [latest];
 }).sort((a,b)=>[a.serviceName,a.variable,a.horizonBucket].join('|').localeCompare([b.serviceName,b.variable,b.horizonBucket].join('|')));
}
function unitsFor(pairs:any[],date:string):LearningUnit[]{
 return aggregateDailyForecastPerformance(pairs).map(e=>({...e,date})).sort((a,b)=>[a.serviceName,a.variable,a.horizonBucket].join('|').localeCompare([b.serviceName,b.variable,b.horizonBucket].join('|')));
}

/** Termine au plus deux journées physiques ; les révisions gardent tous leurs fichiers immuables. */
export async function finalizeLearningDays(env:any,now=Date.now()){
 const today=getParisDateAndHour(now)?.date;if(!today)throw Error('Horloge invalide');
 const metadata=await env.DB.prepare('SELECT id,digest,valid_at FROM weather_physical_references WHERE location_key=? AND valid_at>=? AND valid_at<? ORDER BY valid_at DESC LIMIT 3001').bind(LOCATION,now-120*DAY,now).all();
 if(!Array.isArray(metadata?.results))throw Error('Lecture des journées indisponible');
 const byDate=new Map<string,any[]>();for(const row of metadata.results){const date=getParisDateAndHour(row.valid_at)?.date;if(date&&date<today)byDate.set(date,[...(byDate.get(date)??[]),row]);}
 const dates=Array.from(byDate.keys()).sort().reverse();
 const previous=await env.DB.prepare('SELECT id,source_digest FROM weather_learning_days WHERE location_key=? AND valid_date>=? LIMIT 121').bind(LOCATION,new Date(now-121*DAY).toISOString().slice(0,10)).all();
 if(!Array.isArray(previous?.results))throw Error('Index des journées indisponible');
 const oldDays=new Map(previous.results.map((r:any)=>[r.id,r.source_digest]));
 const checkpoint=await readQualificationCheckpoint(env,now),pending=[];
 for(const date of dates){
  const start=Date.parse(date+'T12:00:00Z'),end=getDailyForecastValidTime(date);if(end==null||end+90*60000>now||start<now-121*DAY)continue;
  const candidates=byDate.get(date)!.sort((a:any,b:any)=>a.valid_at-b.valid_at);
  if(!candidates.length)continue;
  const sources=candidates.map((r:any)=>({id:r.id,digest:r.digest})),sourceDigest=await hash(JSON.stringify(sources));
  const id=LOCATION+'/'+date;
  if(oldDays.get(id)===sourceDigest)continue;
  pending.push({date,id,sources,sourceDigest});
 }
 const expectedDigests=new Map(pending.map(p=>[p.date,p.sourceDigest]));
 const failures=new Map(checkpoint.rejected.filter(p=>expectedDigests.get(p.date)===p.sourceDigest).map(p=>[p.date,p.sourceDigest]));
 // Après un échec, passer aux dates suivantes avant de retenter la journée fautive.
 const ordered=checkpoint.cursor?[...pending.filter(p=>p.date<checkpoint.cursor!),...pending.filter(p=>p.date>=checkpoint.cursor!)]:pending;
 let stored=0,examined=0,rejected=0,cursor=checkpoint.cursor;
 for(const {date,id,sources,sourceDigest} of ordered.slice(0,2)){
  examined++;
  cursor=date;
  try{
  const physical=await readVerifiedPhysicalDay(env,date,now),observation=buildQualifiedDailyObservation(physical.snapshots);
  if(observation.coverageHours<1||JSON.stringify(sources)!==JSON.stringify(physical.references.map(r=>({id:r.id,digest:r.digest}))))throw Error('Journée physique non reproductible');
  const cutoff=Math.min(...physical.references.map(r=>r.firstMeasuredAt));
  const archive=observation.isQualified?await forecastsForDay(env,date,cutoff,now):{forecasts:[],provenance:[],boundedRead:false};
  const verification=buildDailyForecastVerificationReadModel(LOCATION,date,archive.forecasts,physical.snapshots);
  const pairs=lastPairs(verification.pairs),units=unitsFor(pairs,date);
  const stationEvidence:Record<string,any[]>={};for(const pair of pairs)stationEvidence[pair.variable]??=pair.stationEvidence;
  const compactPairs=pairs.map(({stationEvidence:_evidence,...pair})=>pair);
  const provider=await readProviderValuesForDay(env,date,now);
  const hourly=buildProviderLearningScores(physical.snapshots,provider.values,now);
  const payload={version:1,kind:observation.isQualified?'qualified_learning_day':'hourly_learning_day',location:LOCATION,date,createdAt:now,sourceDigest,referenceSources:sources,forecastSources:archive.provenance,providerSources:provider.provenance,observation,stationEvidence,pairs:compactPairs,units,hourly,boundedForecastSearch:archive.boundedRead||provider.boundedRead};
  const {digest,objectKey}=await saveSigned(payload,'days',env);
  await env.DB.prepare('INSERT INTO weather_learning_days(id,location_key,valid_date,created_at,source_digest,coverage_hours,score_count,object_key,digest) VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET created_at=excluded.created_at,source_digest=excluded.source_digest,coverage_hours=excluded.coverage_hours,score_count=excluded.score_count,object_key=excluded.object_key,digest=excluded.digest WHERE weather_learning_days.created_at<=excluded.created_at').bind(id,LOCATION,date,now,sourceDigest,observation.coverageHours,units.length+hourly.scores.length,objectKey,digest).run();stored++;
  failures.delete(date);
  }catch{rejected++;failures.set(date,sourceDigest);}
 }
 await saveQualificationCheckpoint(env,{cursor,rejected:Array.from(failures,([date,sourceDigest])=>({date,sourceDigest})),attemptedAt:now,pendingDays:pending.length-stored},now);
 return {stored,examined,rejected,pendingDays:pending.length-stored,boundedRead:metadata.results.length>3000};
}

async function verifyLearningDay(index:any,env:any,now:number){
 const p=await readSigned(index,'days',env),today=getParisDateAndHour(now)?.date;
 const hourlyOnly=p.kind==='hourly_learning_day';
 if(!['qualified_learning_day','hourly_learning_day'].includes(p.kind)||!validDate(p.date)||p.date>=today!||p.date!==index.valid_date||index.id!==LOCATION+'/'+p.date||p.createdAt!==index.created_at||p.createdAt>now||p.createdAt<(getDailyForecastValidTime(p.date)??Infinity)+90*60000||p.sourceDigest!==index.source_digest||!p.observation||!Number.isSafeInteger(p.observation.coverageHours)||p.observation.coverageHours<(hourlyOnly?1:18)||p.observation.coverageHours>25||p.observation.isQualified!==!hourlyOnly||p.observation.coverageHours!==index.coverage_hours||!Array.isArray(p.referenceSources)||p.referenceSources.length!==p.observation.coverageHours||await hash(JSON.stringify(p.referenceSources))!==p.sourceDigest||!Array.isArray(p.pairs)||p.pairs.length>70)throw Error('Journée qualifiée incohérente');
 if(hourlyOnly&&(p.observation.coverageHours>=18||p.pairs.length||p.units?.length||p.forecastSources?.length||['tempMin','tempMax','precipitationSum'].some(k=>p.observation[k]!==null)))throw Error('Bilan quotidien interdit sur une couverture horaire partielle');
 const pairs=p.pairs.map((pair:any)=>({...pair,stationEvidence:p.stationEvidence[pair.variable]}));
 if(pairs.some((pair:any)=>pair.validDate!==p.date||pair.locationKey!==LOCATION||registry.get(pair.serviceName)!==pair.modelId||!Number.isFinite(pair.forecastValue)||!Number.isFinite(pair.observedValue)||pair.forecastAvailableAt>=pair.observationWindowStartAt))throw Error('Comparaison qualifiée incohérente');
 const units=unitsFor(pairs,p.date);
 verifyProviderLearningScores(p.hourly,p.date,p.createdAt);
 if(JSON.stringify(units)!==JSON.stringify(p.units)||!Array.isArray(p.hourly?.scores)||!Array.isArray(p.hourly?.exactScores)||units.length+p.hourly.scores.length!==index.score_count)throw Error('Score non reproductible');
 return p;
}

/** Lecture seule pour Fiabilité. Chaque fichier est authentifié avant consommation,
 * puis libéré : on ne conserve jamais un an de preuves stationnelles en mémoire. */
export async function scanVerifiedLearningDays(env:any,now:number,consume:(day:any)=>void,range?:{startDate:string;endDate:string}){
 await signingKey(env);
 const today=getParisDateAndHour(now)?.date;if(!today)throw Error('Horloge invalide');
 const oldest=new Date(Date.parse(today+'T12:00:00Z')-365*DAY).toISOString().slice(0,10);
 if(range&&(!validDate(range.startDate)||!validDate(range.endDate)||range.startDate>range.endDate))throw Error('Période de lecture invalide');
 const since=range&&range.startDate>oldest?range.startDate:oldest;
 const next=range?new Date(Date.parse(range.endDate+'T12:00:00Z')+DAY).toISOString().slice(0,10):today;
 const until=next<today?next:today;
 const result=await env.DB.prepare('SELECT * FROM weather_learning_days WHERE location_key=? AND valid_date>=? AND valid_date<? AND created_at<=? ORDER BY valid_date DESC LIMIT 366').bind(LOCATION,since,until,now).all();
 if(!Array.isArray(result?.results))throw Error('Historique de fiabilité indisponible');
 let filesRejected=0,bytesRead=0,filesChecked=0,boundedRead=result.results.length>365;
 for(const index of result.results.slice(0,365)){
  if(bytesRead>=24_000_000){boundedRead=true;break;}
  filesChecked++;
  try{const day=await verifyLearningDay(index,env,now);bytesRead+=JSON.stringify(day).length;consume(day);}catch{filesRejected++;}
 }
 return {filesChecked,filesRejected,boundedRead,since,today};
}

/** Lecture bornée et authentifiée des sorties de qualification ; aucune collecte ni écriture. */
export async function readLearningHistory(env:any,now=Date.now()):Promise<LearningHistory>{
 await signingKey(env);
 const providerLimitStatus=await readLearningProviderLimitStatus(env,now),providerRateLimits=providerLimitStatus.limits;
 const today=getParisDateAndHour(now)?.date;if(!today)throw Error('Horloge invalide');
 const since=new Date(Date.parse(today+'T12:00:00Z')-120*DAY).toISOString().slice(0,10);
 const result=await env.DB.prepare('SELECT * FROM weather_learning_days WHERE location_key=? AND valid_date>=? AND valid_date<? AND created_at<=? ORDER BY valid_date DESC LIMIT 121').bind(LOCATION,since,today,now).all();
 if(!Array.isArray(result?.results))throw Error('Historique des scores indisponible');
 let filesRejected=0;const days:any[]=[],units:LearningUnit[]=[];
 for(const index of result.results.slice(0,120)){try{const p=await verifyLearningDay(index,env,now);days.push(p);units.push(...p.units);}catch{filesRejected++;}}
 const count=await env.DB.prepare('SELECT COUNT(*) AS n FROM weather_learning_forecasts WHERE location_key=?').bind(LOCATION).first();if(!Number.isSafeInteger(count?.n))throw Error('Index des prévisions serveur indisponible');
 const status=await env.DB.prepare('SELECT attempted_at,status,message FROM weather_collection_status WHERE channel=?').bind(LEARNING_COLLECTION_CHANNEL).first();
 const performance=learningPerformance(units,today,now),scores=days.flatMap(d=>d.hourly.scores),exactScores=days.flatMap(d=>d.hourly.exactScores),scored=days.filter(d=>d.units.length||d.hourly.scores.length);
 const future=await readFutureProviderModels(env,now);filesRejected+=future.filesRejected;
 const checkpoint=await readQualificationCheckpoint(env,now);
 let collectionDetails:any={};try{const parsed=JSON.parse(status?.message??'');if(parsed.version===1&&['forecast_api','verified_hourly_cycles','mixed'].includes(parsed.mode)&&Array.isArray(parsed.models)&&parsed.models.every((m:any)=>registry.has(m))&&Array.isArray(parsed.dates)&&parsed.dates.every(validDate))collectionDetails={mode:parsed.mode,models:parsed.models,dates:parsed.dates,forecastApiStatus:parsed.forecastApiStatus??null};}catch{}
 return {version:1,scope:'hondeghem',available:true,providerRateLimitsAvailable:providerLimitStatus.available,providerRateLimits,revision:await hash(JSON.stringify([days.map(d=>[d.date,d.createdAt,d.sourceDigest]),future.revision])),units,hourlyScores:scores,exactHourlyScores:exactScores,providerModels:future.models,qualifiedDays:days.filter(d=>d.kind==='qualified_learning_day').length,hourlyEvidenceDays:days.filter(d=>d.hourly.comparisons.length).length,scoreCount:units.length+scores.length,lastScoreAt:scored.length?Math.max(...scored.map(d=>d.createdAt)):null,lastDay:days[0]?.date??null,lastCoverageHours:days[0]?.observation.coverageHours??null,lastDayCreatedAt:days[0]?.createdAt??null,filesRejected,boundedRead:result.results.length>120||days.some(d=>d.boundedForecastSearch)||future.boundedRead,forecastCount:count.n,qualification:checkpoint.attemptedAt===null?undefined:{attemptedAt:checkpoint.attemptedAt,rejectedDays:checkpoint.rejected.length,pendingDays:checkpoint.pendingDays},collection:{...collectionDetails,status:status?.status??'idle',attemptedAt:status?Date.parse(status.attempted_at):null},qualifiedGroups:performance.length+countQualifiedHourlyGroups(scores,today),dailyQualifiedGroups:performance.length,hourlyQualifiedGroups:countQualifiedHourlyGroups(scores,today),providerRunCount:future.runCount};
}

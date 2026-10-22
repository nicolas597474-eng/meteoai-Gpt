import {saveSigned,readSigned} from './learning-store';
import {readVerifiedPhysicalDay} from './physical-reference-store';
import {buildQualifiedDailyObservation} from '../server/physicalObservationAggregation';
import {getParisDateAndHour,parisLocalHourToUniqueEpochMs} from '../server/parisHourlyTime';
import {summarizeMeteoAIReliability,type MeteoAIPair,type MeteoAIDay} from '../shared/meteoaiReliability';

const LOCATION='50.757_2.520',HOUR=3600000;
const initialized=new WeakMap<object,Promise<void>>();
const cache=new WeakMap<object,{today:string;until:number;value:Promise<any>}>();
const finite=(v:any):v is number=>typeof v==='number'&&Number.isFinite(v);
const shift=(d:string,n:number)=>new Date(Date.parse(d+'T12:00:00Z')+n*86400000).toISOString().slice(0,10);
async function init(env:any){
 let p=initialized.get(env.DB);if(!p){p=(async()=>{
  await env.DB.prepare('CREATE TABLE IF NOT EXISTS weather_meteoai_forecasts(id TEXT PRIMARY KEY,location_key TEXT NOT NULL,kind TEXT NOT NULL,computed_at INTEGER NOT NULL,available_at INTEGER NOT NULL,valid_from INTEGER NOT NULL,valid_to INTEGER NOT NULL,object_key TEXT NOT NULL,digest TEXT NOT NULL)').run();
  await env.DB.prepare('CREATE INDEX IF NOT EXISTS meteoai_forecast_time ON weather_meteoai_forecasts(location_key,kind,available_at)').run();
  await env.DB.prepare('CREATE TABLE IF NOT EXISTS weather_meteoai_verification_days(id TEXT PRIMARY KEY,location_key TEXT NOT NULL,valid_date TEXT NOT NULL,created_at INTEGER NOT NULL,source_digest TEXT NOT NULL,object_key TEXT NOT NULL,digest TEXT NOT NULL)').run();
 })();initialized.set(env.DB,p);p.catch(()=>initialized.delete(env.DB));}await p;
}

/** Internal server capability only. Never invoked by the browser capture endpoint.
 * Archive the output just computed, never reconstruct/backdate a past emission. */
export async function recordMeteoAIForecast(kind:'hourly'|'daily',rows:any[],coords:any,env:any,computedAt=Date.now()){
 if(coords.lat!==50.7567||coords.lon!==2.5204)return {stored:false};
 const at=Date.now();if(!Number.isSafeInteger(computedAt)||computedAt>at||at-computedAt>300000)throw Error('Calcul MeteoAI expiré');
 const points=rows.flatMap<any>(r=>{
  if(kind==='hourly')return finite(r.validAt)&&r.validAt%HOUR===0&&r.validAt>at&&r.validAt-at<=360*HOUR&&finite(r.temp)?[{validAt:r.validAt,endAt:r.validAt+HOUR,date:getParisDateAndHour(r.validAt)!.date,temp:r.temp}]:[];
  if(typeof r.date!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(r.date))return [];
  const start=parisLocalHourToUniqueEpochMs(r.date,0),end=parisLocalHourToUniqueEpochMs(shift(r.date,1),0);
  return start!==null&&end!==null&&start>at&&start-at<=360*HOUR&&(finite(r.tempMax)||finite(r.tempMin))?[{validAt:start,endAt:end,date:r.date,tempMax:finite(r.tempMax)?r.tempMax:null,tempMin:finite(r.tempMin)?r.tempMin:null}]:[];
 }).sort((a:any,b:any)=>a.validAt-b.validAt);
 if(!points.length)return {stored:false};
 if(points.length>361||new Set(points.map(p=>p.validAt)).size!==points.length)throw Error('Échéances MeteoAI incohérentes');
 await init(env);
 const payload={version:1,kind:'server_meteoai_forecast',location:LOCATION,origin:'server',engine:'existing_official_forecast',forecastKind:kind,computedAt,points};
 const stored=await saveSigned(payload,'runs',env),availableAt=Math.max(Date.now(),computedAt),id=LOCATION+'/'+kind+'/'+stored.digest;
 await env.DB.prepare('INSERT INTO weather_meteoai_forecasts(id,location_key,kind,computed_at,available_at,valid_from,valid_to,object_key,digest) VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING').bind(id,LOCATION,kind,computedAt,availableAt,points[0].validAt,points.at(-1)!.endAt,stored.objectKey,stored.digest).run();
 cache.delete(env.DB);return {stored:true};
}

async function forecast(index:any,env:any,now:number){
 const p=await readSigned(index,'runs',env);
 if(p.kind!=='server_meteoai_forecast'||p.origin!=='server'||p.engine!=='existing_official_forecast'||p.forecastKind!==index.kind||p.computedAt!==index.computed_at||index.available_at<p.computedAt||index.available_at>now||index.id!==LOCATION+'/'+index.kind+'/'+index.digest||!Array.isArray(p.points)||!p.points.length||p.points.length>361)throw Error('Prévision MeteoAI non vérifiable');
 const seen=new Set();
 for(const r of p.points){if(!Number.isSafeInteger(r.validAt)||!Number.isSafeInteger(r.endAt)||r.validAt<=p.computedAt||r.endAt<=r.validAt||getParisDateAndHour(r.validAt)?.date!==r.date||seen.has(r.validAt))throw Error('Échéance MeteoAI invalide');seen.add(r.validAt);
  if(index.kind==='hourly'?(r.validAt%HOUR!==0||r.endAt!==r.validAt+HOUR||!finite(r.temp)):(r.validAt!==parisLocalHourToUniqueEpochMs(r.date,0)||r.endAt!==parisLocalHourToUniqueEpochMs(shift(r.date,1),0)||![r.tempMax,r.tempMin].some(finite)))throw Error('Valeur MeteoAI invalide');
 }
 if(p.points[0].validAt!==index.valid_from||p.points.at(-1).endAt!==index.valid_to)throw Error('Fenêtre MeteoAI invalide');
 return p;
}

/** Finish closed days incrementally, using the existing verified physical reader.
 * Latest emission strictly before the target starts; never select by error. */
export async function finalizeMeteoAIHistory(env:any,now=Date.now()){
 await init(env);const today=getParisDateAndHour(now)!.date;
 const channel='meteoai_verification_cursor',state=await env.DB.prepare('SELECT message FROM weather_collection_status WHERE channel=?').bind(channel).first();
 let cursor='';try{const parsed=JSON.parse(state?.message??'');if(/^\d{4}-\d{2}-\d{2}$/.test(parsed.cursor))cursor=parsed.cursor;}catch{}
 const pending=await env.DB.prepare('SELECT d.valid_date,d.source_digest FROM weather_learning_days d LEFT JOIN weather_meteoai_verification_days v ON d.id=v.id WHERE d.location_key=? AND d.valid_date<? AND (v.id IS NULL OR v.source_digest<>d.source_digest) ORDER BY CASE WHEN d.valid_date>? THEN 0 ELSE 1 END,d.valid_date ASC LIMIT 2').bind(LOCATION,today,cursor).all();
 if(!Array.isArray(pending.results))throw Error('Historique physique indisponible');
 let stored=0,rejected=0;
 for(const day of pending.results){
  cursor=day.valid_date;
  try{
  const physical=await readVerifiedPhysicalDay(env,day.valid_date,now),pairs:MeteoAIPair[]=[],files=new Map<string,Promise<any>>();
  const find=async(kind:'hourly'|'daily',validAt:number)=>{
   const index=await env.DB.prepare('SELECT * FROM weather_meteoai_forecasts WHERE location_key=? AND kind=? AND available_at<? AND valid_from<=? AND valid_to>? ORDER BY available_at DESC,id ASC LIMIT 1').bind(LOCATION,kind,validAt,validAt,validAt).first();
   if(!index)return null;
   if(!files.has(index.id))files.set(index.id,forecast(index,env,now));
   const p=await files.get(index.id),point=p.points.find((r:any)=>r.validAt===validAt);
   return point?{point,availableAt:index.available_at}:null;
  };
  for(const r of physical.references){const f=await find('hourly',r.validAt);if(!f||!finite(r.snapshot.temperature)||f.availableAt>=r.firstMeasuredAt)continue;
   pairs.push({kind:'hourly',date:day.valid_date,variable:'temperature',validAt:r.validAt,availableAt:f.availableAt,observedAt:r.firstMeasuredAt,forecast:f.point.temp,observed:r.snapshot.temperature});
  }
  const observed=buildQualifiedDailyObservation(physical.snapshots),daily=observed.isQualified?await find('daily',physical.start):null;
  if(daily)for(const [field,variable] of [['tempMax','temperature_max'],['tempMin','temperature_min']] as const){if(finite(daily.point[field])&&finite(observed[field]))pairs.push({kind:'daily',date:day.valid_date,variable,validAt:physical.start,availableAt:daily.availableAt,observedAt:Math.min(...physical.references.map(r=>r.firstMeasuredAt)),forecast:daily.point[field],observed:observed[field]!});}
  const p={version:1,kind:'verified_meteoai_day',location:LOCATION,date:day.valid_date,createdAt:now,sourceDigest:day.source_digest,pairs};
  const saved=await saveSigned(p,'runs',env);
  await env.DB.prepare('INSERT INTO weather_meteoai_verification_days(id,location_key,valid_date,created_at,source_digest,object_key,digest) VALUES (?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET created_at=excluded.created_at,source_digest=excluded.source_digest,object_key=excluded.object_key,digest=excluded.digest WHERE weather_meteoai_verification_days.created_at<=excluded.created_at').bind(LOCATION+'/'+day.valid_date,LOCATION,day.valid_date,now,day.source_digest,saved.objectKey,saved.digest).run();stored++;
  }catch{rejected++;}
 }
 if(pending.results.length)await env.DB.prepare('INSERT INTO weather_collection_status(channel,attempted_at,status,message) VALUES (?,?,?,?) ON CONFLICT(channel) DO UPDATE SET attempted_at=excluded.attempted_at,status=excluded.status,message=excluded.message').bind(channel,new Date(now).toISOString(),rejected?'partial':'ok',JSON.stringify({cursor,rejected})).run();
 if(stored)cache.delete(env.DB);return {stored,rejected};
}

/** Notes independent of display period and horizon. No one-year date cutoff.
 * Stream compact signed day files; an operational budget is always disclosed. */
export function readMeteoAIReliability(coords:any,env:any,now=Date.now()){
 if(coords.lat!==50.7567||coords.lon!==2.5204)return Promise.resolve({...summarizeMeteoAIReliability([]),available:false,status:'not_covered',reason:'Aucun historique MeteoAI vérifié pour ce lieu.'});
 const today=getParisDateAndHour(now)!.date,old=cache.get(env.DB);if(old&&old.today===today&&old.until>now)return old.value;
 const value=(async()=>{
  const exists=await env.DB.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='weather_meteoai_verification_days'").first();
  if(!exists)return {...summarizeMeteoAIReliability([]),filesChecked:0,filesRejected:0,boundedRead:false};
  const count=()=>env.DB.prepare('SELECT COUNT(*) AS n,MAX(created_at) AS revision FROM weather_meteoai_verification_days WHERE location_key=? AND valid_date<? AND created_at<=?').bind(LOCATION,today,now).first();
  const before=await count();if(!Number.isSafeInteger(before?.n))throw Error('Index historique indisponible');
  const days:MeteoAIDay[]=[],seen=new Set<string>();let offset=0,checked=0,rejected=0,bounded=false,bytes=0;
  while(true){
   const batch=await env.DB.prepare('SELECT * FROM weather_meteoai_verification_days WHERE location_key=? AND valid_date<? AND created_at<=? ORDER BY valid_date ASC LIMIT 100 OFFSET ?').bind(LOCATION,today,now,offset).all();
   if(!Array.isArray(batch.results))throw Error('Historique MeteoAI indisponible');
   for(const index of batch.results){checked++;try{
    const p=await readSigned(index,'runs',env);bytes+=JSON.stringify(p).length;
    if(p.kind!=='verified_meteoai_day'||p.date!==index.valid_date||p.createdAt!==index.created_at||p.sourceDigest!==index.source_digest||index.id!==LOCATION+'/'+p.date||seen.has(p.date)||!Array.isArray(p.pairs)||p.pairs.length>27)throw Error('Journée MeteoAI incohérente');
    const unique=new Set();for(const pair of p.pairs){const key=pair.kind+'/'+pair.validAt+'/'+pair.variable;
     if(pair.date!==p.date||!['hourly','daily'].includes(pair.kind)||!['temperature','temperature_min','temperature_max'].includes(pair.variable)||(pair.kind==='hourly')!==(pair.variable==='temperature')||!Number.isSafeInteger(pair.validAt)||!Number.isSafeInteger(pair.availableAt)||!Number.isSafeInteger(pair.observedAt)||pair.availableAt>=pair.validAt||pair.observedAt<pair.validAt||pair.observedAt>=p.createdAt||!finite(pair.forecast)||!finite(pair.observed)||getParisDateAndHour(pair.validAt)?.date!==p.date||unique.has(key))throw Error('Paire MeteoAI incohérente');unique.add(key);
    }
    seen.add(p.date);days.push({date:p.date,pairs:p.pairs});
   }catch{rejected++;}}
   if(batch.results.length<100)break;offset+=100;
   if(bytes>8_000_000){bounded=true;break;}
  }
  const after=await count();bounded ||= before.n!==checked||after?.n!==before.n||after?.revision!==before.revision;
  return {...summarizeMeteoAIReliability(days,!rejected&&!bounded),filesChecked:checked,filesRejected:rejected,boundedRead:bounded};
 })().catch(()=>({...summarizeMeteoAIReliability([],false),available:false,status:'unavailable',reason:'L’historique MeteoAI ne peut pas être lu actuellement. Aucune note n’est inventée.',filesChecked:0,filesRejected:0,boundedRead:false}));
 const protectedValue=value.then(result=>{if(!result.complete&&cache.get(env.DB)?.value===protectedValue)cache.delete(env.DB);return result;});
 cache.set(env.DB,{today,until:now+300000,value:protectedValue});return protectedValue;
}

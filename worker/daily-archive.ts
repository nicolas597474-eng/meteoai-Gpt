import {OFFICIAL_HOURLY_MODELS} from '../server/officialModels';
import {getParisDate} from '../server/weatherTime';
import {MODEL_FORECAST_HORIZONS} from '../server/forecastVariableCoverage';

const LOCATION='50.757_2.520';
const registry=new Map<string,string>(OFFICIAL_HOURLY_MODELS.map(m=>[m.name,m.modelId]));
export const DAILY_ARCHIVE_FIELDS=[
 ['tempMax','Température maximale','°C'],['tempMin','Température minimale','°C'],
 ['precipitation','Précipitations','mm'],['windSpeed','Vent maximal','km/h'],
 ['windGust','Rafales maximales','km/h'],['humidity','Humidité moyenne','%'],['cloudCover','Nébulosité moyenne','%'],
] as const;
const sha=async(text:string)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text)))).map(v=>v.toString(16).padStart(2,'0')).join('');
const dateValid=(v:unknown):v is string=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&Number.isFinite(Date.parse(v+'T12:00:00Z'))&&new Date(v+'T12:00:00Z').toISOString().slice(0,10)===v;

/** Copie minimale des valeurs reçues, sans données brutes, run fournisseur supposé ni score. */
export function normalizeDailyCapture(input:any,now=Date.now()){
 if(input?.lat!==50.7567||input?.lon!==2.5204||!Number.isSafeInteger(input.capturedAt)||Math.abs(input.capturedAt-now)>300000)throw Error('Capture quotidienne invalide');
 if(!Array.isArray(input.days)||!input.days.length||input.days.length>16)throw Error('Fenêtre quotidienne invalide');
 const today=getParisDate(new Date(now)),last=new Date(Date.parse(today+'T12:00:00Z')+15*86400000).toISOString().slice(0,10),dates=new Set<string>();
 const days=(input.days as any[]).map(day=>{
  if(!dateValid(day.date)||day.date<today||day.date>last||dates.has(day.date)||!Array.isArray(day.forecasts)||day.forecasts.length>7)throw Error('Date quotidienne invalide');
  dates.add(day.date);const seen=new Set<string>();
  const forecasts=(day.forecasts as any[]).map(row=>{
   if(!registry.has(row?.serviceName)||row.modelId!==registry.get(row.serviceName)||seen.has(row.serviceName))throw Error('Modèle quotidien invalide');
   seen.add(row.serviceName);
   const values:Record<string,number|null>={};
   for(const [key] of DAILY_ARCHIVE_FIELDS){const v=row[key];if(v!=null&&(typeof v!=='number'||!Number.isFinite(v)||Math.abs(v)>100000))throw Error('Valeur quotidienne invalide');values[key]=v??null;}
   if(!Object.values(values).some(v=>v!==null))return null;
   const timing=(v:any)=>v==null?null:Number.isSafeInteger(v)&&v>=now-1800000&&v<=input.capturedAt?v:(()=>{throw Error('Provenance quotidienne invalide');})();
   const requestStartedAt=timing(row.requestStartedAt),availableAt=timing(row.availableAt);
   if(requestStartedAt!==null&&availableAt!==null&&requestStartedAt>availableAt)throw Error('Provenance quotidienne inversée');
   return {serviceName:row.serviceName as string,modelId:row.modelId as string,sourceName:'open-meteo',requestStartedAt,availableAt,...values};
  }).filter((row):row is NonNullable<typeof row>=>row!==null);
  return {date:day.date,forecasts};
 }).filter(day=>day.forecasts.length);
 if(!days.length)throw Error('Aucune valeur quotidienne exploitable');
 return {version:1,kind:'daily_forecast',location:LOCATION,lat:50.7567,lon:2.5204,capturedAt:input.capturedAt,receivedAt:now,days:days.sort((a,b)=>a.date.localeCompare(b.date))};
}

export async function recordDailyCapture(input:any,env:any,origin:'browser'|'server'='browser',now=Date.now()){
 const payload=normalizeDailyCapture(input,now),id=LOCATION+'/'+new Date(now).toISOString().slice(0,13)+'/'+origin;
 const existing=await env.DB.prepare('SELECT digest FROM weather_daily_captures WHERE id=?').bind(id).first();
 if(existing)return {stored:false,duplicate:true,digest:existing.digest};
 const text=JSON.stringify({...payload,origin,observation:false,calibrationEligible:false}),digest=await sha(text),objectKey='history/daily-captures/'+digest+'.json';
 await env.BUCKET.put(objectKey,text,{httpMetadata:{contentType:'application/json'}});
 const models=new Set(payload.days.flatMap(day=>day.forecasts.map(f=>f.serviceName))),count=payload.days.reduce((n,day)=>n+day.forecasts.length,0);
 await env.DB.prepare('INSERT INTO weather_daily_captures(id,location_key,captured_at,received_at,origin,model_count,forecast_count,object_key,digest) VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING').bind(id,LOCATION,new Date(payload.capturedAt).toISOString(),new Date(now).toISOString(),origin,models.size,count,objectKey,digest).run();
 return {stored:true,digest,models:models.size,forecasts:count};
}

/** Vérification indépendante du fichier et de chaque colonne de son index. */
export async function verifyDailyCapture(row:any,env:any,now=Date.now()){
 if(!/^[a-f0-9]{64}$/.test(row.digest??'')||row.object_key!=='history/daily-captures/'+row.digest+'.json')throw Error('Index quotidien invalide');
 const receivedAt=Date.parse(row.received_at),capturedAt=Date.parse(row.captured_at);
 if(!Number.isSafeInteger(receivedAt)||receivedAt>now||!Number.isSafeInteger(capturedAt)||row.location_key!==LOCATION||!['browser','server'].includes(row.origin)||row.id!==LOCATION+'/'+new Date(receivedAt).toISOString().slice(0,13)+'/'+row.origin)throw Error('Métadonnées quotidiennes invalides');
 const object=await env.BUCKET.get(row.object_key);if(!object||object.size>100000)throw Error('Archive quotidienne absente ou trop grande');
 const bytes=await object.arrayBuffer();if(bytes.byteLength>100000)throw Error('Archive quotidienne trop grande');
 const text=new TextDecoder().decode(bytes);if(await sha(text)!==row.digest)throw Error('Empreinte quotidienne incorrecte');
 const payload=JSON.parse(text),normalized=normalizeDailyCapture(payload,receivedAt);
 if(JSON.stringify({...normalized,origin:row.origin,observation:false,calibrationEligible:false})!==text||payload.capturedAt!==capturedAt)throw Error('Archive quotidienne incohérente');
 const models=new Set(normalized.days.flatMap(day=>day.forecasts.map(f=>f.serviceName))),count=normalized.days.reduce((n,day)=>n+day.forecasts.length,0);
 if(row.model_count!==models.size||row.forecast_count!==count)throw Error('Compteurs quotidiens incohérents');
 return {receivedAt:row.received_at as string,payload:normalized};
}

export async function readDailyCapture(env:any,now=Date.now()){
 const metadata=await env.DB.prepare('SELECT * FROM weather_daily_captures WHERE location_key=? AND received_at<=? ORDER BY received_at DESC LIMIT 9').bind(LOCATION,new Date(now).toISOString()).all();
 if(!Array.isArray(metadata?.results))throw Error('Lecture quotidienne indisponible');
 let rejectedArchives=0,checkedArchives=0,capture:Awaited<ReturnType<typeof verifyDailyCapture>>|null=null;
 const targetDate=getParisDate(new Date(now));
 for(const row of metadata.results.slice(0,8)){
  checkedArchives++;
  try{const verified=await verifyDailyCapture(row,env,now);if(verified.payload.days.some(day=>day.date===targetDate))capture??=verified;}catch{rejectedArchives++;}
 }
 const target=capture?.payload.days.find(day=>day.date===targetDate),models=target?.forecasts.map(f=>f.serviceName)??[];
 const coverage=models.map(modelName=>{
  const rows=capture!.payload.days.flatMap(day=>day.forecasts.filter(f=>f.serviceName===modelName).map(f=>({date:day.date,...f})));
  return {modelName,status:'archived',requestedDays:16,returnedDays:rows.length,targetDateInResponse:true,firstReturnedDate:rows[0]?.date??null,lastReturnedDate:rows[rows.length-1]?.date??null,archiveWriteConfirmed:true,maximumDocumentedDays:MODEL_FORECAST_HORIZONS[modelName]?.maximumDocumentedDays??null,horizonSourceUrl:MODEL_FORECAST_HORIZONS[modelName]?.sourceUrl??null,
   variables:DAILY_ARCHIVE_FIELDS.map(([key,label,unit])=>{const count=rows.filter(row=>(row as any)[key]!==null).length;return {key,label,unit,status:count===0?'missing':count===rows.length?'available':'partial',documentationStatus:key==='humidity'||key==='cloudCover'?'unconfirmed':'documented',requested:true,requestedCount:16,receivedCount:count,archivedCount:count,exposedCount:null};}),
  };
 });
 return {status:capture?'verified' as const:rejectedArchives?'integrity_error' as const:'none' as const,targetDate,checkedArchives,rejectedArchives,boundedRead:metadata.results.length>8,receivedAt:capture?.receivedAt??null,models,coverage};
}

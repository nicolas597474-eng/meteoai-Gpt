import {getParisDate} from '../server/weatherTime';
const MODELS=new Set(['AROME','ARPEGE','ICON','ECMWF','GFS','GEM','UKMET']);
const FIELDS=['temperature','apparentTemperature','precipitation','rain','showers','windSpeed','windGusts','windDirection','humidity','pressure','cloudCover','weatherCode','uvIndex','dewPoint','visibility','solarRadiation','cloudLow','cloudMid','cloudHigh','snowfall'];
export {FIELDS as ARCHIVED_FORECAST_FIELDS};
const sha=async(text:string)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text)))).map(v=>v.toString(16).padStart(2,'0')).join('');

/** Une capture est une prévision datée, jamais une observation réelle.
 * Le serveur horodate la réception et n'accepte que les échéances futures.
 * Les anciennes sauvegardes et les captures nouvelles restent distinctes. */
export function validateCapture(input:any,now=Date.now()){
 if(!input||!Number.isFinite(input.capturedAt)||Math.abs(now-input.capturedAt)>300000)throw new Error('Capture expirée ou horodatage invalide');
 // Première reprise limitée au lieu par défaut ; aucun GPS personnel collecté.
 if(input.lat!==50.7567||input.lon!==2.5204)throw new Error('Reprise limitée à Hondeghem');
 if(!Array.isArray(input.models)||input.models.length<1||input.models.length>7)throw new Error('Modèles invalides');
 const seen=new Set<string>();
 const models=input.models.map((model:any)=>{
  if(!MODELS.has(model.modelName)||seen.has(model.modelName)||!Array.isArray(model.hours)||model.hours.length>72)throw new Error('Modèle inconnu, doublon ou trop de créneaux');
  seen.add(model.modelName);
  const times=new Set<number>();
  const hours=model.hours.filter((h:any)=>Number.isFinite(h.validAt)&&h.validAt>=now&&h.validAt<=now+72*3600000).map((h:any)=>{
   if(times.has(h.validAt))throw new Error('Échéance dupliquée');times.add(h.validAt);
   const result:any={validAt:h.validAt};
   for(const key of FIELDS){const v=h[key];if(v!=null&&(!Number.isFinite(v)||Math.abs(v)>100000))throw new Error('Valeur météo invalide');result[key]=v??null;}
   return result;
  });
  return {modelName:model.modelName,modelId:typeof model.modelId==='string'?model.modelId.slice(0,80):null,sourceName:'open-meteo',requestStartedAt:Number.isFinite(model.requestStartedAt)?model.requestStartedAt:null,availableAt:Number.isFinite(model.availableAt)?model.availableAt:null,providerRunAt:Number.isFinite(model.providerRunAt)?model.providerRunAt:null,hours};
 }).filter((m:any)=>m.hours.some((h:any)=>h.temperature!==null));
 if(!models.length)throw new Error('Aucune prévision future exploitable');
 return {version:1,kind:'forecast',location:'50.757_2.520',lat:input.lat,lon:input.lon,capturedAt:input.capturedAt,receivedAt:now,models};
}
export async function recordCapture(input:any,env:any,origin:'browser'|'server',now=Date.now()){
 const payload=validateCapture(input,now),slot=new Date(now).toISOString().slice(0,13),id=payload.location+'/'+slot+'/'+origin;
 const existing=await env.DB.prepare('SELECT id,digest FROM weather_captures WHERE id=?').bind(id).first();
 if(existing)return {stored:false,duplicate:true,id,digest:existing.digest};
 const text=JSON.stringify({...payload,origin,observation:false,calibrationEligible:false}),digest=await sha(text),objectKey='history/captures/'+digest+'.json';
 await env.BUCKET.put(objectKey,text,{httpMetadata:{contentType:'application/json'}});
 const count=payload.models.reduce((n:number,m:any)=>n+m.hours.length,0);
 await env.DB.prepare('INSERT INTO weather_captures(id,location_key,capture_day,captured_at,received_at,origin,model_count,forecast_count,object_key,digest) VALUES (?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING').bind(id,payload.location,getParisDate(new Date(now)),new Date(payload.capturedAt).toISOString(),new Date(now).toISOString(),origin,payload.models.length,count,objectKey,digest).run();
 return {stored:true,id,digest,models:payload.models.length,forecasts:count};
}
export async function archiveStatus(env:any){
 const captures=await env.DB.prepare('SELECT origin,COUNT(*) AS captures,MIN(received_at) AS firstCapture,MAX(received_at) AS lastCapture,SUM(forecast_count) AS forecasts FROM weather_captures GROUP BY origin').all();
 const legacy=await env.DB.prepare('SELECT source_table AS name,COUNT(*) AS rows,MIN(weather_date) AS firstDate,MAX(weather_date) AS lastDate FROM recovery_weather_history GROUP BY source_table').all();
 const attempts=await env.DB.prepare('SELECT channel,attempted_at AS attemptedAt,status,message FROM weather_collection_status').all();
 return {timezone:'Europe/Paris',legacy:legacy.results,captures:captures.results,attempts:attempts.results,missingPeriods:'Non reconstituées ; aucune valeur inventée',groundTruth:'not_connected',calibration:'not_active',scope:'Hondeghem ; prévisions futures ; sauvegarde historique conservée séparément'};
}
export async function collectorStatus(env:any,status:string,message:string){
 await env.DB.prepare('INSERT INTO weather_collection_status(channel,attempted_at,status,message) VALUES (?,?,?,?) ON CONFLICT(channel) DO UPDATE SET attempted_at=excluded.attempted_at,status=excluded.status,message=excluded.message').bind('server',new Date().toISOString(),status,message.slice(0,350)).run();
}
export async function verifyLatestCapture(env:any){
 const row=await env.DB.prepare('SELECT id,object_key,digest FROM weather_captures ORDER BY received_at DESC LIMIT 1').first();
 if(!row)return {verified:false,reason:'no_capture'};
 const object=await env.BUCKET.get(row.object_key);if(!object)throw new Error('Archive absente du stockage');
 const text=new TextDecoder().decode(await object.arrayBuffer());
 if(await sha(text)!==row.digest)throw new Error('Empreinte de l’archive non conforme');
 const data=JSON.parse(text);
 return {verified:true,id:row.id,digest:row.digest,kind:data.kind,origin:data.origin,observation:data.observation,calibrationEligible:data.calibrationEligible,models:data.models.length,forecasts:data.models.reduce((n:number,m:any)=>n+m.hours.length,0)};
}

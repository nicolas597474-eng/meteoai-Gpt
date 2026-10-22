import {OFFICIAL_HOURLY_MODELS} from '../server/officialModels';
import {HOURLY_FORECAST_VARIABLES} from '../server/forecastVariableCoverage';
import type {HourlyJournalVariableSummary} from '../shared/hourlyJournalCoverage';
const LOCATION='50.757_2.520',CHANNEL='hourly_journal_v1';
const registry=new Map<string,string|null>([...OFFICIAL_HOURLY_MODELS.map(model=>[model.name,model.modelId] as [string,string|null]),['best_match',null]]);
const errors=new Set(['timeout','source_unavailable','provider_http_4xx','provider_http_5xx','provider_http_error','invalid_response','no_usable_data','collection_failed','rate_limit_suspended','provider_rate_limited']);
const hash=async(text:string)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text)))).map(v=>v.toString(16).padStart(2,'0')).join('');
const integer=(value:unknown,max:number)=>typeof value==='number'&&Number.isSafeInteger(value)&&value>=0&&value<=max;

function variableSummary(row:any):HourlyJournalVariableSummary[]|undefined{
 const supplied=row.variableSummary;
 if(supplied!==undefined){
  if(!Array.isArray(supplied)||supplied.length!==HOURLY_FORECAST_VARIABLES.length)throw Error('Couverture de variables invalide');
  const seen=new Set<string>();
  return supplied.map((item:any)=>{
   if(!HOURLY_FORECAST_VARIABLES.some(v=>v.key===item?.key)||seen.has(item.key)||item.expectedCount!==row.expectedHoursCount||!integer(item.receivedCount,item.expectedCount)||!integer(item.providerNullCount,item.expectedCount)||item.receivedCount+item.providerNullCount>item.expectedCount)throw Error('Couverture de variable incohérente');
   seen.add(item.key);
   return {key:item.key,receivedCount:item.receivedCount,expectedCount:item.expectedCount,providerNullCount:item.providerNullCount};
  });
 }
 // Les anciennes traces libres sont ignorées comme auparavant ; elles ne
 // deviennent jamais une preuve de couverture ni une donnée persistée.
 if(!Array.isArray(row.variableDiagnostics))return undefined;
 if(row.variableDiagnostics.length!==HOURLY_FORECAST_VARIABLES.length)throw Error('Diagnostic de variables incomplet');
 const statuses=new Set(['valid','normalized','provider_null','field_missing','invalid_value','unit_mismatch','no_model_data','time_mismatch','source_error']);
 return HOURLY_FORECAST_VARIABLES.map(definition=>{
  const matches=row.variableDiagnostics.filter((v:any)=>v?.key===definition.key);
  if(matches.length!==1||!Array.isArray(matches[0].slots)||matches[0].slots.length!==row.expectedHoursCount)throw Error('Créneaux de variable invalides');
  const slots=matches[0].slots,seen=new Set<number>();
  for(const slot of slots){if(!Number.isSafeInteger(slot?.validAt)||seen.has(slot.validAt)||!statuses.has(slot.status))throw Error('Créneau de variable invalide');seen.add(slot.validAt);}
  return {key:definition.key,receivedCount:slots.filter((v:any)=>v.status==='valid'||v.status==='normalized').length,expectedCount:row.expectedHoursCount,providerNullCount:slots.filter((v:any)=>v.status==='provider_null').length};
 });
}

/** Enregistre un résultat de collecte réel ; aucune tentative n'est déduite d'une capture météo. */
export function normalizeCollectionJournal(input:any,now=Date.now(),origin:'browser'|'server'='browser'){
 if(input?.lat!==50.7567||input?.lon!==2.5204)throw Error('Journal limité à Hondeghem');
 if(!Number.isSafeInteger(input.startedAt)||!Number.isSafeInteger(input.completedAt)||input.startedAt<now-1800000||Math.abs(input.completedAt-now)>300000||input.completedAt<input.startedAt)throw Error('Horodatage du journal invalide');
 if(!Array.isArray(input.diagnostics)||!input.diagnostics.length||input.diagnostics.length>8)throw Error('Diagnostic invalide');
 const seen=new Set<string>();
 const diagnostics=(input.diagnostics as any[]).map((row:any)=>{
  const suspended=row?.errorCode==='rate_limit_suspended'&&row.status==='failed'&&row.attemptCount===0&&row.hoursReceived===0&&row.valuesReceived===0;
  if(!registry.has(row?.modelName)||seen.has(row.modelName)||row.modelId!==registry.get(row.modelName)||!['succeeded','partial','failed','safe_error'].includes(row.status)||!integer(row.attemptCount,10)||(row.attemptCount<1&&!suspended)||!['hoursReceived','valuesReceived','expectedValueCount','expectedHoursCount'].every(key=>integer(row[key],20000)))throw Error('Résultat de modèle invalide');
  seen.add(row.modelName);
  const summary=variableSummary(row);
  if(summary?.length===HOURLY_FORECAST_VARIABLES.length&&summary.reduce((n,v)=>n+v.receivedCount,0)!==row.valuesReceived)throw Error('Total de valeurs incohérent');
  return {modelName:row.modelName,modelId:row.modelId,status:row.status,attemptCount:row.attemptCount,hoursReceived:row.hoursReceived,valuesReceived:row.valuesReceived,expectedValueCount:row.expectedValueCount,expectedHoursCount:row.expectedHoursCount,errorCode:row.errorCode===null?null:errors.has(row.errorCode)?row.errorCode:'collection_failed',...(summary?{variableSummary:summary}:{})};
 });
 return {version:1,kind:'hourly_collection',location:LOCATION,lat:50.7567,lon:2.5204,startedAt:input.startedAt,completedAt:input.completedAt,receivedAt:now,origin,timingScope:'batch',diagnostics};
}
export async function recordCollectionJournal(input:any,env:any,origin:'browser'|'server'='browser',now=Date.now()){
 const payload=normalizeCollectionJournal(input,now,origin),text=JSON.stringify(payload),digest=await hash(text),key='history/hourly-collection/'+digest+'.json';
 await env.BUCKET.put(key,text,{httpMetadata:{contentType:'application/json'}});
 // Le dernier lot terminé reste visible, même si deux collectes se terminent dans un ordre différent.
 await env.DB.prepare('INSERT INTO weather_collection_status(channel,attempted_at,status,message) VALUES (?,?,?,?) ON CONFLICT(channel) DO UPDATE SET attempted_at=excluded.attempted_at,status=excluded.status,message=excluded.message WHERE excluded.attempted_at>weather_collection_status.attempted_at').bind(CHANNEL,new Date(payload.completedAt).toISOString(),'journal_v1',key).run();
 return {stored:true,models:payload.diagnostics.length};
}
export async function readCollectionJournal(env:any,now=Date.now()){
 const index=await env.DB.prepare('SELECT attempted_at,status,message FROM weather_collection_status WHERE channel=?').bind(CHANNEL).first();
 if(!index)return {status:'none' as const,entries:[],completedAt:null,origin:null};
 if(index.status!=='journal_v1'||!/^history\/hourly-collection\/[a-f0-9]{64}\.json$/.test(index.message))throw Error('Index du journal invalide');
 const object=await env.BUCKET.get(index.message);if(!object||object.size>50000)throw Error('Journal absent ou trop grand');
 const bytes=await object.arrayBuffer();if(bytes.byteLength>50000)throw Error('Journal trop grand');
 const text=new TextDecoder().decode(bytes);if(index.message!=='history/hourly-collection/'+await hash(text)+'.json')throw Error('Empreinte du journal invalide');
 const payload=JSON.parse(text);
 if(!Number.isSafeInteger(payload.receivedAt)||payload.receivedAt>now||!['browser','server'].includes(payload.origin))throw Error('Provenance du journal invalide');
 const normalized=normalizeCollectionJournal(payload,payload.receivedAt,payload.origin);
 if(JSON.stringify(normalized)!==text||new Date(payload.completedAt).toISOString()!==index.attempted_at)throw Error('Contenu du journal incohérent');
 return {status:'verified' as const,origin:payload.origin,completedAt:payload.completedAt,entries:normalized.diagnostics.map(row=>({model:row.modelName==='best_match'?'Open-Meteo':row.modelName,modelId:row.modelId,isOfficialModel:row.modelName!=='best_match',status:row.status,requestAttempts:row.attemptCount,hoursReceived:row.hoursReceived,expectedHoursCount:row.expectedHoursCount,valuesReceived:row.valuesReceived,expectedValueCount:row.expectedValueCount,archiveRowsWritten:null,projectionRowsWritten:null,errorCode:row.errorCode,attemptedAt:payload.startedAt,completedAt:payload.completedAt,variableCoverage:null,...(row.variableSummary?{variableSummary:row.variableSummary}:{})}))};
}

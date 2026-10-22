import {OFFICIAL_HOURLY_MODELS} from '../server/officialModels';
import {compareTraceWeights} from '../server/weightComparison';
import {coordinates} from './weather';
import {ApiError} from './api-error';
const LOCATION='50.757_2.520';
// Une horloge navigateur peut devancer légèrement le serveur. La date reçue reste intacte.
export const FUSION_CLOCK_SKEW_MS=5000;
const names=new Set(OFFICIAL_HOURLY_MODELS.map(m=>m.name));
const sha=async(text:string)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text)))).map(v=>v.toString(16).padStart(2,'0')).join('');
const validDate=(s:any)=>typeof s==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(s)&&Number.isFinite(Date.parse(s+'T12:00:00Z'))&&new Date(s+'T12:00:00Z').toISOString().slice(0,10)===s;
export function normalizeFusionSnapshot(input:any,now=Date.now()){
 if(input?.lat!==50.7567||input?.lon!==2.5204)return null;
 const today=new Date(now).toLocaleDateString('en-CA',{timeZone:'Europe/Paris'}),at=Date.parse(input.computedAt);
 if(!validDate(input.date)||input.date!==today||!Number.isSafeInteger(at)||at>now+FUSION_CLOCK_SKEW_MS||now-at>300000)throw new ApiError('Trace de fusion expirée.');
 const parameterSources:Record<string,any[]>={};
 for(const [key,original] of [['temperature','tempMax'],['precipitation','precipitation'],['wind','windSpeed']]){
  const rows=input.trace?.parameterSources?.[original];if(!Array.isArray(rows)||rows.length>7)throw new ApiError('Trace de fusion invalide.');
  const seen=new Set<string>();parameterSources[key]=rows.map((r:any)=>{
   if(!names.has(r.name)||seen.has(r.name)||!Number.isFinite(r.finalWeight)||r.finalWeight<0||r.finalWeight>1)throw new ApiError('Poids de fusion invalide.');
   seen.add(r.name);return {id:r.name,name:r.name,finalWeight:r.finalWeight};
  });
  if(rows.length&&Math.abs(rows.reduce((s:number,r:any)=>s+r.finalWeight,0)-1)>0.00001)throw new ApiError('Somme des poids invalide.');
 }
 const values:Record<string,number|null>={};for(const key of ['tempMax','tempMin','precipitation','windSpeed','windGust','humidity','cloudCover']){
  const v=input.values?.[key];if(v!=null&&(!Number.isFinite(v)||Math.abs(v)>100000))throw new ApiError('Valeur de fusion invalide.');values[key]=v??null;
 }
 if(!Object.values(values).some(v=>v!==null))return null;
 for(const [field,parameter] of [['tempMax','temperature'],['precipitation','precipitation'],['windSpeed','wind']])if(values[field]!==null&&!parameterSources[parameter].some(r=>r.finalWeight>0))throw new ApiError('Contributeurs de fusion absents.');
 return {version:1,kind:'received_fusion_trace',location:LOCATION,date:input.date,computedAt:new Date(at).toISOString(),receivedAt:now,origin:'browser',calibrationEligible:false,values,trace:{parameterSources}};
}
export async function recordFusionSnapshot(input:any,env:any,now=Date.now()){
 const p=normalizeFusionSnapshot(input,now);if(!p)return {status:'not_applicable' as const};
 const slot=p.computedAt.slice(0,13),text=JSON.stringify(p),digest=await sha(text),key='history/fusion-traces/'+digest+'.json';
 if(await env.DB.prepare('SELECT id FROM weather_fusion_snapshots WHERE location_key=? AND slot=? AND valid_date=?').bind(LOCATION,slot,p.date).first())return {status:'duplicate' as const};
 await env.BUCKET.put(key,text,{httpMetadata:{contentType:'application/json'}});
 await env.DB.prepare('INSERT INTO weather_fusion_snapshots(location_key,slot,valid_date,computed_at,received_at,object_key,digest) VALUES (?,?,?,?,?,?,?) ON CONFLICT(location_key,slot,valid_date) DO NOTHING').bind(LOCATION,slot,p.date,p.computedAt,now,key,digest).run();
 return {status:'stored' as const};
}
export async function readFusionSnapshots(env:any,now=Date.now(),range?:{start:string;end:string},onRejected?:()=>void){
 const result=range?await env.DB.prepare('SELECT * FROM weather_fusion_snapshots WHERE location_key=? AND computed_at IN (SELECT MAX(computed_at) FROM weather_fusion_snapshots WHERE location_key=? AND valid_date>=? AND valid_date<=? AND received_at<=? GROUP BY valid_date) ORDER BY computed_at DESC LIMIT 31').bind(LOCATION,LOCATION,range.start,range.end,now).all():await env.DB.prepare('SELECT * FROM weather_fusion_snapshots WHERE location_key=? AND received_at<=? ORDER BY computed_at DESC LIMIT 60').bind(LOCATION,now).all();
 if(!Array.isArray(result.results))throw new ApiError('Traces archivées indisponibles.',503);
 const snapshots=[];for(const r of result.results){try{
  const object=await env.BUCKET.get(r.object_key);if(!object||object.size>30000)throw new ApiError('Trace archivée non vérifiable.',503);
  const bytes=await object.arrayBuffer();if(bytes.byteLength>30000)throw new ApiError('Trace trop grande.',503);
  const text=new TextDecoder().decode(bytes);if(r.object_key!=='history/fusion-traces/'+r.digest+'.json'||await sha(text)!==r.digest)throw new ApiError('Trace archivée non vérifiable.',503);
  const p=JSON.parse(text),normalized=normalizeFusionSnapshot({...p,lat:50.7567,lon:2.5204,trace:{parameterSources:{tempMax:p.trace?.parameterSources?.temperature,precipitation:p.trace?.parameterSources?.precipitation,windSpeed:p.trace?.parameterSources?.wind}}},p.receivedAt);
  if(!normalized||p.version!==1||p.location!==LOCATION||p.kind!==normalized.kind||p.origin!=='browser'||p.calibrationEligible!==false||p.computedAt!==r.computed_at||p.receivedAt!==r.received_at||p.date!==r.valid_date||p.computedAt.slice(0,13)!==r.slot||p.receivedAt>now)throw new ApiError('Métadonnées de trace invalides.',503);
  snapshots.push({id:r.id,date:p.date,computedAt:p.computedAt,trace:p.trace,values:p.values,origin:p.origin});
 }catch(error){if(!onRejected)throw error;onRejected();}
 }
 return snapshots;
}
export async function readWeightHistory(input:any,env:any,now=Date.now()){
 const c=coordinates(input);if(c.lat!==50.7567||c.lon!==2.5204)return [];
 return readFusionSnapshots(env,now);
}
export async function compareSnapshots(input:any,env:any,now=Date.now()){
 if(!Number.isSafeInteger(input?.beforeId)||!Number.isSafeInteger(input?.afterId)||input.beforeId<=0||input.afterId<=0||input.beforeId===input.afterId)throw new ApiError('Snapshots invalides.');
 const all=await readWeightHistory(input,env,now),before=all.find(r=>r.id===input.beforeId),after=all.find(r=>r.id===input.afterId);
 if(!before||!after||before.date!==after.date)return null;
 return {before,after,parameters:compareTraceWeights(before.trace,after.trace)};
}

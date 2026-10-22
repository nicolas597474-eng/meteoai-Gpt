import {collectNetatmoBackground} from './netatmo-api.mjs';
import {recordServerObservations,verifyServerObservationArchive} from './server-observations';
import {finalizePhysicalReferences} from './physical-reference-store';
import {refreshQualifiedLearning} from './learning-collection';
import {readFutureProviderModels} from './learning-provider-runs';
import {readSigned} from './learning-store';
import {OFFICIAL_HOURLY_MODELS} from '../server/officialModels';

const CHANNEL='unattended_hourly_v1',LOCATION='50.757_2.520';
const json=(value:any,status=200)=>Response.json(value,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
type Evidence={observations:number;models:number;dailyModels:number;verified:boolean};

/** Relit les fichiers réels : un index ou un HTTP 200 ne suffit pas à confirmer une collecte. */
export async function backgroundEvidence(env:any,slot:string,now=Date.now()):Promise<Evidence>{
 const observation=await env.DB.prepare('SELECT * FROM weather_server_observations WHERE id=?').bind(LOCATION+'/'+slot).first();
 let observations=0;
 if(observation){const proof=await verifyServerObservationArchive(observation,env,now);if(!proof.truncated)observations=proof.rows.length;}
 const provider=await readFutureProviderModels(env,now);
 const accepted=new Set(OFFICIAL_HOURLY_MODELS.map(m=>m.modelId as string));
 const models=new Set(provider.models.filter(m=>accepted.has(m.modelId)&&m.hours.some(h=>Number.isFinite(h.temperature))).map(m=>m.modelId)).size;
 const daily=await env.DB.prepare('SELECT * FROM weather_learning_forecasts WHERE id=?').bind(LOCATION+'/'+slot).first();
 let dailyModels=0;
 if(daily){const proof=await readSigned(daily,'forecasts',env);
  if(proof.kind!=='server_daily_forecast'||proof.availableAt!==daily.received_at)throw Error('Capture quotidienne non vérifiable');
  dailyModels=new Set(proof.days.flatMap((day:any)=>day.forecasts.filter((f:any)=>accepted.has(f.modelId)).map((f:any)=>f.modelId))).size;
 }
 return {observations,models,dailyModels,verified:provider.filesRejected===0&&!provider.boundedRead};
}

export function safeCollectionFailure(error:unknown){
 const message=error instanceof Error?error.message:'';
 if(/^NETATMO_(NOT_CONFIGURED|NOT_CONNECTED|RECONNECT_REQUIRED|RATE_LIMIT|SCOPE|BUSY|INVALID_RESPONSE|UNAVAILABLE|FORBIDDEN|TIMEOUT|NETWORK_ERROR|PROVIDER_ERROR)$/.test(message))return message;
 if(message==='Réception physique invalide')return 'PHYSICAL_RECEIPT_INVALID';
 if(message==='Mesure serveur contradictoire')return 'PHYSICAL_MEASUREMENT_CONFLICT';
 if(message==='Mesure physique non conforme')return 'PHYSICAL_MEASUREMENT_INVALID';
 return error instanceof Error&&['TimeoutError','AbortError'].includes(error.name)?'PROVIDER_TIMEOUT':'COLLECTION_STORAGE_OR_PROVIDER_UNAVAILABLE';
}
export async function runCollection(env:any,operations={collectNetatmo:collectNetatmoBackground,recordObservations:recordServerObservations,finalizeReferences:finalizePhysicalReferences,refreshLearning:refreshQualifiedLearning}){
 let netatmo='ok',netatmoFailure:string|null=null;
 try{const measurements=await operations.collectNetatmo(env);await operations.recordObservations(measurements,env);}
 catch(error){netatmo='unavailable';netatmoFailure=safeCollectionFailure(error);}
 // Les erreurs restent distinctes ; les captures réussies sont conservées même si un fournisseur échoue.
 let references='ok',learning='ok';
 try{await operations.finalizeReferences(env);}catch{references='unavailable';}
 try{
  const result=await operations.refreshLearning(env);
  if(result?.providerCollection?.status==='failed'||result?.collection?.status==='failed'||result?.qualification?.available===false)learning='unavailable';
 }catch{learning='unavailable';}
 return {netatmo,references,learning,...(netatmoFailure?{netatmoFailure}:{})};
}

async function keyMatches(actual:string,expected:string){
 if(!/^[a-f0-9]{64}$/.test(actual))return false;
 const encoder=new TextEncoder();
 const [a,b]=await Promise.all([actual,expected].map(value=>crypto.subtle.digest('SHA-256',encoder.encode(value))));
 const x=new Uint8Array(a),y=new Uint8Array(b);let difference=0;
 for(let i=0;i<x.length;i++)difference|=x[i]^y[i];
 return difference===0;
}

const complete=(e:Evidence)=>e.verified&&e.observations>0&&e.models===OFFICIAL_HOURLY_MODELS.length&&e.dailyModels===OFFICIAL_HOURLY_MODELS.length;

/** Accès de plateforme Sites + clé d'opération dédiée ; aucune identité de visiteur fabriquée. */
export async function handleBackgroundCollection(request:Request,env:any,now=Date.now(),operations={run:runCollection,verify:backgroundEvidence}){
 if(request.method!=='POST')return json({error:'Méthode non autorisée'},405);
 if(env.METEOAI_BACKGROUND_ENABLED!=='true'||!/^[a-f0-9]{64}$/.test(env.METEOAI_BACKGROUND_OWNER??'')||!/^[a-f0-9]{64}$/.test(env.METEOAI_COLLECTOR_KEY??''))return json({error:'Collecte automatique désactivée'},503);
 if(!await keyMatches(request.headers.get('X-MeteoAI-Collector-Key')??'',env.METEOAI_COLLECTOR_KEY))return json({error:'Accès non autorisé'},403);
 if(request.headers.has('Origin')||!request.headers.get('Content-Type')?.startsWith('application/json'))return json({error:'Requête de service attendue'},403);
 if(Number(request.headers.get('Content-Length')??0)>32)return json({error:'Requête trop grande'},413);
 const text=await request.text();if(text.length>32)return json({error:'Requête trop grande'},413);
 let body;try{body=JSON.parse(text);}catch{return json({error:'JSON invalide'},400);}
 if(!body||Array.isArray(body)||typeof body!=='object'||Object.keys(body).length)return json({error:'Aucune donnée client acceptée'},400);
 const slot=new Date(now).toISOString().slice(0,13),at=new Date(now).toISOString();
 try{
  const prior=await env.DB.prepare('SELECT * FROM weather_collection_status WHERE channel=?').bind(CHANNEL).first();
  if(prior?.status==='ok'&&prior.attempted_at.slice(0,13)===slot){
   const evidence=await operations.verify(env,slot,now);
   if(complete(evidence))return json({version:1,slot,status:'duplicate',...evidence});
  }
  // Bail durable partagé entre le PC et les instances serveur, avec reprise après dix minutes.
  const lease=await env.DB.prepare('INSERT INTO weather_collection_status(channel,attempted_at,status,message) VALUES (?,?,?,?) ON CONFLICT(channel) DO UPDATE SET attempted_at=excluded.attempted_at,status=excluded.status,message=excluded.message WHERE weather_collection_status.attempted_at<=? RETURNING channel').bind(CHANNEL,at,'running','Collecte serveur autorisée',new Date(now-600000).toISOString()).first();
  if(!lease)return json({version:1,slot,status:'busy'},409);
  try{
   const sources=await operations.run(env),finished=Date.now();
   // Ne pas attribuer au créneau précédent des mesures reçues après le changement d'heure.
   if(new Date(finished).toISOString().slice(0,13)!==slot)throw Error('Créneau dépassé');
   const evidence=await operations.verify(env,slot,finished);
   const status=complete(evidence)?'complete':'partial',receipt={version:1,slot,status,...evidence,sources};
   await env.DB.prepare('UPDATE weather_collection_status SET status=?,message=? WHERE channel=? AND attempted_at=?').bind(status==='complete'?'ok':'partial',JSON.stringify(receipt),CHANNEL,at).run();
   return json(receipt,status==='complete'?200:207);
  }catch{
   await env.DB.prepare('UPDATE weather_collection_status SET status=?,message=? WHERE channel=? AND attempted_at=?').bind('failed','Collecte ou relecture indisponible ; archives conservées',CHANNEL,at).run();
   return json({version:1,slot,status:'failed'},503);
  }
 }catch{return json({version:1,slot,status:'failed'},503);}
}

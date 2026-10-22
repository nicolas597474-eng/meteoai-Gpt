import {OFFICIAL_HOURLY_MODELS} from '../server/officialModels';
import {ARCHIVED_FORECAST_FIELDS} from './archive';
import type {ArchivedModelCoverage} from '../shared/archiveDiagnostics';
const models=OFFICIAL_HOURLY_MODELS.map(model=>model.name),location='50.757_2.520';
const sha=async(text:string)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text)))).map(value=>value.toString(16).padStart(2,'0')).join('');
const validTime=(value:unknown):value is number=>typeof value==='number'&&Number.isFinite(value)&&value>=0&&value<=8640000000000000;
/** Le contenu, sa portée et l’index doivent concorder avant de confirmer un modèle archivé. */
export async function verifyForecastArchive(row:any,env:any,now=Date.now()){
 if(!/^[a-f0-9]{64}$/.test(row.digest??'')||row.object_key!=='history/captures/'+row.digest+'.json')throw Error('Archive non conforme');
 const receivedAt=Date.parse(row.received_at),capturedAt=Date.parse(row.captured_at);
 if(!validTime(receivedAt)||!validTime(capturedAt)||receivedAt>now||capturedAt>now+300000||row.location_key!==location)throw Error('Métadonnées non conformes');
 const object=await env.BUCKET.get(row.object_key);if(!object||object.size>2000000)throw Error('Archive absente ou trop grande');
 const bytes=await object.arrayBuffer();if(bytes.byteLength>2000000)throw Error('Archive trop grande');
 const text=new TextDecoder().decode(bytes);if(await sha(text)!==row.digest)throw Error('Empreinte incorrecte');
 const payload=JSON.parse(text);
 if(payload.version!==1||payload.kind!=='forecast'||payload.location!==location||payload.lat!==50.7567||payload.lon!==2.5204||payload.observation!==false||payload.calibrationEligible!==false||!['browser','server'].includes(payload.origin)||payload.origin!==row.origin||payload.receivedAt!==receivedAt||payload.capturedAt!==capturedAt||Math.abs(receivedAt-capturedAt)>300000)throw Error('Portée de l’archive incorrecte');
 if(!Array.isArray(payload.models)||!payload.models.length||payload.models.length>models.length)throw Error('Modèles non conformes');
 const coverage:ArchivedModelCoverage[]=[],seen=new Set<string>();let hours=0;
 for(const model of payload.models){
  if(!models.includes(model.modelName)||seen.has(model.modelName)||model.sourceName!=='open-meteo'||!Array.isArray(model.hours)||!model.hours.length||model.hours.length>72)throw Error('Modèle non conforme');
  seen.add(model.modelName);const times=new Set<number>();let values=0,hasTemperature=false;
  for(const hour of model.hours){
   if(!hour||!validTime(hour.validAt)||hour.validAt<receivedAt||hour.validAt>receivedAt+72*3600000||times.has(hour.validAt))throw Error('Échéance non conforme');
   times.add(hour.validAt);
   for(const field of ARCHIVED_FORECAST_FIELDS){const value=hour[field];if(value!==null&&(typeof value!=='number'||!Number.isFinite(value)||Math.abs(value)>100000))throw Error('Champ non conforme');if(value!==null)values++;}
   if(hour.temperature!==null)hasTemperature=true;
  }
  if(!hasTemperature)throw Error('Température absente');
  const ordered=Array.from(times).sort((a,b)=>a-b);hours+=ordered.length;
  coverage.push({model:model.modelName,hoursArchived:ordered.length,valuesArchived:values,firstValidAt:ordered[0],lastValidAt:ordered[ordered.length-1]});
 }
 if(row.model_count!==coverage.length||row.forecast_count!==hours)throw Error('Index non conforme');
 return {receivedAt:new Date(receivedAt).toISOString(),models:coverage,payload,forecastHours:payload.models.flatMap((model:any)=>model.hours.filter((hour:any)=>hour.temperature!==null).map((hour:any)=>({receivedAt,validAt:hour.validAt})))};
}


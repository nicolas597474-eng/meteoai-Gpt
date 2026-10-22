import {auxiliaryFromStation,normalizePhysicalAuxiliary,type PhysicalAuxiliary} from './physical-auxiliary';
import type {VerifiedObservation} from './observation-integrity';
const LOCATION='50.757_2.520',HOUR=3600000,MAX_STATIONS=1000;
const sha=async(text:string)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text)))).map(v=>v.toString(16).padStart(2,'0')).join('');
const timestamp=(v:unknown):v is number=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=0;
type Measurement={stationKey:string;measuredAt:number;temperature:number;humidity?:number|null;distance:number;elevation:number|null;flagged:boolean;auxiliary?:PhysicalAuxiliary};

function normalizeRows(input:any[],receivedAt:number,version=1){
 if(version!==1&&version!==2&&version!==3)throw Error('Version physique inconnue');
 if(!Array.isArray(input)||input.length>MAX_STATIONS)throw Error('Lot physique trop grand');
 const ids=new Set<string>();
 return input.map((row:any):Measurement=>{
  if(!/^[a-f0-9]{64}$/.test(row?.stationKey??'')||!timestamp(row.measuredAt)||row.measuredAt>receivedAt||row.measuredAt<receivedAt-90*60000||!Number.isFinite(row.temperature)||row.temperature< -45||row.temperature>55||!Number.isFinite(row.distance)||row.distance<0||row.distance>50||(row.elevation!==null&&(!Number.isFinite(row.elevation)||row.elevation< -500||row.elevation>9000))||typeof row.flagged!=='boolean'||ids.has(row.stationKey))throw Error('Mesure physique non conforme');
  ids.add(row.stationKey);
  if(version>=2&&row.humidity!==null&&(!Number.isFinite(row.humidity)||row.humidity<0||row.humidity>100))throw Error('Humidité physique non conforme');
  return {stationKey:row.stationKey,measuredAt:row.measuredAt,temperature:row.temperature,...(version>=2?{humidity:row.humidity}:{}),...(version===3?{auxiliary:normalizePhysicalAuxiliary(row.auxiliary,receivedAt)}:{}),distance:row.distance,elevation:row.elevation,flagged:row.flagged};
 });
}
/** Appel interne après la réponse OAuth Netatmo. Aucun endpoint navigateur ne peut écrire ces lots. */
export async function recordServerObservations(input:any,env:any,now=Date.now()){
 if(input?.lat!==50.7567||input?.lon!==2.5204||input.radiusKm!==50)return {stored:false,reason:'not_covered'};
 if(!timestamp(input.providerReceivedAt)||input.providerReceivedAt>now||now-input.providerReceivedAt>10*60000||!Array.isArray(input.stations)||input.stations.length>10000)throw Error('Réception physique invalide');
 const receivedAt=input.providerReceivedAt,id=LOCATION+'/'+new Date(receivedAt).toISOString().slice(0,13);
 const existing=await env.DB.prepare('SELECT id FROM weather_server_observations WHERE id=?').bind(id).first();
 if(existing)return {stored:false,duplicate:true};
 const candidates=input.stations.filter((s:any)=>typeof s?.id==='string'&&s.id.startsWith('netatmo-')&&s.id.length<=160&&Number.isFinite(s.temp)&&s.temp>= -45&&s.temp<=55&&timestamp(s.time)&&s.time<=receivedAt&&s.time>=receivedAt-90*60000&&Number.isFinite(s.distance)&&s.distance>=0&&s.distance<=50).sort((a:any,b:any)=>a.distance-b.distance);
 const stations=new Map<string,any>();for(const s of candidates){const prior=stations.get(s.id);if(!prior||s.time>prior.time)stations.set(s.id,s);else if(s.time===prior.time&&(s.temp!==prior.temp||Number.isFinite(s.humidity)&&Number.isFinite(prior.humidity)&&s.humidity!==prior.humidity))throw Error('Mesure serveur contradictoire');}
 const selected=Array.from(stations.values()).slice(0,MAX_STATIONS);
 const rows=normalizeRows(await Promise.all(selected.map(async s=>({stationKey:await sha(s.id),measuredAt:s.time,temperature:s.temp,humidity:typeof s.humidity==='number'&&Number.isFinite(s.humidity)&&s.humidity>=0&&s.humidity<=100?s.humidity:null,auxiliary:auxiliaryFromStation(s,receivedAt),distance:s.distance,elevation:Number.isFinite(s.elevation)&&s.elevation>= -500&&s.elevation<=9000?s.elevation:null,flagged:s.anomaly===true}))),receivedAt,3);
 if(!rows.length)return {stored:false,reason:'no_usable_measurement'};
 const payload={version:3,kind:'server_station_observations',source:'netatmo_server',location:LOCATION,receivedAt,persistedAt:now,truncated:stations.size>MAX_STATIONS,calibrationEligible:false,rows};
 const text=JSON.stringify(payload),digest=await sha(text),key='history/server-observations/'+digest+'.json';
 await env.BUCKET.put(key,text,{httpMetadata:{contentType:'application/json'}});
 await env.DB.prepare('INSERT INTO weather_server_observations(id,location_key,received_at,persisted_at,measurement_count,object_key,digest) VALUES (?,?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING').bind(id,LOCATION,receivedAt,now,rows.length,key,digest).run();
 return {stored:true,measurements:rows.length};
}

export async function verifyServerObservationArchive(index:any,env:any,now=Date.now()):Promise<{rows:VerifiedObservation[];truncated:boolean}>{
 if(!/^[a-f0-9]{64}$/.test(index.digest??'')||index.object_key!=='history/server-observations/'+index.digest+'.json'||index.location_key!==LOCATION||!timestamp(index.received_at)||index.received_at>now||!timestamp(index.persisted_at)||index.persisted_at<index.received_at||index.persisted_at-index.received_at>10*60000||index.persisted_at>now||index.id!==LOCATION+'/'+new Date(index.received_at).toISOString().slice(0,13))throw Error('Index physique serveur incohérent');
 const object=await env.BUCKET.get(index.object_key);if(!object||object.size>1000000)throw Error('Lot physique absent ou trop grand');
 const bytes=await object.arrayBuffer();if(bytes.byteLength>1000000)throw Error('Lot physique trop grand');
 const text=new TextDecoder().decode(bytes);if(await sha(text)!==index.digest)throw Error('Empreinte physique incorrecte');
 const value=JSON.parse(text);if(value.version!==1&&value.version!==2&&value.version!==3)throw Error('Version physique inconnue');
 const rows=normalizeRows(value.rows,index.received_at,value.version);
 const normalized={version:value.version,kind:'server_station_observations',source:'netatmo_server',location:LOCATION,receivedAt:index.received_at,persistedAt:index.persisted_at,truncated:value.truncated,calibrationEligible:false,rows};
 if(typeof value.truncated!=='boolean'||!rows.length||index.measurement_count!==rows.length||JSON.stringify(normalized)!==text)throw Error('Lot physique serveur incohérent');
 return {truncated:value.truncated,rows:rows.map(row=>({stationKey:row.stationKey,measuredAt:row.measuredAt,receivedAt:index.received_at,temperature:row.temperature,...(value.version>=2?{humidity:row.humidity}:{}),...(value.version===3?{auxiliary:row.auxiliary}:{}),distance:row.distance,elevation:row.elevation,flags:[...(row.flagged?['source_flagged']:[]),...(index.received_at-row.measuredAt>30*60000?['older_than_30_minutes']:[])]}))};
}

/** Lecture bornée, sans récupération réseau, correction, qualification ou mélange avec la passerelle navigateur. */
export async function readServerObservations(env:any,now=Date.now()){
 const metadata=await env.DB.prepare('SELECT * FROM weather_server_observations WHERE location_key=? AND received_at>=? AND received_at<=? AND persisted_at<=? ORDER BY received_at DESC LIMIT 49').bind(LOCATION,now-7*24*HOUR,now,now).all();
 if(!Array.isArray(metadata?.results))throw Error('Lecture physique serveur indisponible');
 const rows:VerifiedObservation[]=[],seen=new Map<string,VerifiedObservation>(),conflicts=new Set<string>();let rejected=0,truncated=false,lastReceivedAt:number|null=null;
 for(const index of metadata.results.slice(0,48)){
  try{const verified=await verifyServerObservationArchive(index,env,now);truncated||=verified.truncated;lastReceivedAt=Math.max(lastReceivedAt??0,index.received_at);
   for(const row of verified.rows){const id=row.stationKey+'/'+row.measuredAt,prior=seen.get(id);if(conflicts.has(id))continue;if(prior&&(row.temperature!==prior.temperature||Number.isFinite(row.humidity)&&Number.isFinite(prior.humidity)&&row.humidity!==prior.humidity||row.distance!==prior.distance||row.elevation!==prior.elevation)){seen.delete(id);conflicts.add(id);continue;}if(!prior||row.receivedAt<prior.receivedAt)seen.set(id,row);}
  }catch{rejected++;}
 }
 rows.push(...seen.values());
 return {rows,status:rejected||conflicts.size?'partial' as const:metadata.results.length?'verified' as const:'none' as const,conflictingMeasurements:conflicts.size,checkedArchives:Math.min(metadata.results.length,48),rejectedArchives:rejected,boundedRead:metadata.results.length>48||truncated,filesLimit:48 as const,auxiliaryCoverage:Object.fromEntries(["pressure","windSpeed","windGust","precipitation"].map(field=>[field,rows.filter(row=>row.auxiliary?.[field as keyof PhysicalAuxiliary]!=null).length])),lastReceivedAt};
}

/** Archive de mesures reçues via la passerelle navigateur Netatmo.
 * Provenance explicite : ces données ne sont pas encore des preuves de calibration. */
import {verifyObservationArchive} from './observation-integrity';
const hash=async(value:string)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)))).map(v=>v.toString(16).padStart(2,'0')).join('');
const source='netatmo_browser_bridge';
export async function prepareObservations(input:any,now=Date.now()){
 if(input?.lat!==50.7567||input?.lon!==2.5204)throw Error('Archivage limité à Hondeghem');
 if(!Array.isArray(input.stations)||input.stations.length>200)throw Error('Liste de stations invalide');
 const rows:any[]=[],seen=new Map<string,string>();let excluded=0;
 for(const s of input.stations){
  if(typeof s?.id!=='string'||!s.id.startsWith('netatmo-')||s.id.length>160)throw Error('Identifiant de station invalide');
  if(![s.temp,s.time,s.distance].every(Number.isFinite)||s.distance<0||s.distance>50)throw Error('Mesure ou distance invalide');
  if(s.temp < -45||s.temp>55||s.time<now-90*60000||s.time>now+5*60000){excluded++;continue;}
  const stationKey=await hash(s.id),measuredAt=Math.trunc(s.time),id=stationKey+'/'+measuredAt;
  const measurement={id,stationKey,measuredAt,temperature:s.temp,distance:s.distance,elevation:Number.isFinite(s.elevation)?s.elevation:null,source};
  const digest=await hash(JSON.stringify(measurement));
  if(seen.has(id)){if(seen.get(id)!==digest)throw Error('Deux valeurs différentes pour la même mesure');continue;}seen.set(id,digest);
  const flags=[];if(s.anomaly===true)flags.push('source_flagged');if(now-measuredAt>30*60000)flags.push('older_than_30_minutes');
  rows.push({...measurement,receivedAt:now,flags,digest,calibrationEligible:false});
 }
 return {rows,excluded};
}
export async function recordObservations(input:any,env:any,now=Date.now()){
 const prepared=await prepareObservations(input,now),existing=new Map<string,string>();
 for(let offset=0;offset<prepared.rows.length;offset+=80){const chunk=prepared.rows.slice(offset,offset+80);const result=await env.DB.prepare('SELECT id,payload_digest FROM weather_station_observations WHERE id IN ('+chunk.map(()=>'?').join(',')+')').bind(...chunk.map(r=>r.id)).all();for(const r of result.results)existing.set(r.id,r.payload_digest);}
 let duplicates=0,conflicts=0;
 const rows=prepared.rows.filter(r=>{if(!existing.has(r.id))return true;if(existing.get(r.id)===r.digest)duplicates++;else conflicts++;return false;});
 if(!rows.length)return {stored:0,duplicates,conflicts,excluded:prepared.excluded,calibrationEligible:false};
 const text=JSON.stringify({version:1,kind:'station_observations',source,receivedAt:now,calibrationEligible:false,rows}),digest=await hash(text),objectKey='history/station-observations/'+digest+'.json';
 await env.BUCKET.put(objectKey,text,{httpMetadata:{contentType:'application/json'}});
 let stored=0;
 for(let offset=0;offset<rows.length;offset+=40){
  const chunk=rows.slice(offset,offset+40);
  const results=await env.DB.batch(chunk.map(r=>env.DB.prepare('INSERT INTO weather_station_observations(id,station_key,measured_at,received_at,temperature,distance,elevation,source,quality_flags,payload_digest,object_key,calibration_eligible) VALUES (?,?,?,?,?,?,?,?,?,?,?,0) ON CONFLICT(id) DO NOTHING').bind(r.id,r.stationKey,r.measuredAt,r.receivedAt,r.temperature,r.distance,r.elevation,source,JSON.stringify(r.flags),r.digest,objectKey)));
  stored+=results.reduce((n:number,r:any)=>n+Number(r.meta?.changes??r.changes??0),0);
 }
 return {stored,duplicates:duplicates+rows.length-stored,conflicts,excluded:prepared.excluded,calibrationEligible:false};
}
export async function observationStatus(env:any){
 const counts=await env.DB.prepare('SELECT COUNT(*) AS measurements,COUNT(DISTINCT station_key) AS stations,MIN(measured_at) AS firstMeasurement,MAX(measured_at) AS lastMeasurement,MAX(received_at) AS lastReceived,SUM(CASE WHEN quality_flags != \'[]\' THEN 1 ELSE 0 END) AS flagged FROM weather_station_observations').first();
 return {...counts,source,calibration:'not_active',collection:'while_stations_page_is_open'};
}
export async function verifyLatestObservations(env:any){
 const latest=await env.DB.prepare('SELECT object_key FROM weather_station_observations ORDER BY received_at DESC LIMIT 1').first();
 if(!latest)return {verified:false,reason:'no_measurements'};
 const rows=await verifyObservationArchive(latest.object_key,env);
 return {verified:true,measurements:rows.length,source,calibrationEligible:false,digest:latest.object_key.slice('history/station-observations/'.length,-5)};
}
export function observationSummaryHtml(status:any){
 const fr=(v:number|null)=>v==null?'—':new Date(v).toLocaleString('fr-FR',{timeZone:'Europe/Paris'});
 return `<article><h2>Mesures Netatmo archivées</h2><p>${Number(status.measurements)||0} mesure(s) · ${Number(status.stations)||0} station(s).</p><p>Première mesure : ${fr(status.firstMeasurement)}<br>Dernière mesure : ${fr(status.lastMeasurement)}</p><p>${Number(status.flagged)||0} mesure(s) signalée(s) par les contrôles de qualité.</p><p>Reçues via le navigateur, conservées séparément des prévisions. Validation pour la calibration encore en attente. La collecte se poursuit quand la page Stations est ouverte.</p><a href="/ranking">Ouvrir les stations</a></article>`;
}

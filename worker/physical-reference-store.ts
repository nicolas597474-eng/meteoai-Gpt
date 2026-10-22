import {verifyServerObservationArchive} from './server-observations';
import {buildPhysicalReferences} from './physical-references';
import {getParisDateAndHour,parisLocalHourToUniqueEpochMs} from '../server/parisHourlyTime';
import {buildQualifiedDailyObservation} from '../server/physicalObservationAggregation';
import type {VerifiedObservation} from './observation-integrity';
const LOCATION='50.757_2.520',HOUR=3600000,METHOD='original_spatial_20km_3stations_v1';
const hash=async(text:string)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text)))).map(v=>v.toString(16).padStart(2,'0')).join('');

/** Dérivation déterministe à partir des seules mesures de l'heure, sans prévision. */
export function derivePhysicalReference(rows:VerifiedObservation[],validAt:number,createdAt:number,includeAuxiliary=true){
 if(!Number.isSafeInteger(validAt)||validAt<0||validAt%HOUR!==0||!Number.isSafeInteger(createdAt)||createdAt>8640000000000000||createdAt<validAt+HOUR)return null;
 const local=getParisDateAndHour(validAt);
 if(!local||parisLocalHourToUniqueEpochMs(local.date,local.hour)!==validAt)return null;
 const unique=new Map<string,VerifiedObservation>();
 for(const row of rows.filter(r=>r.measuredAt>=validAt&&r.measuredAt<validAt+HOUR&&r.receivedAt<=createdAt)){
  const id=row.stationKey+'/'+row.measuredAt,prior=unique.get(id);
  if(prior&&(prior.temperature!==row.temperature||Number.isFinite(prior.humidity)&&Number.isFinite(row.humidity)&&prior.humidity!==row.humidity||prior.distance!==row.distance||prior.elevation!==row.elevation))throw Error('Mesure physique contradictoire');
  if(!prior||row.receivedAt<prior.receivedAt)unique.set(id,row);
 }
 const ordered=Array.from(unique.values()).sort((a,b)=>a.stationKey.localeCompare(b.stationKey)||a.measuredAt-b.measuredAt||a.receivedAt-b.receivedAt);
 const observations=ordered.map(r=>({station_key:r.stationKey,measured_at:r.measuredAt,received_at:r.receivedAt,temperature:r.temperature,...(includeAuxiliary&&r.auxiliary?{auxiliary:r.auxiliary}:{}),...(Object.hasOwn(r,'humidity')?{humidity:r.humidity}:{}),distance:r.distance,elevation:r.elevation,quality_flags:JSON.stringify(r.flags),source:'netatmo_server'}));
 const computed=buildPhysicalReferences(observations,createdAt,'netatmo_server',includeAuxiliary);
 const reference=computed.references.find(r=>r.validTime===validAt),snapshot=computed.snapshots.find(r=>r.date===local.date&&r.hour===local.hour);
 return reference&&snapshot?{snapshot,firstMeasuredAt:reference.firstMeasuredAt as number,lastMeasuredAt:reference.lastMeasuredAt as number}:null;
}

type Source={index:any;rows:VerifiedObservation[];truncated:boolean};
function sourceLoader(env:any,now:number){
 const cache=new Map<string,Promise<Source>>();
 return (id:string)=>{
  if(!cache.has(id)&&cache.size>=8)cache.delete(cache.keys().next().value!);
  if(!cache.has(id))cache.set(id,(async()=>{
   if(!/^50\.757_2\.520\/\d{4}-\d{2}-\d{2}T\d{2}$/.test(id))throw Error('Source physique inconnue');
   const index=await env.DB.prepare('SELECT * FROM weather_server_observations WHERE id=?').bind(id).first();
   if(!index)throw Error('Source physique absente');
   const verified=await verifyServerObservationArchive(index,env,now);
   // Cache borné à huit lots ; chaque nouvelle référence conserve ses grandeurs distinctes.
   return {index,...verified};
  })());
  return cache.get(id)!;
 };
}

/** Une première référence par heure finie ; jamais de reconstitution à partir du navigateur. */
export async function finalizePhysicalReferences(env:any,now=Date.now()){
 const load=sourceLoader(env,now);let stored=0;
 // Reprise des vrais lots conservés après une interruption, sans créer les heures absentes.
 const recent=await env.DB.prepare('SELECT received_at FROM weather_server_observations WHERE location_key=? AND received_at>=? AND received_at<=? ORDER BY received_at DESC LIMIT 48').bind(LOCATION,now-7*24*HOUR,now).all();
 const prior=await env.DB.prepare('SELECT valid_at FROM weather_physical_references WHERE location_key=? AND valid_at>=? LIMIT 169').bind(LOCATION,now-7*24*HOUR).all();
 if(!Array.isArray(recent?.results)||!Array.isArray(prior?.results))throw Error('Lecture de reprise physique indisponible');
 const known=new Set<number>(prior.results.map((r:any)=>r.valid_at)),candidates=new Set<number>();
 for(const row of recent.results){if(!Number.isSafeInteger(row.received_at))continue;const at=Math.floor(row.received_at/HOUR)*HOUR;for(const slot of [at-HOUR,at])if(slot+HOUR<=now&&slot>=now-7*24*HOUR&&!known.has(slot))candidates.add(slot);}
 // Huit créneaux au maximum par consultation : coût borné, sans appel fournisseur supplémentaire.
 for(const validAt of Array.from(candidates).sort((a,b)=>b-a).slice(0,8)){
  const id=LOCATION+'/'+validAt;
  if(await env.DB.prepare('SELECT id FROM weather_physical_references WHERE id=?').bind(id).first())continue;
  const result=await env.DB.prepare('SELECT id FROM weather_server_observations WHERE location_key=? AND received_at>=? AND received_at<=? AND persisted_at<=? ORDER BY id ASC LIMIT 5').bind(LOCATION,validAt,Math.min(now,validAt+HOUR+90*60000),now).all();
  if(!Array.isArray(result?.results)||!result.results.length||result.results.length>4)continue;
  try{
   const sources=await Promise.all(result.results.map((r:any)=>load(r.id)));if(sources.some(s=>s.truncated))continue;
   const derived=derivePhysicalReference(sources.flatMap(s=>s.rows),validAt,now);if(!derived)continue;
   const payload={version:derived.snapshot.auxiliaryReferences?3:Object.hasOwn(derived.snapshot,'humidity')?2:1,kind:'hourly_physical_reference',method:METHOD,source:'netatmo_server',location:LOCATION,validAt,createdAt:now,sourceIds:result.results.map((r:any)=>r.id),...derived,calibrationEligible:false};
   const text=JSON.stringify(payload),digest=await hash(text),key='history/physical-references/'+digest+'.json';
   if(text.length>1000000)continue;
   await env.BUCKET.put(key,text,{httpMetadata:{contentType:'application/json'}});
   await env.DB.prepare('INSERT INTO weather_physical_references(id,location_key,valid_at,created_at,station_count,temperature,object_key,digest) VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING').bind(id,LOCATION,validAt,now,derived.snapshot.stationCount,derived.snapshot.temperature,key,digest).run();stored++;
  }catch{console.warn('Référence physique non enregistrée ; contrôle des sources ou stockage indisponible.');}
 }
 return {stored,calibration:'not_active'};
}

async function verifyReference(index:any,env:any,load:ReturnType<typeof sourceLoader>,now:number,detailed=false){
 if(index.location_key!==LOCATION||!Number.isSafeInteger(index.valid_at)||index.valid_at%HOUR!==0||index.id!==LOCATION+'/'+index.valid_at||!Number.isSafeInteger(index.created_at)||index.created_at>now||index.created_at<index.valid_at+HOUR||!/^history\/physical-references\/[a-f0-9]{64}\.json$/.test(index.object_key??'')||index.object_key!=='history/physical-references/'+index.digest+'.json')throw Error('Index de référence invalide');
 const object=await env.BUCKET.get(index.object_key);if(!object||object.size>1000000)throw Error('Référence absente ou trop grande');
 const bytes=await object.arrayBuffer();if(bytes.byteLength>1000000)throw Error('Référence trop grande');
 const text=new TextDecoder().decode(bytes);if(await hash(text)!==index.digest)throw Error('Empreinte de référence incorrecte');
 const p=JSON.parse(text);
 if(!Array.isArray(p.sourceIds)||!p.sourceIds.length||p.sourceIds.length>4||new Set(p.sourceIds).size!==p.sourceIds.length||p.sourceIds.some((id:any)=>typeof id!=='string')||[...p.sourceIds].sort().join('|')!==p.sourceIds.join('|'))throw Error('Provenance de référence invalide');
 const sources=await Promise.all(p.sourceIds.map((id:string)=>load(id)));
 if(sources.some(s=>s.truncated||s.index.received_at<index.valid_at||s.index.received_at>Math.min(index.created_at,index.valid_at+HOUR+90*60000)||s.index.persisted_at>index.created_at))throw Error('Réception physique hors fenêtre');
 const derived=derivePhysicalReference(sources.flatMap(s=>s.rows),index.valid_at,index.created_at,p.version===3);if(!derived)throw Error('Référence non reproductible');
 const expected={version:derived.snapshot.auxiliaryReferences?3:Object.hasOwn(derived.snapshot,'humidity')?2:1,kind:'hourly_physical_reference',method:METHOD,source:'netatmo_server',location:LOCATION,validAt:index.valid_at,createdAt:index.created_at,sourceIds:p.sourceIds,...derived,calibrationEligible:false};
 if(JSON.stringify(expected)!==text||derived.snapshot.stationCount!==index.station_count||derived.snapshot.temperature!==index.temperature)throw Error('Référence ou index non reproductible');
 // La preuve détaillée est vérifiée ci-dessus ; le bilan ne retient pas les contributeurs des 48 références.
 const stationsUsed=detailed?derived.snapshot.stationsUsed as any[]:undefined;
 const rows=detailed?sources.flatMap(s=>s.rows):[];
 // Les valeurs individuelles restent internes ; elles ne sont jamais remplacées par la moyenne.
 const stationEvidence=stationsUsed?.map(station=>{
  const row=rows.find(r=>r.stationKey===station.stationId&&r.measuredAt===Date.parse(station.measurementTimes.temperature));
  if(!row)throw Error('Contributeur physique absent');
  return {...station,stationId:'netatmo-'+station.stationId,source:'netatmo',temperature:row.temperature,weight:station.fieldWeights.temperature};
 });
 return {validAt:index.valid_at as number,createdAt:index.created_at as number,...derived,snapshot:{...derived.snapshot,windGust:null,stationsUsed:stationEvidence}};
}

/** Relecture complète d'une journée pour le scoreur ; aucune qualification par le seul index. */
export async function readVerifiedPhysicalDay(env:any,date:string,now=Date.now()){
 if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||new Date(date+'T12:00:00Z').toISOString().slice(0,10)!==date)throw Error('Date physique invalide');
 const next=new Date(Date.parse(date+'T12:00:00Z')+86400000).toISOString().slice(0,10);
 const start=parisLocalHourToUniqueEpochMs(date,0),end=parisLocalHourToUniqueEpochMs(next,0);
 if(start==null||end==null||end>now)throw Error('Journée physique non terminée');
 const result=await env.DB.prepare('SELECT * FROM weather_physical_references WHERE location_key=? AND valid_at>=? AND valid_at<? ORDER BY valid_at ASC LIMIT 26').bind(LOCATION,start,end).all();
 if(!Array.isArray(result?.results)||result.results.length>25)throw Error('Journée physique non bornée');
 const load=sourceLoader(env,now),references=[];
 for(const index of result.results){const verified=await verifyReference(index,env,load,now,true);references.push({...verified,id:index.id,digest:index.digest});}
 return {date,start,end,references,snapshots:references.map(r=>r.snapshot)};
}

/** Relecture du calcul et de ses sources ; seuls des agrégats sans identifiants sont exposés. */
export async function readPhysicalReferenceEvidence(env:any,now=Date.now()){
 const metadata=await env.DB.prepare('SELECT * FROM weather_physical_references WHERE location_key=? AND valid_at>=? AND valid_at<=? AND created_at<=? ORDER BY valid_at DESC LIMIT 49').bind(LOCATION,now-7*24*HOUR,Math.floor(now/HOUR)*HOUR-HOUR,now).all();
 if(!Array.isArray(metadata?.results))throw Error('Lecture de références indisponible');
 const load=sourceLoader(env,now),verified:Awaited<ReturnType<typeof verifyReference>>[]=[];let rejected=0;
 for(const index of metadata.results.slice(0,48)){try{verified.push(await verifyReference(index,env,load,now));}catch{rejected++;}}
 const today=getParisDateAndHour(now)?.date,dates=Array.from(new Set(verified.map(r=>r.snapshot.date))).sort().reverse();
 const days=dates.map(date=>{
  const references=verified.filter(r=>r.snapshot.date===date),aggregation=buildQualifiedDailyObservation(references.map(r=>({...r.snapshot,windGust:null})));
  return {date:date!,hours:references.map(r=>r.snapshot.hour).sort((a,b)=>a-b),coverageHours:aggregation.coverageHours,closedDay:!!today&&date!<today,thresholdMet:aggregation.isQualified};
 });
 const auxiliaryReferenceCounts=Object.fromEntries(['pressure','windSpeed','windGust','precipitation'].map(field=>[field,verified.filter(r=>(r.snapshot.auxiliaryReferences as any)?.[field]?.scoreEligible===true).length]));
 return {auxiliaryReferenceCounts,status:rejected?'partial' as const:verified.length?'verified' as const:'none' as const,referenceCount:verified.length,filesChecked:Math.min(metadata.results.length,48),filesRejected:rejected,filesLimit:48 as const,boundedRead:metadata.results.length>48,lastCreatedAt:verified.length?Math.max(...verified.map(r=>r.createdAt)):null,days,temperatureOnly:!verified.some(r=>r.snapshot.humidity!=null),humidityReferenceCount:verified.filter(r=>r.snapshot.humidity!=null).length,calibration:'not_active' as const};
}

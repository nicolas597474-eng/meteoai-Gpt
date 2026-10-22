import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {build} from 'esbuild';
import {archiveTestContext,recordObservations} from './archive-test-context.mjs';
import {handleNetatmo,seal,digest,stationZone,SITE_ORIGIN} from './netatmo-api.mjs';
import worker from '../dist/server/index.js';
const built=await build({entryPoints:['worker/server-observations.ts'],bundle:true,platform:'node',format:'esm',write:false});
const {recordServerObservations,readServerObservations}=await import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].text).toString('base64'));
const coords={lat:50.7567,lon:2.5204},now=Date.now()-1000,HOUR=3600000;
const input=(at=now)=>({...coords,radiusKm:50,providerReceivedAt:at,stations:[0,1,2].map(i=>({id:'netatmo-serveur-'+i,time:at-60000,temp:0,distance:i+1,elevation:null,anomaly:false,name:'non conservé',token:'ne-pas-transmettre'}))});
async function context(){const c=await archiveTestContext();c.db.exec(await readFile('drizzle/0006_young_marvel_zombies.sql','utf8'));return c;}
async function evidence(env){const url='https://controle.example/api/trpc/weather.getEvidenceStatus?input='+encodeURIComponent(JSON.stringify({json:coords}));return (await (await worker.fetch(new Request(url,{headers:{'oai-authenticated-user-id':'test'}}),env,{waitUntil(){}})).json()).result.data.json;}

test('réception serveur : conservation de zéro, anonymisation et suppression des champs libres',async()=>{
 const c=await context();try{
  const stored=await recordServerObservations(input(),c.env,now);assert.equal(stored.measurements,3);
  const text=[...c.objects.values()][0];assert(!text.includes('netatmo-serveur'));assert(!text.includes('token'));assert(!text.includes('non conservé'));
  const result=await readServerObservations(c.env,now);assert.equal(result.rows.length,3);assert.equal(result.rows[0].temperature,0);assert.equal(result.rows[0].receivedAt,now);assert.equal(result.status,'verified');assert.equal(result.rows[0].flags.length,0);
  assert.equal((await recordServerObservations(input(),c.env,now+60000)).duplicate,true);assert.equal(c.objects.size,1);
 }finally{c.db.close();}
});
test('aucun antidatage de cache, réception future, périmée, lieu différent ou mesure future',async()=>{
 const c=await context();try{
  await assert.rejects(recordServerObservations(input(now+10000),c.env,now));await assert.rejects(recordServerObservations(input(now-600001),c.env,now));
  assert.equal((await recordServerObservations({...input(),lat:48},c.env,now)).reason,'not_covered');
  const v=input();v.stations[0].time=now+1;v.stations[1].temp=99;v.stations[2].distance=51;
  assert.equal((await recordServerObservations(v,c.env,now)).reason,'no_usable_measurement');assert.equal(c.objects.size,0);
  await recordServerObservations(input(now-300000),c.env,now);const result=await readServerObservations(c.env,now);assert.equal(result.rows[0].receivedAt,now-300000);
 }finally{c.db.close();}
});
test('empreinte, index et panne SQL : aucune confirmation physique fabriquée',async()=>{
 const c=await context();try{
  await recordServerObservations(input(),c.env,now);const key=[...c.objects.keys()][0],text=c.objects.get(key);
  c.objects.set(key,text+' ');assert.equal((await readServerObservations(c.env,now)).rejectedArchives,1);assert.equal((await readServerObservations(c.env,now)).rows.length,0);
  c.objects.set(key,text);c.db.exec('UPDATE weather_server_observations SET measurement_count=4');assert.equal((await readServerObservations(c.env,now)).rows.length,0);
  c.db.exec('DROP TABLE weather_server_observations');await assert.rejects(readServerObservations(c.env,now));
 }finally{c.db.close();}
});
test('une mesure répétée conserve sa première réception ; les contradictions sont exclues',async()=>{
 const c=await context();try{
  const slot=Math.floor(now/HOUR)*HOUR-HOUR,at=slot+50*60000,v=input(at);v.stations.forEach(s=>s.time=slot+45*60000);
  await recordServerObservations(v,c.env,at);const second={...v,providerReceivedAt:at+15*60000};await recordServerObservations(second,c.env,at+15*60000);
  const first=await readServerObservations(c.env,now);assert.equal(first.rows.length,3);assert.equal(first.rows[0].receivedAt,at);
  const next={...v,providerReceivedAt:at+75*60000,stations:v.stations.map((s,i)=>({...s,temp:i===0?1:0}))};await recordServerObservations(next,c.env,at+75*60000);
  const changed=await readServerObservations(c.env,at+75*60000);assert.equal(changed.conflictingMeasurements,1);assert.equal(changed.rows.length,2);assert.equal(changed.status,'partial');
 }finally{c.db.close();}
});
test('relecture serveur et historique navigateur restent séparés, même avec 18 heures candidates',async()=>{
 const c=await context();try{
  const date=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Paris'}).format(now-48*HOUR),start=Date.parse(date+'T03:00:00Z');
  for(let h=0;h<18;h++)await recordServerObservations(input(start+h*HOUR+20*60000),c.env,start+h*HOUR+20*60000);
  await recordObservations({...coords,stations:[{id:'netatmo-ancien',temp:5,time:start,distance:3}]},c.env,start+60000);
  const report=await evidence(c.env);assert.equal(report.dailyCoverage.measurementsVerified,1);assert.equal(report.dailyCoverage.serverMeasurements.measurementsVerified,54);assert.equal(report.dailyCoverage.serverMeasurements.days[0].usableHours,18);assert.equal(report.isEligible,false);assert.equal(report.qualifiedScoreCount,null);assert(!JSON.stringify(report).includes('stationKey'));assert.equal(report.dailyCoverage.officialEvidence,'not_migrated');
 }finally{c.db.close();}
});
test('les lecteurs bornent à 48 lots et signalent une collecte de plus de 1 000 stations',async()=>{
 const c=await context();try{
  for(let h=0;h<49;h++)await recordServerObservations(input(now-h*HOUR),c.env,now-h*HOUR);
  let reads=0;const get=c.env.BUCKET.get;c.env.BUCKET.get=async k=>{reads++;return get(k);};
  const result=await readServerObservations(c.env,now);assert.equal(result.checkedArchives,48);assert.equal(reads,48);assert.equal(result.boundedRead,true);
  const other=await context();try{const v=input();v.stations=Array.from({length:1001},(_,i)=>({...v.stations[0],id:'netatmo-grande-zone-'+i}));await recordServerObservations(v,other.env,now);const limited=await readServerObservations(other.env,now);assert.equal(limited.rows.length,1000);assert.equal(limited.boundedRead,true);}finally{other.db.close();}
 }finally{c.db.close();}
});
test('route Netatmo : cache et callback interne conservent l’horodatage, sans nouvelle requête fournisseur',async()=>{
 const c=await context();try{
  const subject='test-source-serveur',owner=await digest(subject),secret=Buffer.alloc(32,7).toString('base64'),revision='test-revision';
  const vault=await seal({clientId:'identifiant-test',clientSecret:'secret-factice',revision,tokens:{access:'access-factice',refresh:'refresh-factice',expiresAt:now+HOUR}},secret,owner);
  c.objects.set('netatmo/vault/'+owner,vault);
  const at=Date.now()-1000,body=[0,1,2].map(i=>({_id:'exemple-'+i,place:{location:[2.5204+i*.001,50.7567]},measures:{exterior:{type:['temperature'],res:{[Math.floor((at-60000)/1000)]:[0]}}}}));
  c.objects.set('netatmo/cache-zones-v2/'+owner+'/'+stationZone(coords.lat,coords.lon,50).key,JSON.stringify({body,at,revision}));
  const get=c.env.BUCKET.get;c.env.BUCKET.get=async key=>{const obj=await get(key);if(!obj)return null;const text=c.objects.get(key);return {...obj,text:async()=>text,json:async()=>JSON.parse(text)};};
  let calls=0;c.env.NETATMO_ENCRYPTION_KEY=secret;c.env.archivePhysicalStations=value=>recordServerObservations(value,c.env);
  const request=new Request(SITE_ORIGIN+'/api/netatmo/stations?lat=50.7567&lon=2.5204&radiusKm=50',{headers:{'oai-authenticated-user-id':subject}});
  const response=await handleNetatmo(request,c.env,()=>{calls++;throw Error('Appel fournisseur interdit');});assert.equal(response.status,200);assert.equal((await response.json()).at,at);assert.equal(calls,0);assert.equal((await readServerObservations(c.env)).rows.length,3);
  c.env.archivePhysicalStations=async()=>{throw Error('Stockage indisponible');};assert.equal((await handleNetatmo(request,c.env)).status,200);
  // Le Worker de production injecte lui-même l'archivage, indépendamment d'un callback de test.
  c.db.exec('DELETE FROM weather_server_observations');
  const originalFetch=globalThis.fetch;globalThis.fetch=()=>{throw Error('Appel fournisseur supplémentaire interdit');};
  try{const integrated=await worker.fetch(request,c.env,{waitUntil(){}});assert.equal(integrated.status,200);assert.equal((await integrated.json()).cacheHit,true);assert.equal((await readServerObservations(c.env)).rows.length,3);}finally{globalThis.fetch=originalFetch;}
  assert.equal((await worker.fetch(new Request('https://controle.example/api/history/server-observations',{method:'POST',headers:{'oai-authenticated-user-id':subject},body:'{}'}),c.env,{waitUntil(){}})).status,404);
 }finally{c.db.close();}
});

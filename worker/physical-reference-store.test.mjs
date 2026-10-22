import {test} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {archiveTestContext,recordObservations} from './archive-test-context.mjs';
import worker from '../dist/server/index.js';
import {seal,digest,stationZone,SITE_ORIGIN} from './netatmo-api.mjs';
const bundle=await build({stdin:{contents:"export * from './worker/physical-reference-store'; export {recordServerObservations} from './worker/server-observations';",resolveDir:process.cwd()},bundle:true,format:'esm',platform:'node',write:false});
const {derivePhysicalReference,finalizePhysicalReferences,readPhysicalReferenceEvidence,recordServerObservations}=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));
const HOUR=3600000,coords={lat:50.7567,lon:2.5204},slot=Math.floor(Date.now()/HOUR)*HOUR-3*HOUR;
const input=(at=slot+20*60000,count=3)=>({...coords,radiusKm:50,providerReceivedAt:at,stations:Array.from({length:count},(_,i)=>({id:'netatmo-ref-'+i,temp:0,time:at-60000,distance:i+1,elevation:null,anomaly:false}))});
async function context(){const c=await archiveTestContext();for(const file of ['0006_young_marvel_zombies','0007_tense_thor'])c.db.exec(await readFile('drizzle/'+file+'.sql','utf8'));return c;}

test('référence créée uniquement après une heure terminée, puis reproduite sans écrire ni inventer de score',async()=>{
 const c=await context();try{
  await recordServerObservations(input(),c.env,slot+20*60000);
  assert.equal((await finalizePhysicalReferences(c.env,slot+40*60000)).stored,0);
  assert.equal((await finalizePhysicalReferences(c.env,slot+HOUR+60000)).stored,1);
  const size=c.objects.size,result=await readPhysicalReferenceEvidence(c.env,slot+2*HOUR);assert.equal(c.objects.size,size);assert.equal(result.referenceCount,1);assert.equal(result.days[0].coverageHours,1);assert.equal(result.calibration,'not_active');assert.equal(result.temperatureOnly,true);
  const row=c.db.prepare('SELECT * FROM weather_physical_references').get();assert.equal(row.temperature,0);assert.equal(row.station_count,3);
  const payload=JSON.parse(c.objects.get(row.object_key));assert(payload.firstMeasuredAt>slot);assert.equal(payload.snapshot.precipitation,null);assert.equal(payload.snapshot.windSpeed,null);assert.equal(payload.calibrationEligible,false);
  assert.equal((await finalizePhysicalReferences(c.env,slot+HOUR+120000)).stored,0);assert.equal(c.objects.size,size);assert(!JSON.stringify(result).includes('stationId'));assert(!JSON.stringify(result).includes('sourceIds'));
 }finally{c.db.close();}
});
test('reprend les lots réellement archivés après une interruption, sans changer leur réception',async()=>{
 const c=await context();try{
  await recordServerObservations(input(),c.env,slot+20*60000);
  const resumedAt=slot+6*HOUR;assert.equal((await finalizePhysicalReferences(c.env,resumedAt)).stored,1);
  const index=c.db.prepare('SELECT * FROM weather_physical_references').get(),payload=JSON.parse(c.objects.get(index.object_key));assert.equal(index.valid_at,slot);assert.equal(index.created_at,resumedAt);assert.equal(payload.snapshot.collectedAt,slot+20*60000);assert.equal((await readPhysicalReferenceEvidence(c.env,resumedAt)).referenceCount,1);
 }finally{c.db.close();}
});
test('reprise partagée du Site privé : archives seules, fournisseur indisponible et aucune identité fabriquée',async()=>{
 const c=await context(),oldNow=Date.now,oldFetch=globalThis.fetch;try{
  await recordServerObservations(input(),c.env,slot+20*60000);
  const now=slot+6*HOUR;Date.now=()=>now;globalThis.fetch=()=>{throw Error('Fournisseur indisponible');};
  const url='https://controle.example/api/control/finalize-physical-references';
  const request=(body='{}',headers={'Origin':'https://controle.example','Content-Type':'application/json'},method='POST')=>new Request(url,{method,headers,...(method==='POST'?{body}:{})});
  for(const [req,status] of [[request('{}',{},'GET'),405],[request('{}',{}),403],[request('{}',{'Origin':'https://autre.example','Content-Type':'application/json'}),403],[request('{'),400],[request('{"stations":[]}'),400],[request('[]'),400],[request('null'),400],[request('x'.repeat(33)),413]]){
   assert.equal((await worker.fetch(req,c.env,{})).status,status);
   assert.equal(c.db.prepare('SELECT COUNT(*) AS n FROM weather_physical_references').get().n,0);
  }
  // Le périmètre est partagé, autorisé par la plateforme privée ; aucun sujet utilisateur synthétique.
  const response=await worker.fetch(request(),c.env,{}),result=await response.json();
  assert.equal(response.status,200);assert.equal(result.stored,1);assert.equal(result.evidence.referenceCount,1);assert.equal(result.evidence.calibration,'not_active');
  assert(!JSON.stringify(result).includes('stationKey'));assert(!JSON.stringify(result).includes('sourceIds'));
  assert.equal((await (await worker.fetch(request(),c.env,{})).json()).stored,0);
  c.db.exec('DROP TABLE weather_physical_references');assert.equal((await worker.fetch(request(),c.env,{})).status,503);
 }finally{Date.now=oldNow;globalThis.fetch=oldFetch;c.db.close();}
});
test('contrôles spatiaux, alertes, heures futures et heures répétées restent éliminatoires',()=>{
 const rows=[0,1,2].map(i=>({stationKey:'station-'+i,measuredAt:slot+10*60000,receivedAt:slot+20*60000,temperature:0,distance:i+1,elevation:null,flags:[]}));
 assert.equal(derivePhysicalReference(rows,slot,slot+HOUR-1),null);assert.equal(derivePhysicalReference(rows.slice(0,2),slot,slot+HOUR),null);
 assert.equal(derivePhysicalReference(rows.map((r,i)=>({...r,distance:i===0?21:r.distance})),slot,slot+HOUR),null);
 assert.equal(derivePhysicalReference(rows.map((r,i)=>({...r,flags:i===0?['source_flagged']:[]})),slot,slot+HOUR),null);
 assert.equal(derivePhysicalReference(rows,NaN,slot+HOUR),null);
 for(const hour of ['2026-10-25T00:00:00Z','2026-10-25T01:00:00Z']){const at=Date.parse(hour);assert.equal(derivePhysicalReference(rows.map(r=>({...r,measuredAt:at+60000,receivedAt:at+120000})),at,at+HOUR),null);}
 assert.throws(()=>derivePhysicalReference([...rows,{...rows[0],temperature:1}],slot,slot+HOUR),/contradictoire/);
});
test('référence corrompue, index changé ou source perdue : aucune confirmation conservée',async()=>{
 const c=await context();try{
  await recordServerObservations(input(),c.env,slot+20*60000);await finalizePhysicalReferences(c.env,slot+HOUR+60000);
  const index=c.db.prepare('SELECT * FROM weather_physical_references').get(),text=c.objects.get(index.object_key);
  c.objects.set(index.object_key,text+' ');assert.equal((await readPhysicalReferenceEvidence(c.env,slot+2*HOUR)).referenceCount,0);
  c.objects.set(index.object_key,text);c.db.exec('UPDATE weather_physical_references SET temperature=1');assert.equal((await readPhysicalReferenceEvidence(c.env,slot+2*HOUR)).filesRejected,1);
  c.db.exec('UPDATE weather_physical_references SET temperature=0');const source=c.db.prepare('SELECT object_key FROM weather_server_observations').get();c.objects.delete(source.object_key);assert.equal((await readPhysicalReferenceEvidence(c.env,slot+2*HOUR)).filesRejected,1);
  c.db.exec('DROP TABLE weather_physical_references');await assert.rejects(readPhysicalReferenceEvidence(c.env,slot+2*HOUR));
 }finally{c.db.close();}
});
test('un poids ou une valeur modifiés restent rejetés même avec un nouvel hash cohérent dans l’index',async()=>{
 const c=await context();try{
  await recordServerObservations(input(),c.env,slot+20*60000);await finalizePhysicalReferences(c.env,slot+HOUR+60000);
  const index=c.db.prepare('SELECT * FROM weather_physical_references').get(),value=JSON.parse(c.objects.get(index.object_key));value.snapshot.stationsUsed[0].fieldWeights.temperature=1;
  const text=JSON.stringify(value),digest=createHash('sha256').update(text).digest('hex'),key='history/physical-references/'+digest+'.json';c.objects.set(key,text);c.db.prepare('UPDATE weather_physical_references SET object_key=?,digest=?').run(key,digest);
  const result=await readPhysicalReferenceEvidence(c.env,slot+2*HOUR);assert.equal(result.referenceCount,0);assert.equal(result.filesRejected,1);
 }finally{c.db.close();}
});
test('une archive navigateur ne produit aucune référence serveur',async()=>{
 const c=await context();try{
  await recordObservations({...coords,stations:input().stations},c.env,slot+20*60000);assert.equal((await finalizePhysicalReferences(c.env,slot+HOUR+60000)).stored,0);assert.equal((await readPhysicalReferenceEvidence(c.env,slot+2*HOUR)).status,'none');
  const response=await worker.fetch(new Request('https://controle.example/api/history/physical-references',{method:'POST',headers:{'oai-authenticated-user-id':'test'},body:'{}'}),c.env,{waitUntil(){}});assert.equal(response.status,404);
 }finally{c.db.close();}
});
test('18 références d’une journée terminée restent distinctes de scores et de calibration actifs',async()=>{
 const c=await context();try{
  const date=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Paris'}).format(Date.now()-48*HOUR),start=Date.parse(date+'T03:00:00Z');
  for(let h=0;h<18;h++){const at=start+h*HOUR+20*60000;await recordServerObservations(input(at),c.env,at);await finalizePhysicalReferences(c.env,start+(h+1)*HOUR+60000);}
  const result=await readPhysicalReferenceEvidence(c.env);assert.equal(result.referenceCount,18);assert.equal(result.days[0].closedDay,true);assert.equal(result.days[0].thresholdMet,true);
  const url='https://controle.example/api/trpc/weather.getEvidenceStatus?input='+encodeURIComponent(JSON.stringify({json:coords}));const response=await worker.fetch(new Request(url,{headers:{'oai-authenticated-user-id':'test'}}),c.env,{waitUntil(){}}),report=(await response.json()).result.data.json;
  assert.equal(report.dailyCoverage.serverReferences.referenceCount,18);assert.equal(report.qualifiedScoreCount,null);assert.equal(report.isEligible,false);assert.equal(report.dailyCoverage.calibration,'not_active');
 }finally{c.db.close();}
});
test('la lecture borne les références et réutilise la vérification des lots sources',async()=>{
 const c=await context();try{
  const start=slot-50*HOUR;for(let h=0;h<49;h++){const at=start+h*HOUR+20*60000;await recordServerObservations(input(at),c.env,at);await finalizePhysicalReferences(c.env,start+(h+1)*HOUR+60000);}
  let reads=0;const get=c.env.BUCKET.get;c.env.BUCKET.get=async key=>{reads++;return get(key);};
  const result=await readPhysicalReferenceEvidence(c.env,slot+HOUR);assert.equal(result.referenceCount,48);assert.equal(result.boundedRead,true);assert(reads<=100,'Les lots partagés doivent être vérifiés une seule fois');
 }finally{c.db.close();}
});
test('Worker complet : le cache Netatmo crée la référence sans nouvelle requête fournisseur',async()=>{
 const c=await context(),oldNow=Date.now,oldFetch=globalThis.fetch;try{
  const now=slot+HOUR+60000;Date.now=()=>now;globalThis.fetch=()=>{throw Error('Appel fournisseur interdit');};
  const subject='test-reference-worker',owner=await digest(subject),secret=Buffer.alloc(32,9).toString('base64'),revision='fixture-reference';
  c.env.NETATMO_ENCRYPTION_KEY=secret;c.objects.set('netatmo/vault/'+owner,await seal({clientId:'fixture-client',clientSecret:'fixture-secret',revision,tokens:{access:'fixture-access',refresh:'fixture-refresh',expiresAt:now+HOUR}},secret,owner));
  const body=[0,1,2].map(i=>({_id:'reference-'+i,place:{location:[2.5204+i*.001,50.7567]},measures:{outside:{type:['temperature'],res:{[Math.floor((now-120000)/1000)]:[0]}}}}));
  c.objects.set('netatmo/cache-zones-v2/'+owner+'/'+stationZone(coords.lat,coords.lon,50).key,JSON.stringify({body,at:now-1000,revision}));
  const get=c.env.BUCKET.get;c.env.BUCKET.get=async key=>{const object=await get(key);return object?{...object,text:async()=>c.objects.get(key),json:async()=>JSON.parse(c.objects.get(key))}:null;};
  const response=await worker.fetch(new Request(SITE_ORIGIN+'/api/netatmo/stations?lat=50.7567&lon=2.5204&radiusKm=50',{headers:{'oai-authenticated-user-id':subject}}),c.env,{waitUntil(){}});
  assert.equal(response.status,200);assert.equal((await response.json()).cacheHit,true);assert.equal((await readPhysicalReferenceEvidence(c.env,now)).referenceCount,1);
 }finally{Date.now=oldNow;globalThis.fetch=oldFetch;c.db.close();}
});

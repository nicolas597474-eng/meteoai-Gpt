import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {build} from 'esbuild';
import {resolve} from 'node:path';
import {archiveTestContext} from './archive-test-context.mjs';
// Toutes les journées ci-dessous sont des fixtures locales : aucun fournisseur ni Site publié n'est interrogé.
const bundle=await build({stdin:{contents:"export * from './worker/server-observations';export * from './worker/physical-reference-store';export * from './worker/learning-store';export * from './worker/learning-provider-runs';export * from './worker/reliability';",resolveDir:process.cwd()},bundle:true,format:'esm',platform:'node',write:false,plugins:[{name:'physical-kind',setup(b){b.onResolve({filter:/^\.\/stationService$/},a=>a.importer.endsWith('dailyForecastVerification.ts')?{path:resolve('worker/station-kind.ts')}:undefined);}}]});
const api=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));
const HOUR=3600000,DAY=24*HOUR,coords={lat:50.7567,lon:2.5204},now=Date.parse('2026-10-17T03:00:00Z');
async function context(){const c=await archiveTestContext();for(const file of ['0005_lush_micromax','0006_young_marvel_zombies','0007_tense_thor','0008_motionless_amphibian','0009_white_crusher_hogan'])c.db.exec(await readFile('drizzle/'+file+'.sql','utf8'));c.env.NETATMO_ENCRYPTION_KEY=Buffer.alloc(32,11).toString('base64');return c;}
const source=(at,humidity=70)=>({...coords,radiusKm:50,providerReceivedAt:at,stations:[0,1,2].map(i=>({id:'netatmo-humid-'+i,temp:0,humidity,time:at-60000,distance:i+1,elevation:null,anomaly:false}))});
async function seed(c,date){
 const day=Date.parse(date+'T00:00:00Z'),run=day-6*HOUR,available=run+5*HOUR+60000;
 const values=Array.from({length:18},(_,i)=>{const validTime=day+(i+1)*HOUR;const common={captureRunId:'AROME-'+run,locationKey:'50.757_2.520',targetDate:date,modelName:'AROME',modelId:'meteofrance_arome_france_hd',metadataAvailableAt:run+4*HOUR,providerRunAt:run,requestStartedAt:available-60000,availableAt:available,validTime,forecastLeadTimeMilliseconds:validTime-run,collectionLatencyMilliseconds:available-run};return [{...common,variable:'temperature',value:1,unit:'°C'},{...common,variable:'humidity',value:80,unit:'%'}];}).flat();
 await api.recordLearningProviderRun(values,c.env,available);
 await api.recordLearningForecast({...coords,capturedAt:day-DAY,days:[{date,forecasts:[{serviceName:'AROME',modelId:'meteofrance_arome_france_hd',tempMax:1,tempMin:1,requestStartedAt:day-DAY-100,availableAt:day-DAY}]}]},c.env,day-DAY);
 for(let h=1;h<=18;h++){const validAt=day+h*HOUR,at=validAt+20*60000;await api.recordServerObservations(source(at),c.env,at);await api.finalizePhysicalReferences(c.env,validAt+HOUR+60000);}
 await api.finalizeLearningDays(c.env,day+DAY+2*HOUR);
}

test('archives v2 : humidité zéro conservée ; données absentes ou invalides restent null',async()=>{
 for(const humidity of [0,100,null,undefined,-1,101,'70']){
  const c=await context();try{
   const at=Date.parse('2026-10-15T12:20:00Z'),input=source(at);input.stations.forEach(s=>s.humidity=humidity);await api.recordServerObservations(input,c.env,at);
   const read=await api.readServerObservations(c.env,at),expected=typeof humidity==='number'&&humidity>=0&&humidity<=100?humidity:null;
   assert.equal(read.rows[0].humidity,expected);assert.equal(read.rejectedArchives,0);
   const index=c.db.prepare('SELECT * FROM weather_server_observations').get();assert.equal(JSON.parse(c.objects.get(index.object_key)).version,3);
  }finally{c.db.close();}
 }
});

test('ancienne archive v1 : relecture et référence identiques sans ajout rétrospectif d’humidité',async()=>{
 const c=await context();try{
  const at=Date.parse('2026-10-15T12:20:00Z');await api.recordServerObservations(source(at),c.env,at);
  const index=c.db.prepare('SELECT * FROM weather_server_observations').get(),payload=JSON.parse(c.objects.get(index.object_key));
  payload.version=1;for(const row of payload.rows){delete row.humidity;delete row.auxiliary;}
  const text=JSON.stringify(payload),digest=createHash('sha256').update(text).digest('hex'),key='history/server-observations/'+digest+'.json';
  c.objects.set(key,text);c.db.prepare('UPDATE weather_server_observations SET object_key=?,digest=?').run(key,digest);
  const old=await api.readServerObservations(c.env,at);assert.equal(old.rejectedArchives,0);assert(!Object.hasOwn(old.rows[0],'humidity'));
  await api.finalizePhysicalReferences(c.env,at+HOUR);
  const reference=c.db.prepare('SELECT * FROM weather_physical_references').get();assert.equal(JSON.parse(c.objects.get(reference.object_key)).version,1);
  const evidence=await api.readPhysicalReferenceEvidence(c.env,at+HOUR);assert.equal(evidence.filesRejected,0);assert.equal(evidence.humidityReferenceCount,0);assert.equal(evidence.temperatureOnly,true);
 }finally{c.db.close();}
});

test('trois capteurs valides exigés pour l’humidité, sans supprimer une température qualifiée',async()=>{
 const slot=Date.parse('2026-10-15T12:00:00Z'),base=[0,1,2].map(i=>({stationKey:'station-'+i,measuredAt:slot+60000,receivedAt:slot+120000,temperature:0,humidity:70,distance:i+1,elevation:null,flags:[]}));
 assert(Math.abs(api.derivePhysicalReference(base,slot,slot+HOUR).snapshot.humidity-70)<1e-10);
 const fewer=api.derivePhysicalReference(base.map((r,i)=>({...r,humidity:i===0?null:70})),slot,slot+HOUR);
 assert.equal(fewer.snapshot.temperature,0);assert.equal(fewer.snapshot.humidity,null);assert.equal(fewer.snapshot.humidityStationCount,0);
 const saturated=api.derivePhysicalReference(base.map(r=>({...r,humidity:100})),slot,slot+HOUR);assert.equal(saturated.snapshot.humidity,100);
 const weights=saturated.snapshot.stationsUsed.reduce((sum,s)=>sum+s.fieldWeights.humidity,0);assert(Math.abs(weights-1)<1e-10);
});

test('humidité contradictoire : archive rejetée et aucune moyenne contradictoire',async()=>{
 const c=await context();try{
  const at=Date.parse('2026-10-15T12:20:00Z'),input=source(at);input.stations.push({...input.stations[0],humidity:80});
  await assert.rejects(api.recordServerObservations(input,c.env,at),/contradictoire/);assert.equal(c.objects.size,0);
 }finally{c.db.close();}
});

test('sept dates réelles : scores d’humidité qualifiés, unité %, seuils conservés et courbe de température inchangée',async()=>{
 const c=await context();try{
  for(let day=10;day<=16;day++)await seed(c,'2026-10-'+day);
  const result=await api.readReliability({...coords,period:'7d',horizon:'6-24h'},c.env,now);
  const humidity=result.metrics.find(m=>m.modelName==='AROME'&&m.variable==='humidity');
  assert.equal(result.evidence.filesRejected,0);assert.equal(humidity.status,'qualified');assert.equal(humidity.unit,'%');assert(Math.abs(humidity.metrics.mae-10)<1e-10);assert.equal(humidity.metrics.evaluatedDays,7);
  assert.equal(result.notes.hourly.mae,1);assert(result.comparisons.hourly.filter(p=>p.officialTemperature!==null).every(p=>p.officialTemperature===1&&p.stationTemperature===0));
  const single=await api.readReliability({...coords,period:'24h',horizon:'6-24h'},c.env,now);const raw=single.metrics.find(m=>m.modelName==='AROME'&&m.variable==='humidity');
  assert.equal(raw.status,'insufficient_evidence');assert.equal(raw.metrics,null);assert(Math.abs(raw.rawMetrics.mae-10)<1e-10);
 }finally{c.db.close();}
});

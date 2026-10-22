import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {build} from 'esbuild';
import {resolve} from 'node:path';
import {archiveTestContext} from './archive-test-context.mjs';
const bundle=await build({stdin:{contents:"export * from './worker/server-observations';export * from './worker/physical-reference-store';export * from './worker/learning-store';export * from './worker/learning-provider-runs';export * from './worker/reliability';export * from './shared/qualifiedLearning';export * from './worker/auxiliary-learning';",resolveDir:process.cwd()},bundle:true,format:'esm',platform:'node',write:false,plugins:[{name:'physical-kind',setup(b){b.onResolve({filter:/^\.\/stationService$/},a=>a.importer.endsWith('dailyForecastVerification.ts')?{path:resolve('worker/station-kind.ts')}:undefined);}}]});
const api=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));
const HOUR=3600000,DAY=24*HOUR,coords={lat:50.7567,lon:2.5204},slot=Date.parse('2026-10-15T12:00:00Z');
async function context(){const c=await archiveTestContext();for(const file of ['0005_lush_micromax','0006_young_marvel_zombies','0007_tense_thor','0008_motionless_amphibian','0009_white_crusher_hogan'])c.db.exec(await readFile('drizzle/'+file+'.sql','utf8'));c.env.NETATMO_ENCRYPTION_KEY=Buffer.alloc(32,11).toString('base64');return c;}
const auxiliary=at=>({pressure:{value:1007,measuredAt:at+120000,basis:'mean_sea_level',periodMinutes:null},windSpeed:{value:15,measuredAt:at,basis:'sensor_height_and_averaging_unspecified',periodMinutes:null},windGust:{value:24,measuredAt:at,basis:'maximum_window_and_height_unspecified',periodMinutes:null},precipitation:{value:0,measuredAt:at,basis:'rolling_liquid_rain',periodMinutes:60}});
const rows=at=>[0,1,2].map(i=>({stationKey:'station-'+i,measuredAt:at+120000,receivedAt:at+7*60000,temperature:0,humidity:70,distance:i+1,elevation:null,flags:[],auxiliary:auxiliary(at)}));
const snapshot=at=>api.derivePhysicalReference(rows(at),at,at+HOUR+60000).snapshot;
function values(at=slot){const run=at-8*HOUR,available=at-2*HOUR,common={captureRunId:'AROME-'+run,locationKey:'50.757_2.520',targetDate:new Date(at+2*HOUR).toISOString().slice(0,10),modelName:'AROME',modelId:'meteofrance_arome_france_hd',metadataAvailableAt:run+4*HOUR,providerRunAt:run,requestStartedAt:available-60000,availableAt:available,validTime:at,forecastLeadTimeMilliseconds:at-run,collectionLatencyMilliseconds:available-run};return [['temperature',1,'°C'],['humidity',80,'%'],['pressure',900,'hPa'],['pressure_msl',1009,'hPa'],['precipitation',0,'mm'],['rain',0,'mm'],['showers',0,'mm'],['snowfall',0,'cm'],['wind_speed',25,'km/h'],['wind_gust',40,'km/h']].map(([variable,value,unit])=>({...common,variable,value,unit}));}
const score=(s=snapshot(slot),v=values())=>api.buildProviderLearningScores([s],v,slot+2*HOUR);

test('références séparées : trois capteurs, pression MSL alignée, pluie horaire zéro, vent non qualifié',()=>{
 const s=snapshot(slot),r=s.auxiliaryReferences;
 assert(Math.abs(r.pressure.scoreValue-1007)<1e-9);assert.equal(r.pressure.scoreEligible,true);assert.equal(r.precipitation.scoreValue,0);assert.equal(r.precipitation.windowStartAt,slot-HOUR);assert.equal(r.windSpeed.scoreEligible,false);assert.equal(r.windGust.reason,'gust_height_and_window_unknown');assert.equal(s.pressure,undefined);assert.equal(s.precipitation,null);
 for(const [field,change] of [['pressure',p=>p.measuredAt=slot+6*60000],['precipitation',p=>p.measuredAt=slot+60000]]){
  const input=rows(slot);input.forEach(r=>change(r.auxiliary[field]));assert.equal(api.derivePhysicalReference(input,slot,slot+HOUR).snapshot.auxiliaryReferences[field].scoreEligible,false);
 }
 const fewer=rows(slot);delete fewer[0].auxiliary.pressure;assert.equal(api.derivePhysicalReference(fewer,slot,slot+HOUR).snapshot.auxiliaryReferences.pressure.scoreEligible,false);
 const outlier=rows(slot);outlier[0].auxiliary.pressure.value=1020;assert.equal(api.derivePhysicalReference(outlier,slot,slot+HOUR).snapshot.auxiliaryReferences.pressure.scoreEligible,false);
});

test('scores distincts et reproductibles : MSL ne reçoit jamais la pression de surface ; pluie zéro conservée',()=>{
 const result=score();assert.deepEqual(result.comparisons.map(c=>c.variable).sort(),['humidity','pressure_msl','rain_liquid_1h','temperature']);
 const p=result.comparisons.find(c=>c.variable==='pressure_msl');assert.equal(p.forecastValue,1009);assert(Math.abs(p.observedValue-1007)<1e-9);assert(Math.abs(result.scores.find(c=>c.variable==='pressure_msl').mae-2)<1e-9);
 assert.equal(result.comparisons.find(c=>c.variable==='rain_liquid_1h').forecastValue,0);assert.equal(result.scores.find(c=>c.variable==='temperature').mae,1);assert(Math.abs(result.scores.find(c=>c.variable==='humidity').mae-10)<1e-9);
 api.verifyProviderLearningScores(result,'2026-10-15',slot+2*HOUR);
 for(const mutate of [p=>p.basis='surface',p=>p.unit='Pa',p=>p.windowStartAt=slot-HOUR+1,p=>p.oldestAt=slot+60000]){
  const changed=structuredClone(result),row=changed.comparisons.find(c=>c.variable==='rain_liquid_1h');mutate(row.physicalReference);assert.throws(()=>api.verifyProviderLearningScores(changed,'2026-10-15',slot+2*HOUR),/admissible/);
 }
});

test('pluie : absence de composante, neige, somme incompatible ou réception pendant la fenêtre empêchent le score',()=>{
 for(const mutate of [v=>v.filter(r=>r.variable!=='showers'),v=>v.map(r=>r.variable==='showers'?{...r,value:null}:r),v=>v.map(r=>r.variable==='snowfall'?{...r,value:1}:r),v=>v.map(r=>r.variable==='precipitation'?{...r,value:2}:r),v=>v.map(r=>({...r,availableAt:slot-HOUR+1,requestStartedAt:slot-HOUR,collectionLatencyMilliseconds:slot-HOUR+1-r.providerRunAt}))])assert(!score(snapshot(slot),mutate(values())).comparisons.some(r=>r.variable==='rain_liquid_1h'));
 const v=values().map(r=>({...r,availableAt:slot-1,requestStartedAt:slot-60001,collectionLatencyMilliseconds:slot-1-r.providerRunAt})),s=snapshot(slot);s.auxiliaryReferences.pressure.contributors.forEach(r=>r.measuredAt=slot-60000);
 assert(!score(s,v).comparisons.some(r=>r.variable==='pressure_msl'));
 const duplicated=values();duplicated.push({...duplicated.find(r=>r.variable==='rain'),value:1});assert(!score(snapshot(slot),duplicated).comparisons.some(r=>r.variable==='rain_liquid_1h'));
});

async function capture(c,at){const received=at+7*60000;return api.recordServerObservations({...coords,radiusKm:50,providerReceivedAt:received,stations:[0,1,2].map(i=>({id:'netatmo-aux-'+i,temp:0,humidity:70,time:at+120000,distance:i+1,elevation:null,anomaly:false,pressure:1007,windSpeed:15,windGust:24,precipitation:0,precipitationPeriodMinutes:60,measurementTimes:{pressure:at+120000,windSpeed:at,windGust:at,precipitation:at}}))},c.env,received);}

test('archives : nouveaux champs signés admis, ancienne référence v2 sur lot v3 inchangée',async()=>{
 const c=await context();try{
  await api.recordLearningProviderRun(values(),c.env,slot-2*HOUR);const signed=c.db.prepare('SELECT * FROM weather_learning_provider_runs').get();assert.equal(JSON.parse(c.objects.get(signed.object_key)).payload.values.length,10);
  await capture(c,slot);const source=c.db.prepare('SELECT * FROM weather_server_observations').get(),raw=await api.readServerObservations(c.env,slot+HOUR),createdAt=slot+HOUR+60000;
  const derived=api.derivePhysicalReference(raw.rows,slot,createdAt,false),payload={version:2,kind:'hourly_physical_reference',method:'original_spatial_20km_3stations_v1',source:'netatmo_server',location:'50.757_2.520',validAt:slot,createdAt,sourceIds:[source.id],...derived,calibrationEligible:false};
  const text=JSON.stringify(payload),digest=createHash('sha256').update(text).digest('hex'),key='history/physical-references/'+digest+'.json';c.objects.set(key,text);
  c.db.prepare('INSERT INTO weather_physical_references(id,location_key,valid_at,created_at,station_count,temperature,object_key,digest) VALUES (?,?,?,?,?,?,?,?)').run('50.757_2.520/'+slot,'50.757_2.520',slot,createdAt,derived.snapshot.stationCount,derived.snapshot.temperature,key,digest);
  const old=await api.readPhysicalReferenceEvidence(c.env,createdAt);assert.equal(old.filesRejected,0);assert.equal(old.referenceCount,1);assert.equal(old.auxiliaryReferenceCounts.pressure,0);assert.equal(c.objects.get(key),text);
 }finally{c.db.close();}
});

test('sept journées : pression et pluie qualifiées dans Fiabilité, aucune calibration de surface ou toutes phases',async()=>{
 const c=await context();try{
  for(let d=10;d<=16;d++){
   const date='2026-10-'+d,day=Date.parse(date+'T00:00:00Z'),run=day-6*HOUR,available=day-HOUR+60000;
   const forecasts=Array.from({length:18},(_,i)=>values(day+(i+1)*HOUR).map(r=>({...r,captureRunId:'AROME-'+run,providerRunAt:run,metadataAvailableAt:run+4*HOUR,requestStartedAt:available-60000,availableAt:available,forecastLeadTimeMilliseconds:r.validTime-run,collectionLatencyMilliseconds:available-run}))).flat();
   await api.recordLearningProviderRun(forecasts,c.env,available);
   for(let h=1;h<=18;h++){const at=day+h*HOUR;await capture(c,at);await api.finalizePhysicalReferences(c.env,at+HOUR+60000);}
   const finished=await api.finalizeLearningDays(c.env,day+DAY+2*HOUR);assert.equal(finished.rejected,0);assert.equal(finished.stored,1);
  }
  const now=Date.parse('2026-10-17T03:00:00Z'),result=await api.readReliability({...coords,period:'7d',horizon:'6-24h'},c.env,now);
  assert.equal(result.evidence.filesRejected,0);
  for(const [variable,unit,mae] of [['pressure_msl','hPa',2],['rain_liquid_1h','mm',0]]){const m=result.metrics.find(m=>m.modelName==='AROME'&&m.variable===variable);assert.equal(m.status,'qualified');assert.equal(m.unit,unit);assert(Math.abs(m.metrics.mae-mae)<1e-8);assert.equal(m.metrics.evaluatedDays,7);}
  assert.equal(result.notes.hourly.mae,1);assert(result.metrics.filter(m=>['wind_speed','wind_gust'].includes(m.variable)).every(m=>m.status==='no_evidence'));
  const history=await api.readLearningHistory(c.env,now);assert.equal(history.filesRejected,0);assert.equal(api.countQualifiedHourlyGroups(history.hourlyScores.filter(r=>['pressure_msl','rain_liquid_1h'].includes(r.variable)),'2026-10-17'),0);
  const single=await api.readReliability({...coords,period:'24h',horizon:'6-24h'},c.env,now);assert.equal(single.metrics.find(m=>m.modelName==='AROME'&&m.variable==='pressure_msl').status,'insufficient_evidence');
  for(const [key,text] of c.objects)if(key.startsWith('learning/days/')){assert(text.length<3000000);assert(!text.includes('"contributors"'));}
 }finally{c.db.close();}
});

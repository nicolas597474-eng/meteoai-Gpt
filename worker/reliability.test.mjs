import {test} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {archiveTestContext} from './archive-test-context.mjs';
import worker from '../dist/server/index.js';
const bundle=await build({stdin:{contents:"export * from './worker/reliability';export * from './worker/learning-store';export {recordFusionSnapshot} from './worker/fusion-snapshots';export {readFusionVerificationStatus} from './worker/fusion-verification';export {recordLearningProviderRun} from './worker/learning-provider-runs';export {recordServerObservations} from './worker/server-observations';export {finalizePhysicalReferences} from './worker/physical-reference-store';",resolveDir:process.cwd()},bundle:true,platform:'node',format:'esm',write:false,plugins:[{name:'station-kind',setup(b){b.onResolve({filter:/^\.\/stationService$/},a=>a.importer.endsWith('dailyForecastVerification.ts')?{path:resolve('worker/station-kind.ts')}:undefined);}}]});
await writeFile('qa/reliability-test-bundle.mjs',bundle.outputFiles[0].text);
const api=await import(pathToFileURL(resolve('qa/reliability-test-bundle.mjs')).href);
const HOUR=3600000,DAY=24*HOUR,coords={lat:50.7567,lon:2.5204},now=Date.parse('2026-10-17T03:00:00Z');
async function context(){const c=await archiveTestContext();for(const tag of ['0003_glamorous_silvermane','0005_lush_micromax','0006_young_marvel_zombies','0007_tense_thor','0008_motionless_amphibian','0009_white_crusher_hogan','0010_black_roughhouse'])c.db.exec(await readFile('drizzle/'+tag+'.sql','utf8'));c.env.NETATMO_ENCRYPTION_KEY=Buffer.alloc(32,11).toString('base64');return c;}
async function seed(c,date){
 const day=Date.parse(date+'T00:00:00Z'),run=day-6*HOUR,available=run+5*HOUR+60000;
 const values=Array.from({length:18},(_,i)=>{const validTime=day+(i+1)*HOUR;return {captureRunId:'AROME-'+run,locationKey:'50.757_2.520',targetDate:date,modelName:'AROME',modelId:'meteofrance_arome_france_hd',metadataAvailableAt:run+4*HOUR,providerRunAt:run,requestStartedAt:available-60000,availableAt:available,validTime,forecastLeadTimeMilliseconds:validTime-run,collectionLatencyMilliseconds:available-run,variable:'temperature',value:1,unit:'°C'};});
 await api.recordLearningProviderRun(values,c.env,available);
 await api.recordLearningForecast({...coords,capturedAt:day-DAY,days:[{date,forecasts:[{serviceName:'AROME',modelId:'meteofrance_arome_france_hd',tempMax:1,tempMin:1,requestStartedAt:day-DAY-100,availableAt:day-DAY}]}]},c.env,day-DAY);
 for(let h=1;h<=18;h++){const validAt=day+h*HOUR,at=validAt+20*60000;await api.recordServerObservations({...coords,radiusKm:50,providerReceivedAt:at,stations:[0,1,2].map(i=>({id:'netatmo-qa-physical-'+i,temp:0,time:at-60000,distance:i+1,elevation:null,anomaly:false}))},c.env,at);await api.finalizePhysicalReferences(c.env,validAt+HOUR+60000);}
 await api.finalizeLearningDays(c.env,day+DAY+2*HOUR);
}
test('bornes exactes sans bucket voisin ni chevauchement',()=>{
 for(const h of api.RELIABILITY_HORIZONS){assert(api.matchesReliabilityHorizon(h.min*HOUR,h));assert(!api.matchesReliabilityHorizon(h.min*HOUR-1,h));assert.equal(api.matchesReliabilityHorizon(h.max*HOUR,h),h.max===360);}
 assert.equal(api.RELIABILITY_HORIZONS.find(h=>h.id==='6-24h').storageBucket,'6_24h');
});
test('archives vides lisibles, panne, autre lieu et paramètres invalides restent distincts',async()=>{
 const c=await context();try{
  const empty=await api.readReliability(coords,c.env,now);assert.equal(empty.evidence.status,'available');assert.equal(empty.metrics.length,42);assert(empty.metrics.every(m=>m.status==='no_evidence'&&m.metrics===null));assert.equal(empty.notes.hourly.mae,null);
  const failed=await api.readReliability(coords,{DB:{prepare(){throw Error('SQL private');}},NETATMO_ENCRYPTION_KEY:c.env.NETATMO_ENCRYPTION_KEY},now);assert.equal(failed.evidence.status,'history_unavailable');assert(!JSON.stringify(failed).includes('SQL private'));
  const other=await api.readReliability({lat:48.8,lon:2.3},c.env,now);assert.equal(other.evidence.status,'history_unavailable');assert.notEqual(other.locationKey,empty.locationKey);
  await assert.rejects(api.readReliability({...coords,period:'2d'},c.env,now));await assert.rejects(api.readReliability({...coords,horizon:'bad'},c.env,now));
 }finally{c.db.close();}
});

test('lectures simultanées : panne partagée sans fuite technique, puis reprise immédiate',async()=>{
 const c=await context();try{
  const originalPrepare=c.env.DB.prepare.bind(c.env.DB);let failed=true,attempts=0;
  c.env.DB.prepare=(...args)=>{attempts++;if(failed)throw Error('SQL confidentiel de fixture');return originalPrepare(...args);};
  const results=await Promise.all([
   api.readReliability({...coords,period:'7d'},c.env,now),
   api.readReliability({...coords,period:'365d'},c.env,now),
   api.readReliabilityYesterday(coords,c.env,now),
  ]);
  assert.equal(attempts,6,'Fenêtres distinctes et reprise immédiate du lecteur MeteoAI après chaque panne');
  assert(results.slice(0,2).every(r=>r.evidence.status==='history_unavailable'));
  assert.equal(results[2].status,'unavailable');
  assert(!JSON.stringify(results).includes('SQL confidentiel'));
  failed=false;
  const recovered=await api.readReliability(coords,c.env,now+1);
  assert.equal(recovered.evidence.status,'available','La panne ne reste pas en cache cinq minutes');
  assert(attempts>1);
 }finally{c.db.close();}
});

test('lectures simultanées réussies : cache commun et périodes indépendantes',async()=>{
 const c=await context();try{
  const originalPrepare=c.env.DB.prepare.bind(c.env.DB);let attempts=0;
  c.env.DB.prepare=(...args)=>{attempts++;return originalPrepare(...args);};
  const [week,year,yesterday]=await Promise.all([
   api.readReliability({...coords,period:'7d'},c.env,now),
   api.readReliability({...coords,period:'365d'},c.env,now),
   api.readReliabilityYesterday(coords,c.env,now),
  ]);
  assert.equal(attempts,6,'Quatre fenêtres, traces de fusion et contrôle de l’index MeteoAI');
  assert.equal(week.evidence.status,'available');assert.equal(year.evidence.status,'available');
  assert.equal(week.comparisons.daily.length,7);assert.equal(year.comparisons.daily.length,365);
  assert.equal(yesterday.validDate,'2026-10-16');
  await api.readReliability(coords,c.env,now+1);assert.equal(attempts,6,'Les fenêtres, la tendance et le lecteur MeteoAI restent en cache');
 }finally{c.db.close();}
});

test('fichier rejeté hors période : la semaine reste qualifiée et seule la tendance concernée est suspendue',async()=>{
 const c=await context();try{
  for(let day=10;day<=16;day++)await seed(c,'2026-10-'+day);
  const key='learning/days/'+'a'.repeat(64)+'.json';c.objects.set(key,'corrupt fixture');
  c.db.prepare('INSERT INTO weather_learning_days(id,location_key,valid_date,created_at,source_digest,coverage_hours,score_count,object_key,digest) VALUES (?,?,?,?,?,?,?,?,?)').run('50.757_2.520/2026-09-01','50.757_2.520','2026-09-01',now-1000,'b'.repeat(64),18,1,key,'a'.repeat(64));
  const week=await api.readReliability({...coords,period:'7d'},c.env,now),temp=week.metrics.find(r=>r.modelName==='AROME'&&r.variable==='temperature');
  assert.equal(temp.status,'qualified');assert.equal(temp.metrics.evaluatedDays,7);assert.equal(week.notes.hourly.mae,1);assert.equal(week.notes.complete,true);
  assert.equal(week.evidence.filesChecked,7);assert.equal(week.evidence.filesRejected,0);
  assert.equal(week.trendEvidence.complete,false);assert.equal(week.trendEvidence.filesRejected,1);assert.equal(temp.trend.delta,null);assert.match(temp.trend.reason,/fenêtres de tendance/);
  const year=await api.readReliability({...coords,period:'365d'},c.env,now);
  assert.equal(year.evidence.filesRejected,1);assert.equal(year.notes.complete,false);assert.equal(year.notes.hourly.mae,null);
  assert.equal(year.metrics.find(r=>r.modelName==='AROME'&&r.variable==='temperature').metrics,null,'Le rejet à l’intérieur de la sélection reste bloquant');
 }finally{c.db.close();}
});

test('bornes continues : chaque demi-heure jusqu’à quinze jours correspond exactement à une fenêtre',()=>{
 for(let milliseconds=0;milliseconds<=360*HOUR;milliseconds+=HOUR/2){
  assert.equal(api.RELIABILITY_HORIZONS.filter(h=>api.matchesReliabilityHorizon(milliseconds,h)).length,1,'Couverture unique à '+milliseconds);
 }
 for(const h of api.RELIABILITY_HORIZONS.slice(0,-1)){
  assert.equal(api.RELIABILITY_HORIZONS.filter(w=>api.matchesReliabilityHorizon(h.max*HOUR-1,w)).length,1);
  assert.equal(api.RELIABILITY_HORIZONS.filter(w=>api.matchesReliabilityHorizon(h.max*HOUR,w)).length,1);
 }
 for(const value of [-1,360*HOUR+1,NaN,Infinity])assert.equal(api.RELIABILITY_HORIZONS.some(h=>api.matchesReliabilityHorizon(value,h)),false);
 for(const value of [84,180,252])assert.equal(api.RELIABILITY_HORIZONS.filter(h=>api.matchesReliabilityHorizon(value*HOUR,h)).length,1);
});

test('lecture de tendance partielle : une période courte vérifiée conserve sa qualification',()=>{
 const days=Array.from({length:7},(_,i)=>({date:'2026-10-'+(10+i),scores:[{date:'2026-10-'+(10+i),sourceName:'open-meteo',modelName:'AROME',modelId:'meteofrance_arome_france_hd',variable:'temperature',horizonBucket:'6-24h',sampleSize:5,mae:1,rmse:1,bias:0,computedAt:now-1}],dailyScores:[],hourly:{'6-24h':[]},daily:{},yesterday:null}));
 const base={available:true,days,filesRejected:0,boundedRead:false,filesChecked:7,today:'2026-10-17'};
 for(const trend of [{...base,boundedRead:true},{...base,available:false},{...base,filesRejected:1}]){
  const result=api.buildReliabilityReadModel({period:'7d',horizon:'6-24h'},base,now,trend);
  assert.equal(result.notes.complete,true);assert.equal(result.notes.hourly.mae,1);assert.equal(result.metrics[0].status,'qualified');assert.equal(result.trendEvidence.complete,false);assert.equal(result.metrics[0].trend.delta,null);
 }
});

test('fusion : recherche effective des traces, cache commun et absence distincte d’un diagnostic non admissible',async()=>{
 const c=await context();try{
  const missing=await api.readFusionVerificationStatus('2026-10-15',c.env,now);assert.equal(missing.reasonCode,'no_verified_trace');assert.equal(missing.diagnostic.traceFound,false);
  const at=Date.parse('2026-10-16T12:00:00Z'),sources=[{name:'AROME',finalWeight:1}];
  await api.recordFusionSnapshot({...coords,date:'2026-10-16',computedAt:new Date(at).toISOString(),values:{tempMax:12,tempMin:6,precipitation:1,windSpeed:10},trace:{parameterSources:{tempMax:sources,precipitation:sources,windSpeed:sources}}},c.env,at);
  const changes=c.db.prepare('SELECT total_changes() AS n').get().n;
  const originalPrepare=c.env.DB.prepare.bind(c.env.DB);let reads=0;
  c.env.DB.prepare=(...args)=>{reads++;return originalPrepare(...args);};
  const [a,b]=await Promise.all([api.readFusionVerificationStatus('2026-10-16',c.env,now),api.readFusionVerificationStatus('2026-10-16',c.env,now)]);
  assert.equal(reads,1);assert.equal(a,b);assert.equal(a.status,'unavailable');assert.equal(a.reasonCode,'diagnostic_trace_only');assert.equal(a.diagnostic.traceFound,true);assert.equal(a.pairCount,null);assert.deepEqual(a.groups,[]);assert.match(a.reason,/non qualifié/);
  const yesterday=await api.readReliabilityYesterday(coords,c.env,now);assert.equal(yesterday.meteoai.reasonCode,'diagnostic_trace_only');
  assert.equal(c.db.prepare('SELECT total_changes() AS n').get().n,changes);
  assert(!JSON.stringify(yesterday.meteoai).includes('signature'));assert(!JSON.stringify(yesterday.meteoai).includes('finalWeight'));
 }finally{c.db.close();}
});

test('fusion : rejet d’intégrité et panne ne prétendent pas établir une absence de trace',async()=>{
 const c=await context();try{
  const at=Date.parse('2026-10-16T12:00:00Z'),sources=[{name:'AROME',finalWeight:1}];
  await api.recordFusionSnapshot({...coords,date:'2026-10-16',computedAt:new Date(at).toISOString(),values:{tempMax:12},trace:{parameterSources:{tempMax:sources,precipitation:[],windSpeed:[]}}},c.env,at);
  const row=c.db.prepare('SELECT object_key FROM weather_fusion_snapshots').get(),body=c.objects.get(row.object_key);c.objects.set(row.object_key,body+' ');
  const rejected=await api.readFusionVerificationStatus('2026-10-16',c.env,now);assert.equal(rejected.reasonCode,'trace_integrity_error');assert.equal(rejected.diagnostic.filesRejected,1);
  c.objects.set(row.object_key,body);assert.equal((await api.readFusionVerificationStatus('2026-10-16',c.env,now+1)).reasonCode,'diagnostic_trace_only');
  const env={DB:{prepare(){throw Error('private fixture database message');}}};
  const failed=await api.readFusionVerificationStatus('2026-10-16',env,now);assert.equal(failed.reasonCode,'history_unavailable');assert(!JSON.stringify(failed).includes('private fixture'));
 }finally{c.db.close();}
});
test('vrais fichiers signés : 7 dates, filtres exacts, qualification, graphiques et absence d’écritures',async()=>{
 const c=await context();try{
  for(let day=10;day<=16;day++)await seed(c,'2026-10-'+day);
  const before=c.objects.size,changes=c.db.prepare('SELECT total_changes() AS n').get().n;
  const full=await api.readReliability({...coords,period:'7d',horizon:'6-24h'},c.env,now);
  assert.equal(full.period.startDate,'2026-10-10');assert.equal(full.period.endDate,'2026-10-16');
  const temp=full.metrics.find(m=>m.modelName==='AROME'&&m.variable==='temperature');assert.equal(temp.status,'qualified');assert.equal(temp.metrics.mae,1);assert.equal(temp.metrics.evaluatedDays,7);assert(temp.metrics.comparisonCount>=30);assert.equal(full.notes.hourly.mae,1);
  assert.equal(full.metrics.find(m=>m.variable==='rain_liquid_1h').metrics,null);assert.equal(full.notes.daily.mae,null);
  assert.equal(full.comparisons.daily.length,7);assert.equal(full.comparisons.hourly.length,48);assert(full.comparisons.hourly.filter(p=>p.stationTemperature!==null).every(p=>p.stationTemperature===0&&p.officialTemperature===1));assert(full.comparisons.hourly.some(p=>p.stationTemperature===null&&p.officialTemperature===null),'Les heures absentes restent des lacunes');
  const one=await api.readReliability({...coords,period:'24h',horizon:'6-24h'},c.env,now);assert.equal(one.comparisons.daily.length,1);assert.equal(one.notes.hourly.mae,null);assert(one.metrics.some(m=>m.status==='insufficient_evidence'));
  const different=await api.readReliability({...coords,period:'7d',horizon:'24-48h'},c.env,now);assert.equal(different.notes.hourly.mae,null);assert.equal(different.comparisons.hourly.filter(p=>p.officialTemperature!==null).length,2);assert.equal(different.notes.daily.mae,null,'7 dates ne représentent pas 30 comparaisons quotidiennes par cellule');
  const yesterday=await api.readReliabilityYesterday(coords,c.env,now);assert.equal(yesterday.status,'available');assert.equal(yesterday.pairs.length,2);assert.equal(yesterday.groups.length,2);assert(yesterday.pairs.every(p=>p.forecastAvailableAt<p.observationWindowStartAt));assert.equal(yesterday.meteoai.status,'unavailable');
  const response=await worker.fetch(new Request('https://test.example/api/trpc/weather.getReliabilityLaboratory?input='+encodeURIComponent(JSON.stringify({json:{...coords,period:'365d',horizon:'6-24h'}}))),c.env,{waitUntil(){throw Error('Aucune collecte');}});
  const live=(await response.json()).result.data.json;assert.equal(response.status,200);assert.equal(live.evidence.source,'signed_learning_days');assert(live.metrics.some(m=>m.status==='qualified'));assert.equal(live.evidence.minimumComparisons,30);
  assert.equal(c.objects.size,before);assert.equal(c.db.prepare('SELECT total_changes() AS n').get().n,changes);
  assert(!JSON.stringify(full).includes('stationEvidence'));assert(!JSON.stringify(full).includes('signature'));
 }finally{c.db.close();}
});
test('archive altérée : pas de note qualifiée et reprise de lecture sans cache du rejet',async()=>{
 const c=await context();try{
  await seed(c,'2026-10-16');const index=c.db.prepare('SELECT object_key FROM weather_learning_days').get(),original=c.objects.get(index.object_key);c.objects.set(index.object_key,original+' ');
  const rejected=await api.readReliability(coords,c.env,now);assert.equal(rejected.evidence.filesRejected,1);assert.equal(rejected.notes.complete,false);assert.equal(rejected.notes.hourly.mae,null);
  c.objects.set(index.object_key,original);const repaired=await api.readReliability(coords,c.env,now+1);assert.equal(repaired.evidence.filesRejected,0);assert(repaired.metrics.some(m=>m.rawMetrics));
 }finally{c.db.close();}
});

test('lecture partielle : une tendance par ailleurs qualifiée ne publie aucun delta',()=>{
 const dates=[...Array.from({length:7},(_,i)=>'2026-09-0'+(i+1)),...Array.from({length:7},(_,i)=>'2026-10-0'+(i+1))];
 const days=dates.map(date=>({date,scores:[{date,sourceName:'open-meteo',modelName:'AROME',modelId:'meteofrance_arome_france_hd',variable:'temperature',horizonBucket:'6-24h',sampleSize:5,mae:date.includes('-09-')?2:1,rmse:date.includes('-09-')?2:1,bias:0,computedAt:now-1}],dailyScores:[],hourly:{'6-24h':[]},daily:{},yesterday:null}));
 const base={available:true,days,filesRejected:0,boundedRead:false,filesChecked:14,today:'2026-10-17'};
 const row=a=>api.buildReliabilityReadModel({period:'30d',horizon:'6-24h'},a,now).metrics.find(m=>m.modelName==='AROME'&&m.variable==='temperature');
 assert.equal(row(base).trend.status,'qualified');assert.equal(row(base).trend.delta.mae,-1);
 for(const partial of [{...base,filesRejected:1},{...base,boundedRead:true},{...base,available:false}]){
  const result=row(partial);assert.notEqual(result.trend.status,'qualified');assert.equal(result.trend.delta,null);assert.equal(result.metrics,null);
 }
});

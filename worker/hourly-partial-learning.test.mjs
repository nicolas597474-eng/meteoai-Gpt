import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {build} from 'esbuild';
import {resolve} from 'node:path';
import {archiveTestContext} from './archive-test-context.mjs';
// Fixtures locales seulement ; aucune collecte externe ni écriture sur le Site.
const bundle=await build({stdin:{contents:"export * from './worker/server-observations';export * from './worker/physical-reference-store';export * from './worker/learning-store';export * from './worker/learning-provider-runs';export * from './worker/reliability';export * from './worker/history-pages';",resolveDir:process.cwd()},bundle:true,format:'esm',platform:'node',write:false,plugins:[{name:'physical-kind',setup(b){b.onResolve({filter:/^\.\/stationService$/},a=>a.importer.endsWith('dailyForecastVerification.ts')?{path:resolve('worker/station-kind.ts')}:undefined);}}]});
await mkdir('qa',{recursive:true});
await writeFile('qa/hourly-partial-test-bundle.mjs',bundle.outputFiles[0].text);
const api=await import(pathToFileURL(resolve('qa/hourly-partial-test-bundle.mjs')).href);
const HOUR=3600000,DAY=24*HOUR,coords={lat:50.7567,lon:2.5204},now=Date.parse('2026-10-17T03:00:00Z');
async function context(){const c=await archiveTestContext();for(const tag of ['0000_dashing_pestilence','0005_lush_micromax','0006_young_marvel_zombies','0007_tense_thor','0008_motionless_amphibian','0009_white_crusher_hogan','0010_black_roughhouse']){
 const sql=await readFile('drizzle/'+tag+'.sql','utf8');c.db.exec(tag.startsWith('0010')?sql.split('ALTER TABLE')[0]:sql);
 }c.env.NETATMO_ENCRYPTION_KEY=Buffer.alloc(32,11).toString('base64');return c;}
async function seed(c,date,hours=5){
 const day=Date.parse(date+'T00:00:00Z'),run=day-6*HOUR,available=day-HOUR+60000;
 const values=Array.from({length:hours},(_,i)=>{const validTime=day+(i+1)*HOUR,common={captureRunId:'AROME-'+run,locationKey:'50.757_2.520',targetDate:date,modelName:'AROME',modelId:'meteofrance_arome_france_hd',metadataAvailableAt:run+4*HOUR,providerRunAt:run,requestStartedAt:available-60000,availableAt:available,validTime,forecastLeadTimeMilliseconds:validTime-run,collectionLatencyMilliseconds:available-run};return [{...common,variable:'temperature',value:1,unit:'°C'},{...common,variable:'humidity',value:80,unit:'%'}];}).flat();
 await api.recordLearningProviderRun(values,c.env,available);
 for(let h=1;h<=hours;h++){const at=day+h*HOUR+20*60000;await api.recordServerObservations({...coords,radiusKm:50,providerReceivedAt:at,stations:[0,1,2].map(i=>({id:'netatmo-partial-'+i,temp:0,humidity:70,time:at-60000,distance:i+1,elevation:null,anomaly:false}))},c.env,at);await api.finalizePhysicalReferences(c.env,day+(h+1)*HOUR+60000);}
 assert.equal((await api.finalizeLearningDays(c.env,day+20*HOUR)).stored,0,'Une journée en cours ne devient pas une journée close');
 return api.finalizeLearningDays(c.env,day+DAY+2*HOUR);
}

test('une seule heure réelle : erreur brute visible, sans minimum quotidien ni note qualifiée',async()=>{
 const c=await context();try{
  const done=await seed(c,'2026-10-16',1);assert.equal(done.stored,1);assert.equal(done.rejected,0);
  const history=await api.readLearningHistory(c.env,now);assert.equal(history.filesRejected,0);assert.equal(history.qualifiedDays,0);assert.equal(history.hourlyEvidenceDays,1);assert.equal(history.scoreCount,2);assert.equal(history.units.length,0);assert.equal(history.qualifiedGroups,0);
  const index=c.db.prepare('SELECT * FROM weather_learning_days').get(),p=await api.readSigned(index,'days',c.env);assert.equal(p.kind,'hourly_learning_day');assert.equal(p.observation.isQualified,false);assert.equal(p.observation.tempMax,null);assert.equal(p.pairs.length,0);
  const result=await api.readReliability({...coords,period:'7d',horizon:'6-24h'},c.env,now),row=result.metrics.find(r=>r.modelName==='AROME'&&r.variable==='temperature');
  assert.equal(row.status,'insufficient_evidence');assert.equal(row.metrics,null);assert.equal(row.rawMetrics.mae,1);assert.equal(row.rawMetrics.comparisonCount,1);assert.equal(result.notes.hourly.mae,null);assert.equal(result.notes.provisionalHourly.mae,1);assert.equal(result.notes.provisionalHourly.evaluatedDays,1);
  assert.equal(result.comparisons.hourly.filter(r=>r.stationTemperature!==null).length,1);assert(result.comparisons.hourly.some(r=>r.stationTemperature===null));
  const visible=await api.readHistoryPage({...coords,days:7},c.env,now);assert.equal(visible.observations.length,0);assert.equal(visible.eveningEvidence.length,0,'Les heures partielles ne deviennent pas des extrema quotidiens historiques');
  const yesterday=await api.readReliabilityYesterday(coords,c.env,now);assert.equal(yesterday.pairs.length,0);assert.match(yesterday.reason,/couverture insuffisante/);
  const before=c.objects.size;assert.equal((await api.finalizeLearningDays(c.env,now+1000)).stored,0);assert.equal(c.objects.size,before);
 }finally{c.db.close();}
});

test('sept dates avec cinq heures : qualification horaire inchangée, extrema quotidiens toujours exclus',async()=>{
 const c=await context();try{
  for(let d=10;d<=16;d++)assert.equal((await seed(c,'2026-10-'+d)).stored,1);
  const history=await api.readLearningHistory(c.env,now);assert.equal(history.qualifiedDays,0);assert.equal(history.hourlyEvidenceDays,7);assert.equal(history.dailyQualifiedGroups,0);assert.equal(history.hourlyQualifiedGroups,2);assert.equal(history.units.length,0);
  const result=await api.readReliability({...coords,period:'7d',horizon:'6-24h'},c.env,now),t=result.metrics.find(r=>r.modelName==='AROME'&&r.variable==='temperature');
  assert.equal(t.status,'qualified');assert.equal(t.metrics.comparisonCount,35);assert.equal(t.metrics.evaluatedDays,7);assert.equal(result.notes.hourly.mae,1);assert.equal(result.notes.daily.mae,null);
  const short=await api.readReliability({...coords,period:'24h',horizon:'6-24h'},c.env,now);assert.equal(short.notes.hourly.mae,null);assert.equal(short.notes.provisionalHourly.comparisonCount,5);
 }finally{c.db.close();}
});

test('même avec une signature de fixture, une journée partielle ne peut publier un extrême quotidien',async()=>{
 const c=await context();try{
  await seed(c,'2026-10-16',2);const index=c.db.prepare('SELECT * FROM weather_learning_days').get(),p=await api.readSigned(index,'days',c.env);p.observation.tempMax=0;
  const saved=await api.saveSigned(p,'days',c.env);c.db.prepare('UPDATE weather_learning_days SET digest=?,object_key=?').run(saved.digest,saved.objectKey);
  const history=await api.readLearningHistory(c.env,now);assert.equal(history.filesRejected,1);assert.equal(history.scoreCount,0);assert.equal(history.qualifiedDays,0);
 }finally{c.db.close();}
});

test('une date rejetée conserve les erreurs des autres dates, explicitement provisoires',async()=>{
 const c=await context();try{
  await seed(c,'2026-10-15',2);await seed(c,'2026-10-16',2);const bad=c.db.prepare('SELECT object_key FROM weather_learning_days WHERE valid_date=?').get('2026-10-16');c.objects.set(bad.object_key,c.objects.get(bad.object_key)+' ');
  const result=await api.readReliability({...coords,period:'7d',horizon:'6-24h'},c.env,now);assert.equal(result.evidence.filesRejected,1);assert.equal(result.notes.complete,false);assert.equal(result.notes.provisionalHourly.mae,1);assert.equal(result.notes.provisionalHourly.comparisonCount,2);assert.equal(result.notes.provisionalHourly.partialArchive,true);
  assert.equal(result.metrics.find(r=>r.modelName==='AROME'&&r.variable==='temperature').rawMetrics.comparisonCount,2);
 }finally{c.db.close();}
});

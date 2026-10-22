import {test} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {archiveTestContext} from './archive-test-context.mjs';
const bundle=await build({stdin:{contents:"export * from './worker/station-comparison';export {buildStationOverview} from './worker/station-overview';export * from './worker/server-observations';export {recordLearningProviderRun,readProviderComparisonValues} from './worker/learning-provider-runs';",resolveDir:process.cwd()},bundle:true,platform:'node',format:'esm',write:false,plugins:[{name:'pure-stations',setup(b){b.onResolve({filter:/^\.\/stationService$/},a=>['dailyForecastVerification.ts','stationPerformanceService.ts'].some(n=>a.importer.endsWith(n))?{path:resolve('worker/station-kind.ts')}:undefined);}}]});
await writeFile('qa/station-comparison-test-bundle.mjs',bundle.outputFiles[0].text);
const api=await import(pathToFileURL(resolve('qa/station-comparison-test-bundle.mjs')).href);
const HOUR=3600000,now=Date.parse('2026-10-20T08:45:00Z'),at=Date.parse('2026-10-20T06:00:00Z'),coords={lat:50.7567,lon:2.5204,radiusKm:50};
const date=t=>new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Paris'}).format(new Date(t));
const value=(modelName,modelId,n,validTime=at,providerRunAt=at-6*HOUR,availableAt=at-2*HOUR)=>({captureRunId:modelName+'-'+providerRunAt,locationKey:'50.757_2.520',targetDate:date(validTime),modelName,modelId,metadataAvailableAt:providerRunAt+HOUR,providerRunAt,requestStartedAt:availableAt-60000,availableAt,validTime,forecastLeadTimeMilliseconds:validTime-providerRunAt,collectionLatencyMilliseconds:availableAt-providerRunAt,variable:'temperature',value:n,unit:'°C'});
async function fixture(){const c=await archiveTestContext();for(const file of ['0005_lush_micromax','0006_young_marvel_zombies','0007_tense_thor','0008_motionless_amphibian','0009_white_crusher_hogan'])c.db.exec(await readFile('drizzle/'+file+'.sql','utf8'));c.env.NETATMO_ENCRYPTION_KEY=Buffer.alloc(32,11).toString('base64');return c;}
async function observations(c,validAt=at){const receivedAt=validAt+21*60000;await api.recordServerObservations({...coords,providerReceivedAt:receivedAt,stations:[0,1,2].map(i=>({id:'netatmo-compare-'+i,temp:0,humidity:70,time:receivedAt-60000,distance:i+1,elevation:null,anomaly:false}))},c.env,receivedAt);}
test('writers et lecteurs réels : modèles signés, mêmes heures physiques, zéro préservé, sans écriture au rapprochement',async()=>{
 const c=await fixture();try{
  await observations(c);await observations(c,at-HOUR);
  for(const row of [value('AROME','meteofrance_arome_france_hd',0),value('ICON','dwd_icon_eu',2)])await api.recordLearningProviderRun([row],c.env,row.availableAt);
  const before=c.db.prepare('SELECT total_changes() AS n').get().n,objects=c.objects.size;
  const history=await api.readServerObservations(c.env,now),window=api.stationComparisonWindow(now),forecast=await api.readProviderComparisonValues(c.env,window.start,window.end,now),result=api.buildStationComparison(history,forecast,50,now);
  assert.equal(forecast.filesRejected,0);assert.equal(result.comparison24h.length,24);
  const pair=result.comparison24h.find(p=>p.validAt===at);assert.equal(pair.stationTemperature,0);assert.equal(pair.officialTemperature,1);assert.equal(pair.modelCount,2);assert.equal(pair.stationSampleCount,3);
  assert.equal(result.instantDeltaC,-1);assert.equal(result.latestPairAt,at);assert.equal(result.comparisonEvidence.pairedHours24h,1);
  const day=result.comparison7d.find(p=>p.date===date(at));assert.equal(day.pairedHours,1);assert.equal(day.stationTemperature,0);assert.equal(day.officialTemperature,1);
  assert.equal(c.db.prepare('SELECT total_changes() AS n').get().n,before);assert.equal(c.objects.size,objects);
  assert(!JSON.stringify(result).includes('stationKey'));assert(!JSON.stringify(result).includes('signature'));
 }finally{c.db.close();}
});
test('prévision tardive, faux modèle, doublon contradictoire et référence physique insuffisante ne deviennent pas des paires',async()=>{
 const c=await fixture();try{
  await observations(c);const history=await api.readServerObservations(c.env,now);
  const original=value('AROME','meteofrance_arome_france_hd',0);
  const result=api.buildStationComparison(history,{values:[{...original,availableAt:at},value('Best Match','best_match',99),original,{...original,value:10}],filesChecked:1},50,now);
  assert.equal(result.comparisonEvidence.pairedHours24h,0);assert.equal(result.instantDeltaC,null);
  const narrow=api.buildStationComparison(history,{values:[original],filesChecked:1},1,now);assert.equal(narrow.comparisonEvidence.pairedHours24h,0);assert.equal(narrow.comparisonEvidence.referenceRadiusKm,1);
  const small={...history,rows:history.rows.slice(0,2)};assert.equal(api.buildStationComparison(small,{values:[original]},50,now).comparisonEvidence.pairedHours24h,0);
  const gap=api.buildStationComparison(history,{values:[{...original,validTime:at+HOUR}]},50,now);assert.equal(gap.comparisonEvidence.pairedHours24h,0);
 }finally{c.db.close();}
});
test('intégrité du cycle rejetée puis réparée ; historique partiel reste signalé',async()=>{
 const c=await fixture();try{
  await observations(c);const row=value('AROME','meteofrance_arome_france_hd',0);await api.recordLearningProviderRun([row],c.env,row.availableAt);
  const index=c.db.prepare('SELECT object_key FROM weather_learning_provider_runs').get(),original=c.objects.get(index.object_key),w=api.stationComparisonWindow(now);
  c.objects.set(index.object_key,original+' ');
  const history=await api.readServerObservations(c.env,now),rejected=await api.readProviderComparisonValues(c.env,w.start,w.end,now);
  assert.equal(rejected.filesRejected,1);assert.equal(api.buildStationComparison(history,rejected,50,now).comparisonStatus,'partial');
  c.objects.set(index.object_key,original);const repaired=await api.readProviderComparisonValues(c.env,w.start,w.end,now);assert.equal(repaired.filesRejected,0);assert.equal(api.buildStationComparison(history,repaired,50,now).comparisonStatus,'available');
  assert.equal(api.buildStationComparison({...history,boundedRead:true},repaired,50,now).comparisonStatus,'partial');
  assert.equal(api.buildStationComparison(history,null,50,now).comparisonStatus,'unavailable');
 }finally{c.db.close();}
});
test('changement d’heure : les deux heures locales répétées conservent leurs instants UTC distincts',()=>{
 const result=api.buildStationComparison({rows:[]},{values:[]},50,Date.parse('2026-10-25T05:30:00Z'));
 assert.equal(result.comparison24h.length,24);
 const first=result.comparison24h.find(p=>p.validAt===Date.parse('2026-10-25T00:00:00Z')),second=result.comparison24h.find(p=>p.validAt===Date.parse('2026-10-25T01:00:00Z'));
 assert.equal(first.hour,2);assert.equal(second.hour,2);assert.notEqual(first.label,second.label);
 assert.equal(new Set(result.comparison24h.map(p=>p.validAt)).size,24);
});

test('le dernier écart sur sept jours reste disponible après une interruption de plus de 24 heures',async()=>{
 const c=await fixture();try{
  const old=at-30*HOUR;await observations(c,old);
  const row=value('AROME','meteofrance_arome_france_hd',2,old,old-6*HOUR,old-2*HOUR);
  await api.recordLearningProviderRun([row],c.env,row.availableAt);
  const history=await api.readServerObservations(c.env,now),window=api.stationComparisonWindow(now),forecast=await api.readProviderComparisonValues(c.env,window.start,window.end,now);
  const result=api.buildStationComparison(history,forecast,50,now);
  assert.deepEqual(result.comparisonSummary24h,{deltaC:null,validAt:null});
  assert.deepEqual(result.comparisonSummary7d,{deltaC:-2,validAt:old});
  assert.equal(result.instantDeltaC,null);assert.equal(result.latestPairAt,null);
  assert.equal(result.comparison7d.find(p=>p.date===date(old)).pairedHours,1);
 }finally{c.db.close();}
});

test('le dernier créneau apparié est horaire, sans confusion avec la moyenne journalière',()=>{
 const rows=[at-HOUR,at].flatMap((hour,index)=>[0,1,2].map(i=>({stationKey:'station-'+i,measuredAt:hour+20*60000,receivedAt:hour+21*60000,temperature:index===0?10:0,distance:i+1,elevation:null,flags:[]})));
 const values=[value('AROME','meteofrance_arome_france_hd',0,at-HOUR),value('AROME','meteofrance_arome_france_hd',0,at)];
 const result=api.buildStationComparison({rows},{values},50,now);
 assert.equal(result.comparison7d.at(-1).stationTemperature,5);
 assert.deepEqual(result.comparisonSummary24h,{deltaC:0,validAt:at});
 assert.deepEqual(result.comparisonSummary7d,{deltaC:0,validAt:at});
});

test('le résumé sept jours exclut la huitième date civile et les archives indisponibles restent sans paire',()=>{
 const old=Date.parse('2026-10-13T12:00:00Z');
 const rows=[0,1,2].map(i=>({stationKey:'station-'+i,measuredAt:old+20*60000,receivedAt:old+21*60000,temperature:0,distance:i+1,elevation:null,flags:[]}));
 const values=[value('AROME','meteofrance_arome_france_hd',2,old,old-6*HOUR,old-2*HOUR)];
 assert.deepEqual(api.buildStationComparison({rows},{values},50,now).comparisonSummary7d,{deltaC:null,validAt:null});
 assert.deepEqual(api.buildStationComparison(null,null,50,now).comparisonSummary7d,{deltaC:null,validAt:null});
});
test('profil opérationnel issu des archives ; aucune performance individuelle ou poids météo inventé avec Netatmo seul',async()=>{
 const c=await fixture();try{
  for(let i=0;i<6;i++)await observations(c,at-i*HOUR);
  const history=await api.readServerObservations(c.env,now),live={stations:[0,1,2].map(i=>({stationId:'netatmo-compare-'+i,name:'Station fixture',source:'netatmo',isActive:true,lat:50.7567+i/100,lon:2.5204,distanceKm:i+1,reliabilityScore:72})),fetchedAt:null};
  const result=await api.buildStationOverview({...coords,periodDays:1},live,history,now);
  assert.equal(result.performanceWindowDays,7);assert.equal(result.stations[0].qualityProfile.observationCount,6);
  assert.equal(result.stations[0].qualityProfile.status,'qualifiee');
  for(const station of result.stations){assert.equal(station.reliabilityScore,72);assert.equal(station.stationPerformance.status,'non_mesuree');assert.equal(station.stationPerformance.variables.temperature.reason,'distinct_reference_networks_insufficient');assert(Object.values(station.stationPerformance.variables).every(v=>v.estimate===null));}
 }finally{c.db.close();}
});

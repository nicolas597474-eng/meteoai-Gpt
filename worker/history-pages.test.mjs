import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {build} from 'esbuild';
const compiled=await build({stdin:{contents:"export * from './worker/history-pages';export * from './worker/fusion-snapshots';export * from './worker/favorites';export * from './worker/daily-archive';export {recordLearningForecast,saveSigned} from './worker/learning-store';",resolveDir:process.cwd()},bundle:true,platform:'node',format:'esm',write:false});
const api=await import('data:text/javascript;base64,'+Buffer.from(compiled.outputFiles[0].text).toString('base64'));
const now=Date.parse('2026-10-20T15:00:00Z'),coords={lat:50.7567,lon:2.5204};
async function fixture(){
 const sqlite=new DatabaseSync(':memory:');const journal=JSON.parse(await readFile('drizzle/meta/_journal.json','utf8'));for(const row of journal.entries)sqlite.exec(await readFile('drizzle/'+row.tag+'.sql','utf8'));
 const DB={prepare(sql){return {bind(...args){return {
  first:async()=>sqlite.prepare(sql).get(...args)??null,
  all:async()=>({results:sqlite.prepare(sql).all(...args)}),
  run:async()=>sqlite.prepare(sql).run(...args)
 };}};}};
 const files=new Map(),BUCKET={put:async(k,v)=>files.set(k,v),get:async k=>files.has(k)?{arrayBuffer:async()=>new TextEncoder().encode(files.get(k)).buffer,size:files.get(k).length}:null};
 return {DB,BUCKET,sqlite,files,NETATMO_ENCRYPTION_KEY:Buffer.alloc(32,7).toString('base64')};
}
const canonical=v=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
function restored(env,table,p,id){const text=JSON.stringify(canonical(p)),digest=createHash('sha256').update(text).digest('hex');env.sqlite.prepare('INSERT INTO recovery_weather_history(source_table,source_id,weather_date,payload,digest) VALUES (?,?,?,?,?)').run(table,id,p.date,text,digest);}
const trace=(at=now,weight=.6)=>({...coords,date:'2026-10-20',computedAt:new Date(at).toISOString(),values:{tempMax:13,tempMin:8,precipitation:0,windSpeed:15},trace:{parameterSources:Object.fromEntries(['tempMax','precipitation','windSpeed'].map(k=>[k,[{name:'AROME',finalWeight:weight},{name:'GFS',finalWeight:1-weight}]]))}});
const goodRestored=(serviceName='AROME')=>({date:'2026-10-20',locationKey:'50.756_2.521',serviceName,collectedAt:'2026-10-20T05:00:00Z',tempMax:12,tempMin:0,precipitation:0});
const daily=at=>({...coords,capturedAt:at,days:[{date:'2026-10-20',forecasts:[{serviceName:'GFS',modelId:'gfs_seamless',tempMax:25,tempMin:10,precipitation:3}]}]});

test('tolérance d’horloge bornée : dates originales intactes, trace vérifiable, contrôles temporels et poids préservés',async()=>{
 const env=await fixture();try{
  const at=now+5000;await api.recordFusionSnapshot(trace(at),env,now);
  const [snapshot]=await api.readWeightHistory(coords,env,now);assert.equal(snapshot.computedAt,new Date(at).toISOString());assert.equal(snapshot.values.precipitation,0);
  const payload=JSON.parse([...env.files.values()][0]);assert.equal(payload.receivedAt,now);assert.equal(payload.computedAt,new Date(at).toISOString());assert.equal(payload.calibrationEligible,false);
  for(const at of [now+5001,now-300001])assert.throws(()=>api.normalizeFusionSnapshot(trace(at),now));
  assert.throws(()=>api.normalizeFusionSnapshot({...trace(),date:'2026-10-21'},now));
  const invalid=trace();invalid.trace.parameterSources.windSpeed[0].name='Best Match';assert.throws(()=>api.normalizeFusionSnapshot(invalid,now));
  assert.equal((await api.readWeightHistory(coords,env,now-1)).length,0,'une réception réellement future n’est pas présentée comme disponible');
 }finally{env.sqlite.close();}
});

test('un fichier restauré altéré ne masque pas les autres valeurs ni les zéros du rapport',async()=>{
 const env=await fixture(),oldFetch=globalThis.fetch;let calls=0;try{
  globalThis.fetch=async()=>{calls++;assert.fail('Lecture sans appel fournisseur');};
  restored(env,'forecasts',goodRestored(),1);restored(env,'forecasts',goodRestored('GFS'),2);
  env.sqlite.prepare('UPDATE recovery_weather_history SET digest=? WHERE source_id=2').run('f'.repeat(64));
  const changes=env.sqlite.prepare('SELECT total_changes() AS n').get().n;
  for(const h of [await api.readHistoryPage({...coords,days:14},env,now),await api.readReportPage({...coords,date:'2026-10-20'},env,now)]){
   assert.deepEqual(h.forecasts.map(f=>f.serviceName),['AROME']);assert.equal(h.forecasts[0].tempMin,0);assert.equal(h.forecasts[0].precipitation,0);
   assert.equal(h.archiveRead.partial,true);assert.equal(h.archiveRead.rejectedFiles,1);assert.deepEqual(h.archiveRead.unavailableSources,[]);
  }
  assert.equal(calls,0);assert.equal(env.sqlite.prepare('SELECT total_changes() AS n').get().n,changes);
 }finally{globalThis.fetch=oldFetch;env.sqlite.close();}
});

test('captures quotidiennes et signées corrompues : exclusion individuelle, autres sources préservées',async()=>{
 const env=await fixture();try{
  restored(env,'forecasts',goodRestored(),1);
  await api.recordDailyCapture(daily(now),env,'browser',now);await api.recordLearningForecast(daily(now),env,now);
  for(const table of ['weather_daily_captures','weather_learning_forecasts']){const row=env.sqlite.prepare('SELECT object_key FROM '+table).get();env.files.set(row.object_key,env.files.get(row.object_key)+' ');}
  const h=await api.readHistoryPage({...coords,days:7},env,now);
  assert.equal(h.forecasts.length,1);assert.equal(h.forecasts[0].tempMax,12);assert.equal(h.archiveRead.rejectedFiles,2);assert.equal(h.eveningEvidence.length,0);
 }finally{env.sqlite.close();}
});

test('un fichier signé structurellement incohérent est écarté en entier avant toute admission',async()=>{
 const env=await fixture();try{
  restored(env,'forecasts',goodRestored(),1);
  const payload={version:1,kind:'server_daily_forecast',location:'50.757_2.520',availableAt:now,days:[{date:'2026-10-20',forecasts:[{...goodRestored(),tempMax:999}]},{date:'2026-10-21',forecasts:null}]};
  const {digest,objectKey}=await api.saveSigned(payload,'forecasts',env);
  env.sqlite.prepare('INSERT INTO weather_learning_forecasts VALUES (?,?,?,?,?)').run('50.757_2.520/2026-10-20T15','50.757_2.520',now,objectKey,digest);
  const h=await api.readHistoryPage({...coords,days:7},env,now);assert.equal(h.archiveRead.rejectedFiles,1);assert.equal(h.forecasts.length,1);assert.equal(h.forecasts[0].tempMax,12);
 }finally{env.sqlite.close();}
});

test('traces fusionnées : les dates saines restent lisibles, les comparaisons de poids restent strictes',async()=>{
 const env=await fixture();try{
  const yesterday=now-86400000;
  await api.recordFusionSnapshot({...trace(yesterday),date:'2026-10-19'},env,yesterday);await api.recordFusionSnapshot(trace(),env,now);
  const row=env.sqlite.prepare('SELECT object_key FROM weather_fusion_snapshots WHERE valid_date=?').get('2026-10-20');env.files.set(row.object_key,'{}');
  restored(env,'forecasts',goodRestored(),1);
  const h=await api.readHistoryPage({...coords,days:7},env,now);assert.equal(h.archiveRead.rejectedFiles,1);assert.deepEqual(h.meteoAIForecasts.map(r=>r.date),['2026-10-19']);
  const report=await api.readReportPage({...coords,date:'2026-10-20'},env,now);assert.equal(report.meteoAI.tempMax,null);assert.equal(report.archiveRead.partial,true);
  await assert.rejects(api.readWeightHistory(coords,env,now),e=>e.status===503);
 }finally{env.sqlite.close();}
});

test('une source SQL indisponible est signalée sans effacer les archives indépendantes',async()=>{
 const env=await fixture();try{
  restored(env,'forecasts',goodRestored(),1);env.sqlite.exec('DROP TABLE weather_daily_captures');
  const h=await api.readHistoryPage({...coords,days:7},env,now);assert.equal(h.forecasts.length,1);assert.equal(h.archiveRead.partial,true);assert.deepEqual(h.archiveRead.unavailableSources,['daily_captures']);
  const failed={...env,DB:{prepare(){throw Error('private token fixture');}}};
  await assert.rejects(api.readHistoryPage({...coords,days:7},failed,now),e=>e.status===503&&!e.message.includes('private'));
 }finally{env.sqlite.close();}
});

test('limite de lecture atteinte : vue explicitement partielle, sans dépasser le budget',async()=>{
 const env=await fixture();try{
  for(let i=0;i<401;i++)restored(env,'forecasts',goodRestored(),i+1);
  const h=await api.readHistoryPage({...coords,days:7},env,now);assert.equal(h.forecasts.length,1);assert.equal(h.archiveRead.boundedRead,true);assert.equal(h.archiveRead.partial,true);assert.equal(h.archiveRead.rejectedFiles,0);
 }finally{env.sqlite.close();}
});

test('une archive réparée est reprise après le cache court, sans réécrire l’historique',async()=>{
 const env=await fixture();try{
  restored(env,'forecasts',goodRestored(),1);await api.recordDailyCapture(daily(now),env,'browser',now);
  const row=env.sqlite.prepare('SELECT object_key FROM weather_daily_captures').get(),saved=env.files.get(row.object_key);env.files.delete(row.object_key);
  assert.equal((await api.readHistoryPage({...coords,days:7},env,now)).archiveRead.partial,true);
  env.files.set(row.object_key,saved);
  const repaired=await api.readHistoryPage({...coords,days:7},env,now+61000);assert.equal(repaired.archiveRead.partial,false);assert.equal(repaired.forecasts.length,2);assert.equal(env.files.get(row.object_key),saved);
 }finally{env.sqlite.close();}
});

test('preuve qualifiée illisible : aucune qualification transférée à une ancienne observation',async()=>{
 const env=await fixture();try{
  restored(env,'observations',{...goodRestored(),date:'2026-10-19',isQualified:true},1);
  env.sqlite.prepare('INSERT INTO weather_learning_days VALUES (?,?,?,?,?,?,?,?,?)').run('50.757_2.520/2026-10-19','50.757_2.520','2026-10-19',now,'a'.repeat(64),18,4,'learning/days/'+('b'.repeat(64))+'.json','b'.repeat(64));
  const h=await api.readHistoryPage({...coords,days:7},env,now);assert.equal(h.archiveRead.rejectedFiles,1);assert.equal(h.observations.length,1);assert.equal(h.observations[0].isQualified,false);assert.equal(h.eveningEvidence.length,0);
 }finally{env.sqlite.close();}
});
test('lectures réelles : anciennes archives du bon lieu, nouvelles captures et traces, sans qualification rétroactive',async()=>{
 const env=await fixture();try{
  restored(env,'forecasts',{date:'2026-10-14',locationKey:'50.756_2.521',serviceName:'AROME',collectedAt:'2026-10-14T05:00:00Z',tempMax:18,tempMin:7,precipitation:0},1);
  restored(env,'observations',{date:'2026-10-13',locationKey:'50.756_2.521',collectedAt:'2026-10-14T01:00:00Z',tempMax:17,tempMin:6,isQualified:1},2);
  restored(env,'observations',{date:'2026-10-13',locationKey:'50.676_2.845',collectedAt:'2026-10-14T02:00:00Z',tempMax:99},3);
  await api.recordDailyCapture({...coords,capturedAt:now,days:[{date:'2026-10-20',forecasts:[{serviceName:'AROME',modelId:'meteofrance_arome_france_hd',tempMax:13,tempMin:8,precipitation:0}]}]},env,'browser',now);
  await api.recordFusionSnapshot(trace(),env,now);
  const h=await api.readHistoryPage({...coords,days:14},env,now);
  assert.equal(h.forecasts.length,2);assert.equal(h.observations.length,1);assert.equal(h.observations[0].tempMax,17);assert.equal(h.observations[0].isQualified,false);assert.equal(h.eveningEvidence.length,0);assert.equal(h.meteoAIForecasts[0].tempMax,13);
  const report=await api.readReportPage({...coords,date:'2026-10-20'},env,now);assert.equal(report.meteoAI.tempMax,13);assert.equal(report.forecasts[0].precipitation,0);assert.equal(report.observationComparisons.length,0);
  assert.deepEqual((await api.readHistoryPage({lat:50.63,lon:3.05,days:14},env,now)).forecasts,[]);
  await assert.rejects(()=>api.readHistoryPage({days:1000},env,now));
 }finally{env.sqlite.close();}
});
test('poids immuables : déduplication horaire, comparaison réelle, somme contrôlée et corruption non transformée en vide',async()=>{
 const env=await fixture();try{
  const before=now-3600000;await api.recordFusionSnapshot(trace(before,.5),env,before);await api.recordFusionSnapshot(trace(),env,now);await api.recordFusionSnapshot(trace(now,.9),env,now);
  const rows=await api.readWeightHistory(coords,env,now);assert.equal(rows.length,2);
  const diff=await api.compareSnapshots({...coords,beforeId:rows[1].id,afterId:rows[0].id},env,now);assert(Math.abs(diff.parameters[0].sourceChanges.find(r=>r.name==='AROME').delta-.1)<1e-8);
  assert.equal((await api.readHistoryPage({...coords,days:7},env,now)).meteoAIForecasts[0].tempMax,13);
  const invalid=trace();invalid.trace.parameterSources.tempMax[0].finalWeight=1;assert.throws(()=>api.normalizeFusionSnapshot(invalid,now));
  env.files.set([...env.files.keys()][0],'{}');await assert.rejects(()=>api.readWeightHistory(coords,env,now),e=>e.status===503);
 }finally{env.sqlite.close();}
});
test('les paramètres favoris autorisés persistent et restent isolés par compte',async()=>{
 const env=await fixture();try{
  env.sqlite.exec("INSERT INTO site_users(id,subject,created_at) VALUES (1,'alice','date'),(2,'bob','date')");
  const {id}=await api.favoriteProcedure('favorites.add',{name:'Hondeghem',...coords,radiusKm:50,localMode:'local'},1,env.DB);
  assert.equal((await api.favoriteProcedure('favorites.list',undefined,1,env.DB))[0].radiusKm,50);
  await api.favoriteProcedure('favorites.update',{id,radiusKm:10,localMode:'ultra-local'},1,env.DB);
  const r=(await api.favoriteProcedure('favorites.list',undefined,1,env.DB))[0];assert.equal(r.radiusKm,10);assert.equal(r.localMode,'ultra-local');
  assert.deepEqual(await api.favoriteProcedure('favorites.list',undefined,2,env.DB),[]);
  await assert.rejects(()=>api.favoriteProcedure('favorites.update',{id,tempUnit:'fahrenheit'},1,env.DB));
 }finally{env.sqlite.close();}
});

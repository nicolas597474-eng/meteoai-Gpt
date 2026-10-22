import {test,mock} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {archiveTestContext} from './archive-test-context.mjs';
const bundle=await build({stdin:{contents:"export * from './worker/meteoai-history';export {saveSigned} from './worker/learning-store';export {recordServerObservations} from './worker/server-observations';export {finalizePhysicalReferences} from './worker/physical-reference-store';",resolveDir:process.cwd()},bundle:true,platform:'node',format:'esm',write:false,plugins:[{name:'station-kind',setup(b){b.onResolve({filter:/^\.\/stationService$/},a=>a.importer.endsWith('dailyForecastVerification.ts')?{path:resolve('worker/station-kind.ts')}:undefined);}}]});
await writeFile('qa/meteoai-history-test.mjs',bundle.outputFiles[0].text);
const api=await import(pathToFileURL(resolve('qa/meteoai-history-test.mjs')).href),coords={lat:50.7567,lon:2.5204},HOUR=3600000;
async function context(){const c=await archiveTestContext();for(const tag of ['0003_glamorous_silvermane','0005_lush_micromax','0006_young_marvel_zombies','0007_tense_thor','0008_motionless_amphibian','0009_white_crusher_hogan','0010_black_roughhouse'])c.db.exec(await readFile('drizzle/'+tag+'.sql','utf8'));c.env.NETATMO_ENCRYPTION_KEY=Buffer.alloc(32,11).toString('base64');return c;}
async function emit(c,kind,rows,at){const clock=mock.method(Date,'now',()=>at);try{return await api.recordMeteoAIForecast(kind,rows,coords,c.env,at);}finally{clock.mock.restore();}}
async function physicalDay(c,date,from=1,to=18){
 const day=Date.parse(date+'T00:00:00Z');
 for(let h=from;h<=to;h++){const valid=day+h*HOUR,at=valid+20*60000;await api.recordServerObservations({...coords,radiusKm:50,providerReceivedAt:at,stations:[0,1,2].map(i=>({id:'netatmo-test-'+i,temp:10,time:at-60000,distance:i+1,elevation:null,anomaly:false}))},c.env,at);await api.finalizePhysicalReferences(c.env,valid+HOUR+60000);}
 // Pending work uses this index only; the physical files are independently verified.
 c.db.prepare('INSERT INTO weather_learning_days(id,location_key,valid_date,created_at,source_digest,coverage_hours,score_count,object_key,digest) VALUES (?,?,?,?,?,?,?,?,?)').run('50.757_2.520/'+date,'50.757_2.520',date,day+25*HOUR,'a'.repeat(64),to-from+1,0,'unused','b'.repeat(64));
}
test('archive réelle : deux jours produisent des notes provisoires MeteoAI et une globale',async()=>{
 const c=await context();try{
  for(const date of ['2026-10-14','2026-10-15']){
   const day=Date.parse(date+'T00:00:00Z'),at=day-5*HOUR;
   const rows=Array.from({length:18},(_,i)=>({validAt:day+(i+1)*HOUR,temp:11}));
   await emit(c,'hourly',rows,at);await emit(c,'daily',[{date,tempMax:12,tempMin:12}],at);
   // Current-day receipt must not replace yesterday's prediction for that day.
   await emit(c,'hourly',[{validAt:day+19*HOUR,temp:99}],day+18*HOUR);
   await physicalDay(c,date);
  }
  const now=Date.parse('2026-10-17T03:00:00Z');assert.equal((await api.finalizeMeteoAIHistory(c.env,now)).stored,2);
  const r=await api.readMeteoAIReliability(coords,c.env,now);
  assert.equal(r.hourly.comparisonCount,36);assert.equal(r.hourly.evaluatedDays,2);assert.equal(r.hourly.note,8);assert.equal(r.hourly.qualified,false);
  assert.equal(r.daily.comparisonCount,4);assert.equal(r.daily.note,6);assert.equal(r.global.note,7);assert.equal(r.global.partial,false);
  assert.equal(r.startDate,'2026-10-14');assert.equal(r.endDate,'2026-10-15');
  const count=c.db.prepare('SELECT total_changes() n').get().n;await api.readMeteoAIReliability(coords,c.env,now+1);assert.equal(c.db.prepare('SELECT total_changes() n').get().n,count,'Lecture sans écriture');
  assert.equal((await api.finalizeMeteoAIHistory(c.env,now+1)).stored,0,'Pas de doublons');
 }finally{c.db.close();}
});
test('aucune note depuis un cache, une capture navigateur ou une prévision reçue trop tard',async()=>{
 const c=await context();try{
  const date='2026-10-15',day=Date.parse(date+'T00:00:00Z');
  await emit(c,'hourly',[{validAt:day+HOUR,temp:99}],day+HOUR+1);await emit(c,'daily',[{date,tempMax:99,tempMin:99}],day+HOUR);
  await physicalDay(c,date,1,2);await api.finalizeMeteoAIHistory(c.env,day+28*HOUR);
  const r=await api.readMeteoAIReliability(coords,c.env,day+28*HOUR);assert.equal(r.hourly.note,null);assert.equal(r.daily.note,null);assert.equal(r.global.note,null);
  assert.equal((await api.readMeteoAIReliability({lat:0,lon:0},c.env,day+28*HOUR)).status,'not_covered');
 }finally{c.db.close();}
});
test('un historique vide ne lance ni collecte ni écriture ; panne explicite sans fuite',async()=>{
 const c=await context();try{
  const before=c.db.prepare('SELECT total_changes() n').get().n;const r=await api.readMeteoAIReliability(coords,c.env);assert.equal(r.global.note,null);assert.equal(r.available,true);assert.equal(c.db.prepare('SELECT total_changes() n').get().n,before);
  const fail=await api.readMeteoAIReliability(coords,{DB:{prepare(){throw Error('secret SQL');}}});assert.equal(fail.available,false);assert.equal(fail.global.note,null);assert(!JSON.stringify(fail).includes('secret SQL'));
 }finally{c.db.close();}
});
test('fichier signé corrompu suspend la note puis récupération immédiate, sans limite de date à un an',async()=>{
 const c=await context();try{
  const now=Date.parse('2026-10-17T03:00:00Z');await emit(c,'hourly',[{validAt:now+HOUR,temp:11}],now);
  const date='2024-01-01',validAt=Date.parse(date+'T00:00:00Z'),payload={version:1,kind:'verified_meteoai_day',location:'50.757_2.520',date,createdAt:validAt+86400000,sourceDigest:'c'.repeat(64),pairs:[{kind:'hourly',date,variable:'temperature',validAt,availableAt:validAt-1,observedAt:validAt+1,forecast:11,observed:10}]};
  const saved=await api.saveSigned(payload,'runs',c.env);c.db.prepare('INSERT INTO weather_meteoai_verification_days VALUES (?,?,?,?,?,?,?)').run('50.757_2.520/'+date,'50.757_2.520',date,payload.createdAt,payload.sourceDigest,saved.objectKey,saved.digest);
  const body=c.objects.get(saved.objectKey);c.objects.set(saved.objectKey,body+' ');
  const bad=await api.readMeteoAIReliability(coords,c.env,now);assert.equal(bad.filesRejected,1);assert.equal(bad.complete,false);assert.equal(bad.global.note,null);
  c.objects.set(saved.objectKey,body);const r=await api.readMeteoAIReliability(coords,c.env,now+1);assert.equal(r.hourly.note,8);assert.equal(r.startDate,'2024-01-01');assert.equal(r.global.partial,true);
  assert(!JSON.stringify(r).includes('signature'));
 }finally{c.db.close();}
});
test('prévision future altérée : aucune comparaison ni note n’est publiée',async()=>{
 const c=await context();try{
  const date='2026-10-15',day=Date.parse(date+'T00:00:00Z');await emit(c,'hourly',[{validAt:day+HOUR,temp:11}],day-3*HOUR);await physicalDay(c,date,1,2);
  const row=c.db.prepare('SELECT object_key FROM weather_meteoai_forecasts').get();c.objects.set(row.object_key,c.objects.get(row.object_key)+' ');
  const result=await api.finalizeMeteoAIHistory(c.env,day+28*HOUR);assert.equal(result.rejected,1);assert.equal(result.stored,0);assert.equal((await api.readMeteoAIReliability(coords,c.env,day+28*HOUR)).global.note,null);
 }finally{c.db.close();}
});

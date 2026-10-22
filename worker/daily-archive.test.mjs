import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {build} from 'esbuild';
import {archiveTestContext,recordCapture} from './archive-test-context.mjs';
import worker from '../dist/server/index.js';
const bundle=await build({entryPoints:['worker/daily-archive.ts'],bundle:true,format:'esm',platform:'node',write:false});
const {normalizeDailyCapture,recordDailyCapture,readDailyCapture}=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));
const now=Date.now()-1000,coords={lat:50.7567,lon:2.5204};
const day=at=>new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Paris',year:'numeric',month:'2-digit',day:'2-digit'}).format(at);
const input=(at=now,date=day(at))=>({...coords,capturedAt:at,days:[{date,forecasts:[{serviceName:'AROME',modelId:'meteofrance_arome_france_hd',tempMax:0,tempMin:null,precipitation:0,windSpeed:4,requestStartedAt:at-1000,availableAt:at-100}]}]});
async function context(){const c=await archiveTestContext();const journal=JSON.parse(await readFile('drizzle/meta/_journal.json','utf8'));for(const {tag} of journal.entries)if(!['0001_youthful_robin_chapel','0002_cute_celestials'].includes(tag))c.db.exec(await readFile('drizzle/'+tag+'.sql','utf8'));return c;}
const request=(path,body,headers={})=>new Request('https://controle.example'+path,{method:body===undefined?'GET':'POST',headers,body:body===undefined?undefined:typeof body==='string'?body:JSON.stringify(body)});
const privateHeaders={'oai-authenticated-user-id':'daily-test',Origin:'https://controle.example','Content-Type':'application/json'};
const fusion=at=>({...coords,date:day(at),computedAt:new Date(at).toISOString(),values:{tempMax:0,precipitation:0,windSpeed:4},trace:{parameterSources:Object.fromEntries(['tempMax','precipitation','windSpeed'].map(key=>[key,[{name:'AROME',finalWeight:1}]]))}});

test('régression 503 : une horloge navigateur en avance de 1 s ne fait pas échouer une archive valide',async t=>{
 const at=Date.parse('2026-10-22T10:00:00Z');t.mock.method(Date,'now',()=>at);
 const c=await context();try{
  const payload={...input(at+1000),fusionSnapshot:fusion(at+1000)};
  const response=await worker.fetch(request('/api/history/daily-capture',payload,privateHeaders),c.env,{waitUntil(){}});
  assert.equal(c.db.prepare('SELECT COUNT(*) AS n FROM weather_daily_captures').get().n,1,'la prévision est déjà enregistrée même avec l’ancien 503');
  assert.equal(response.status,200);assert.equal((await response.json()).fusionSnapshot.status,'stored');
  assert.equal(c.db.prepare('SELECT COUNT(*) AS n FROM weather_fusion_snapshots').get().n,1);
 }finally{c.db.close();}
});

test('une trace refusée conserve la capture et distingue le refus d’une panne de stockage',async t=>{
 const at=Date.parse('2026-10-22T10:00:00Z');t.mock.method(Date,'now',()=>at);
 const warnings=[];t.mock.method(console,'warn',(...args)=>warnings.push(args.join(' ')));
 for(const mutate of [v=>v.computedAt=new Date(at-300001).toISOString(),v=>v.computedAt=new Date(at+5001).toISOString(),v=>v.trace.parameterSources.tempMax[0].finalWeight=.5]){
  const c=await context();try{
   const snapshot=fusion(at);mutate(snapshot);
   const response=await worker.fetch(request('/api/history/daily-capture',{...input(at),fusionSnapshot:snapshot},privateHeaders),c.env,{waitUntil(){}});
   assert.equal(response.status,200);const receipt=await response.json();assert.equal(receipt.stored,true);assert.equal(receipt.partial,true);assert.equal(receipt.fusionSnapshot.status,'rejected');
   assert.equal((await readDailyCapture(c.env,at)).status,'verified');assert.equal(c.db.prepare('SELECT COUNT(*) AS n FROM weather_fusion_snapshots').get().n,0);
  }finally{c.db.close();}
 }
 assert.deepEqual(warnings,Array(3).fill('[daily-capture] fusion_snapshot_invalid'));
});

test('panne SQL ou fichier de la trace : succès quotidien partiel explicite, sans divulgation',async t=>{
 const at=Date.parse('2026-10-22T10:00:00Z');t.mock.method(Date,'now',()=>at);
 const warnings=[];t.mock.method(console,'warn',(...args)=>warnings.push(args.join(' ')));
 for(const stage of ['sql','file']){
  const c=await context();try{
   if(stage==='sql')c.db.exec('DROP TABLE weather_fusion_snapshots');
   else{const put=c.env.BUCKET.put;c.env.BUCKET.put=async(k,v)=>{if(k.startsWith('history/fusion-traces/'))throw Error('private-storage-token');return put(k,v);};}
   const response=await worker.fetch(request('/api/history/daily-capture',{...input(at),fusionSnapshot:fusion(at)},privateHeaders),c.env,{waitUntil(){}});
   assert.equal(response.status,200);const receipt=await response.json();assert.equal(receipt.stored,true);assert.equal(receipt.partial,true);assert.equal(receipt.fusionSnapshot.status,'unavailable');assert(!JSON.stringify(receipt).includes('private-storage-token'));
   assert.equal((await readDailyCapture(c.env,at)).status,'verified');
  }finally{c.db.close();}
 }
 assert.deepEqual(warnings,Array(2).fill('[daily-capture] fusion_storage_unavailable'));
});

test('une nouvelle tentative peut enregistrer la trace sans remplacer la première prévision quotidienne',async t=>{
 const at=Date.parse('2026-10-22T10:00:00Z');t.mock.method(Date,'now',()=>at);t.mock.method(console,'warn',()=>{});
 const c=await context();try{
  const payload={...input(at),fusionSnapshot:fusion(at)};
  const post=()=>worker.fetch(request('/api/history/daily-capture',payload,privateHeaders),c.env,{waitUntil(){}});
  payload.fusionSnapshot.trace.parameterSources.tempMax[0].finalWeight=.5;
  assert.equal((await (await post()).json()).fusionSnapshot.status,'rejected');
  const original=[...c.objects.values()][0];payload.fusionSnapshot.trace.parameterSources.tempMax[0].finalWeight=1;payload.days[0].forecasts[0].tempMax=20;
  const repaired=await (await post()).json();assert.equal(repaired.duplicate,true);assert.equal(repaired.fusionSnapshot.status,'stored');assert.equal(repaired.partial,false);
  assert.equal([...c.objects.values()][0],original);
  const duplicate=await (await post()).json();assert.equal(duplicate.fusionSnapshot.status,'duplicate');assert.equal(c.db.prepare('SELECT COUNT(*) AS n FROM weather_fusion_snapshots').get().n,1);
 }finally{c.db.close();}
});

test('capture invalide : 400 sans écriture ; vraie panne de stockage quotidien : 503 sans fausse confirmation',async t=>{
 const at=Date.parse('2026-10-22T10:00:00Z');t.mock.method(Date,'now',()=>at);
 const errors=[];t.mock.method(console,'error',(...args)=>errors.push(args.join(' ')));
 for(const body of [null,{},input(at-300001),{...input(at),days:[null]}]){
  const c=await context();try{
   const response=await worker.fetch(request('/api/history/daily-capture',body,privateHeaders),c.env,{waitUntil(){}});
   assert.equal(response.status,400);assert.equal((await response.json()).code,'daily_capture_invalid');assert.equal(c.objects.size,0);
  }finally{c.db.close();}
 }
 for(const stage of ['sql','file','index']){
  const c=await context();try{
   if(stage==='sql')c.db.exec('DROP TABLE weather_daily_captures');
   else if(stage==='file')c.env.BUCKET.put=async()=>{throw Error('private-storage-token');};
   else{const prepare=c.env.DB.prepare;c.env.DB.prepare=sql=>{if(sql.startsWith('INSERT INTO weather_daily_captures'))throw Error('private-storage-token');return prepare(sql);};}
   const response=await worker.fetch(request('/api/history/daily-capture',{...input(at),fusionSnapshot:fusion(at)},privateHeaders),c.env,{waitUntil(){}});
   assert.equal(response.status,503);const receipt=await response.json();assert.equal(receipt.code,'daily_storage_unavailable');assert.equal(receipt.stored,undefined);assert(!JSON.stringify(receipt).includes('private-storage-token'));
   assert.equal(c.db.prepare('SELECT COUNT(*) AS n FROM weather_fusion_snapshots').get().n,0);
  }finally{c.db.close();}
 }
 assert.deepEqual(errors,Array(3).fill('[daily-capture] daily_storage_unavailable'));
});

test('capture quotidienne : zéro conservé, champs libres retirés, modèle et date stricts',()=>{
 const v=input();v.secret='ne-pas-transmettre';v.days[0].forecasts[0].rawData='x'.repeat(200000);
 const normalized=normalizeDailyCapture(v,now),text=JSON.stringify(normalized);
 assert.equal(normalized.days[0].forecasts[0].tempMax,0);assert.equal(normalized.days[0].forecasts[0].tempMin,null);assert(text.length<2000);assert(!text.includes('secret'));assert(!text.includes('rawData'));
 for(const mutate of [v=>v.lat=0,v=>v.capturedAt=now-300001,v=>v.days.push(v.days[0]),v=>v.days[0].date='2026-02-30',v=>v.days[0].forecasts[0].modelId='inconnu',v=>v.days[0].forecasts[0].serviceName='Open-Meteo',v=>v.days[0].forecasts[0].tempMax=NaN,v=>v.days[0].forecasts[0].availableAt=now+1]){const v=input();mutate(v);assert.throws(()=>normalizeDailyCapture(v,now));}
});
test('writer et lecteur : index et fichier immuable concordants, doublon horaire préserve la première capture',async()=>{
 const c=await context();try{
  assert.equal((await readDailyCapture(c.env,now)).status,'none');
  const written=await recordDailyCapture(input(),c.env,'browser',now);assert.equal(written.stored,true);
  const v=input();v.days[0].forecasts[0].tempMax=20;assert.equal((await recordDailyCapture(v,c.env,'browser',now)).duplicate,true);
  const result=await readDailyCapture(c.env,now);assert.equal(result.status,'verified');assert.deepEqual(result.models,['AROME']);assert.equal(result.coverage[0].variables[0].archivedCount,1);assert.equal(result.coverage[0].variables[1].archivedCount,0);assert.equal(result.coverage[0].variables[0].exposedCount,null);
  const object=JSON.parse([...c.objects.values()][0]);assert.equal(object.observation,false);assert.equal(object.calibrationEligible,false);assert.equal(object.days[0].forecasts[0].tempMax,0);
  c.db.exec('UPDATE weather_daily_captures SET forecast_count=9');assert.equal((await readDailyCapture(c.env,now)).status,'integrity_error');
 }finally{c.db.close();}
});
test('une archive altérée, absente ou une panne SQL ne confirme aucun quotidien',async()=>{
 const c=await context();try{
  await recordDailyCapture(input(),c.env,'browser',now);const key=[...c.objects.keys()][0],text=c.objects.get(key);
  c.objects.set(key,text+' ');assert.equal((await readDailyCapture(c.env,now)).models.length,0);
  c.objects.delete(key);assert.equal((await readDailyCapture(c.env,now)).status,'integrity_error');
  c.db.exec('DROP TABLE weather_daily_captures');await assert.rejects(readDailyCapture(c.env,now));
 }finally{c.db.close();}
});
test('un jour archivé sans la date courante ne remplit pas le compteur du jour',async()=>{
 const c=await context();try{
  await recordDailyCapture(input(),c.env,'browser',now);
  const next=await readDailyCapture(c.env,now+2*86400000);assert.equal(next.status,'none');assert.deepEqual(next.models,[]);
 }finally{c.db.close();}
});
test('route quotidienne privée : identité, origine, taille et vraie persistance contrôlées',async()=>{
 const c=await context();try{
  const post=(body,headers=privateHeaders)=>worker.fetch(request('/api/history/daily-capture',body,headers),c.env,{waitUntil(){}});
  assert.equal((await post(input(),{})).status,401);assert.equal((await post(input(),{...privateHeaders,Origin:'https://ailleurs.invalid'})).status,403);
  assert.equal((await post('x'.repeat(100001))).status,413);assert.equal((await post('{')).status,400);
  assert.equal((await post(input())).status,200);
  const url='/api/trpc/weather.getForecastCollectionReport?input='+encodeURIComponent(JSON.stringify({json:coords}));
  const data=(await (await worker.fetch(request(url,undefined,privateHeaders),c.env,{waitUntil(){}})).json()).result.data.json;
  assert.equal(data.snapshot.dailyModelCount,1);assert.equal(data.snapshot.hourlyModelCount,null);assert.equal(data.dailyArchiveDiagnostics.status,'verified');assert.equal(data.flowStatuses[0].status,'PARTIAL');assert.equal(data.scheduledAt,null);assert.equal(data.snapshot.dailyVariableCoverage[0].archiveWriteConfirmed,true);
 }finally{c.db.close();}
});
test('une archive quotidienne ancienne ne devient pas récente grâce à une nouvelle capture horaire',async()=>{
 const c=await context();try{
  const old=now-31*3600000;await recordDailyCapture(input(old,day(now)),c.env,'browser',old);
  await recordCapture({...coords,capturedAt:now,models:[{modelName:'AROME',hours:[{validAt:now+3600000,temperature:5}]}]},c.env,'browser',now);
  const url='/api/trpc/weather.getForecastCollectionReport?input='+encodeURIComponent(JSON.stringify({json:coords}));
  const data=(await (await worker.fetch(request(url,undefined,privateHeaders),c.env,{waitUntil(){}})).json()).result.data.json;
  assert.equal(data.snapshot.dailyModelCount,1);assert.equal(data.snapshot.hourlyModelCount,1);assert.equal(data.flowStatuses[0].status,'STALE');
 }finally{c.db.close();}
});

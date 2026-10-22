import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFile} from 'node:fs/promises';
import {build} from 'esbuild';
const built=await build({stdin:{contents:"export * from './worker/archive-diagnostics';export * from './worker/server-observations';",resolveDir:process.cwd()},bundle:true,platform:'node',format:'esm',write:false});
const api=await import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].text).toString('base64'));
async function context(){
 const db=new DatabaseSync(':memory:');const journal=JSON.parse(await readFile('drizzle/meta/_journal.json','utf8'));for(const row of journal.entries)db.exec(await readFile('drizzle/'+row.tag+'.sql','utf8'));
 const DB={prepare(sql){const q=db.prepare(sql);let args=[];return {bind(...v){args=v;return this;},first:async()=>q.get(...args)??null,all:async()=>({results:q.all(...args)}),run:async()=>q.run(...args)};}};
 const files=new Map(),BUCKET={put:async(k,v)=>files.set(k,v),get:async k=>files.has(k)?{size:Buffer.byteLength(files.get(k)),arrayBuffer:async()=>new TextEncoder().encode(files.get(k)).buffer}:null};
 return {db,files,env:{DB,BUCKET,METEOAI_BACKGROUND_ENABLED:'true'}};
}
test('le bilan distingue reçu du service, archive physique vérifiée et complétude réelle des modèles',async()=>{
 const c=await context(),now=Date.parse('2026-10-20T16:40:00Z'),coords={lat:50.7567,lon:2.5204};
 try{
  c.db.prepare('INSERT INTO weather_collection_status VALUES (?,?,?,?)').run('unattended_hourly_v1',new Date(now).toISOString(),'ok',JSON.stringify({version:1,slot:'2026-10-20T16',status:'complete',observations:3,models:7,dailyModels:5,verified:true}));
  await api.recordServerObservations({...coords,radiusKm:50,providerReceivedAt:now,stations:[0,1,2].map(i=>({id:'netatmo-fixture-'+i,time:now-60000,temp:10,distance:i+1,elevation:null,anomaly:false}))},c.env,now);
  const request=new Request('https://controle.example/api/read',{headers:{'oai-authenticated-user-id':'fixture'}}),r=await api.readArchiveCollectionReport(coords,request,c.env,now);
  assert.equal(r.collectionService.status,'partial');assert.equal(r.lastForecastRun.status,'partial');assert.equal(r.lastForecastRun.dailyModelsCollected,5);assert.equal(r.lastPhysicalCollection.stationCount,3);assert.equal(r.physicalArchiveStatus,'verified');assert.equal(r.hourlyHistory.length,1);assert.equal(r.hourlyHistory[0].attempts,null);
  for(const key of c.files.keys())c.files.set(key,'corrupted fixture');
  const failed=await api.readArchiveCollectionReport(coords,request,c.env,now);assert.equal(failed.lastPhysicalCollection,null);assert.equal(failed.physicalArchiveStatus,'unavailable');assert.equal(failed.hourlyHistory.length,0);
 }finally{c.db.close();}
});

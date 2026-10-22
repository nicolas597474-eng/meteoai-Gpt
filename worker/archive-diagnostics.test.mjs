import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFile} from 'node:fs/promises';
import {build} from 'esbuild';
import worker from '../dist/server/index.js';
const built=await build({entryPoints:['worker/archive.ts'],bundle:true,platform:'node',format:'esm',write:false});
const {recordCapture}=await import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].text).toString('base64'));
const stationBuilt=await build({entryPoints:['worker/station-observations.ts'],bundle:true,platform:'node',format:'esm',write:false});
const {recordObservations}=await import('data:text/javascript;base64,'+Buffer.from(stationBuilt.outputFiles[0].text).toString('base64'));
async function context(){
 const sqlite=new DatabaseSync(':memory:');
 for(const name of ['0001_youthful_robin_chapel','0002_cute_celestials'])sqlite.exec(await readFile('drizzle/'+name+'.sql','utf8'));
 const objects=new Map();
 const env={DB:{prepare(sql){const statement=sqlite.prepare(sql);let args=[];return {bind(...values){args=values;return this;},async first(){return statement.get(...args)??null;},async all(){return {results:statement.all(...args)};},async run(){return statement.run(...args);}};}}
 ,BUCKET:{async put(key,value){objects.set(key,value);},async get(key){const value=objects.get(key);return value?{size:Buffer.byteLength(value),arrayBuffer:async()=>new TextEncoder().encode(value).buffer}:null;}}};
 env.DB.batch=async statements=>Promise.all(statements.map(statement=>statement.run()));
 return {env,sqlite,objects};
}
async function read(env,input={lat:50.7567,lon:2.5204},signed=true){
 const url=new URL('https://controle.example/api/trpc/weather.getForecastCollectionReport');url.searchParams.set('input',JSON.stringify({json:input}));
 const response=await worker.fetch(new Request(url,{headers:signed?{'oai-authenticated-user-id':'archive-local-test'}:{}}),env,{waitUntil(){}});return response.json();
}
test('route AI Lab : capture réelle du writer relue dans SQLite/R2, compteurs physiques bornés et aucune qualification',async()=>{
 const {env,sqlite}=await context(),at=Date.now()-10000;
 try{
  await recordCapture({capturedAt:at,lat:50.7567,lon:2.5204,models:[{modelName:'AROME',modelId:'fixture',hours:[{validAt:at+3600000,temperature:0},{validAt:at+7200000,temperature:3}]}]},env,'browser',at);
  const insert=sqlite.prepare('INSERT INTO weather_station_observations VALUES (?,?,?,?,?,?,?,?,?,?,?,0)');
  for(const [id,age,source] of [['recent',600000,'netatmo_browser_bridge'],['old',49*3600000,'netatmo_browser_bridge'],['future',-3600000,'netatmo_browser_bridge'],['other',300000,'other']])insert.run(id,'station',at-age,at,0,1,null,source,'[]','test','test');
  const body=await read(env);assert.ok(body.result,JSON.stringify(body.error));const data=body.result.data.json;
  assert.equal(data.archiveDiagnostics.forecastStatus,'verified');assert.equal(data.snapshot.hourlyModelCount,1);assert.equal(data.snapshot.dailyModelCount,null);
  assert.equal(data.archiveDiagnostics.observationIndex.measurements,1);assert.equal(data.archiveDiagnostics.observationIndex.stations,1);
  assert.equal(data.lastPhysicalCollection,null);assert.equal(data.hourlyModelCollectionAvailable,false);assert.equal(data.scheduledAt,null);
 }finally{sqlite.close();}
});
test('route AI Lab : une corruption du contenu ou une lecture SQL en panne ne devient pas une archive réussie',async()=>{
 const {env,sqlite,objects}=await context(),at=Date.now()-10000;
 try{
  await recordCapture({capturedAt:at,lat:50.7567,lon:2.5204,models:[{modelName:'AROME',hours:[{validAt:at+3600000,temperature:0}]}]},env,'browser',at);
  for(const key of objects.keys())objects.set(key,'altéré');
  const corrupt=(await read(env)).result.data.json;assert.equal(corrupt.archiveDiagnostics.forecastStatus,'integrity_error');assert.equal(corrupt.snapshot,null);
  sqlite.exec('DROP TABLE weather_captures');const failed=(await read(env)).result.data.json;
  assert.equal(failed.archiveDiagnostics.forecastStatus,'unavailable');assert.equal(failed.archiveDiagnostics.observationIndex.measurements,0);
 }finally{sqlite.close();}
});
test('route privée : pas d’identité ou lieu hors portée, aucune lecture de données locales',async()=>{
 const env={DB:{prepare(){throw Error('Lecture SQL interdite');}},BUCKET:{get(){throw Error('Lecture privée interdite');}}};
 const denied=await read(env,undefined,false);assert.equal(denied.error.json.data.code,'UNAUTHORIZED');
 const other=(await read(env,{lat:48.86,lon:2.35})).result.data.json;assert.equal(other.archiveDiagnostics.scope,'not_covered');assert.equal(other.snapshot,null);
});

test('rapprochement physique réel : SHA, index et échéance antérieure, sans score ni fuite de station',async()=>{
 const {env,sqlite}=await context(),slot=Math.floor(Date.now()/3600000)*3600000-3600000;
 try{
  await recordCapture({capturedAt:slot-1800000,lat:50.7567,lon:2.5204,models:[{modelName:'AROME',hours:[{validAt:slot,temperature:0}]}]},env,'browser',slot-1800000);
  await recordObservations({lat:50.7567,lon:2.5204,stations:[{id:'netatmo-integration',temp:0,time:slot+600000,distance:4}]},env,slot+900000);
  const first=(await read(env)).result.data.json,files=first.archiveDiagnostics.observationFiles;
  assert.equal(files.status,'verified');assert.equal(files.measurements,1);assert.equal(files.overlappingHours,1);assert.equal(files.forecastArchives,1);
  assert.equal(first.lastPhysicalCollection,null);assert.equal(first.scheduledAt,null);assert(!JSON.stringify(files).includes('stationKey'));
  sqlite.exec('UPDATE weather_station_observations SET distance=5');
  const altered=(await read(env)).result.data.json;
  assert.equal(altered.archiveDiagnostics.observationIndex.measurements,1);assert.equal(altered.archiveDiagnostics.observationFiles.measurements,0);assert.equal(altered.archiveDiagnostics.observationFiles.rejectedArchives,1);
 }finally{sqlite.close();}
});

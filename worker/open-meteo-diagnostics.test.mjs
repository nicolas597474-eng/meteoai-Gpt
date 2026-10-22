import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {build} from 'esbuild';
import worker from '../dist/server/index.js';
const built=await build({stdin:{contents:"export * from './worker/open-meteo-diagnostics';export * from './server/openMeteoTraffic';",resolveDir:process.cwd(),loader:'ts'},bundle:true,platform:'node',format:'esm',write:false});
const module=await import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].text).toString('base64'));
test('diagnostic persistant : pas de doublons, refus datés distincts, lecture seule et accès protégé',async()=>{
 const sqlite=new DatabaseSync(':memory:');
 sqlite.exec('CREATE TABLE weather_collection_status(channel TEXT PRIMARY KEY,attempted_at TEXT,status TEXT,message TEXT)');
 const env={DB:{prepare(sql){const stmt=sqlite.prepare(sql);let args=[];return {bind(...v){args=v;return this;},async run(){return stmt.run(...args);},async all(){return {results:stmt.all(...args)};},async first(){return stmt.get(...args)??null;}};}},METEOAI_BACKGROUND_ENABLED:'true'};
 const now=Date.now();
 const oldFetch=globalThis.fetch;let network=0;globalThis.fetch=async()=>{network++;throw Error('Aucun appel permis pendant la lecture');};
 try{
  module.observeOpenMeteo('https://api.open-meteo.com/v1/forecast?daily=x','network',429,false,now);
  await module.flushOpenMeteoTraffic(env,now);await module.flushOpenMeteoTraffic(env,now);
  let report=await module.readOpenMeteoDiagnostic(env,now);
  assert.equal(report.traffic.buckets.length,1);assert.equal(report.traffic.buckets[0].categories.daily.requests,1);
  module.observeOpenMeteo('https://api.open-meteo.com/v1/forecast?daily=x','network',200,false,now);
  await Promise.all([module.flushOpenMeteoTraffic(env,now),module.flushOpenMeteoTraffic(env,now)]);
  const insert=sqlite.prepare('INSERT INTO weather_collection_status VALUES (?,?,?,?)');
  insert.run('learning_open_meteo_limit_v1/forecast',new Date(now-1000).toISOString(),'rate_limited',JSON.stringify({version:1,period:'day',retryAt:now+3600000}));
  insert.run('learning_daily_collection_v1',new Date(now-1000).toISOString(),'ok',JSON.stringify({version:1,mode:'verified_hourly_cycles',models:['AROME','ARPEGE'],dates:['2026-10-22'],forecastApiStatus:429}));
  report=await module.readOpenMeteoDiagnostic(env,now);
  assert.equal(report.traffic.buckets[0].categories.daily.requests,2);assert.equal(report.traffic.buckets[0].categories.daily.rateLimited,1);assert.equal(report.limits[0].active,true);assert.deepEqual(report.daily.models,['AROME','ARPEGE']);assert.equal(network,0);
  const rows=sqlite.prepare('SELECT COUNT(*) n FROM weather_collection_status').get().n;
  const read=async(method,auth)=>worker.fetch(new Request('https://app.invalid/api/history/open-meteo-diagnostic',{method,headers:auth?{'oai-authenticated-user-id':'test'}:{}}),env,{waitUntil(p){p.catch(()=>{});}});
  assert.equal((await read('GET',false)).status,401);assert.equal((await read('POST',true)).status,405);
  const response=await read('GET',true);assert.equal(response.status,200);assert.equal((await response.json()).version,1);
  assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM weather_collection_status').get().n,rows);assert.equal(network,0);
 }finally{globalThis.fetch=oldFetch;sqlite.close();}
});

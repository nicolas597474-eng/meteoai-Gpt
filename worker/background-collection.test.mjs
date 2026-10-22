import {test} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {resolve} from 'node:path';
import {archiveTestContext} from './archive-test-context.mjs';
const built=await build({entryPoints:['worker/background-collection.ts'],bundle:true,platform:'node',format:'esm',write:false,plugins:[{name:'physical-kind',setup(b){b.onResolve({filter:/^\.\/stationService$/},a=>a.importer.endsWith('dailyForecastVerification.ts')?{path:resolve('worker/station-kind.ts')}:undefined);}}]});
const {handleBackgroundCollection,safeCollectionFailure,runCollection}=await import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].text).toString('base64'));
const key='c'.repeat(64),url='https://meteoai-restauree-controle.givingbay1.chatgpt.site/api/automation/hourly-collection';
const valid={observations:10,models:7,dailyModels:7,verified:true};
const request=(body='{}',extra={},method='POST')=>new Request(url,{method,headers:{'X-MeteoAI-Collector-Key':key,'Content-Type':'application/json',...extra},body:method==='POST'?body:undefined});
async function context(){const c=await archiveTestContext();Object.assign(c.env,{METEOAI_BACKGROUND_ENABLED:'true',METEOAI_COLLECTOR_KEY:key,METEOAI_BACKGROUND_OWNER:'a'.repeat(64)});return c;}

test('méthodes, clé, configuration et données clientes refusées avant toute écriture',async()=>{
 const c=await context();let calls=0;const ops={run:async()=>{calls++;},verify:async()=>valid};
 try{
  for(const [req,env,status] of [
   [request('{}',{},'GET'),c.env,405],
   [request(),{...c.env,METEOAI_BACKGROUND_ENABLED:'false'},503],
   [request('{}',{'X-MeteoAI-Collector-Key':'d'.repeat(64)}),c.env,403],
   [request('{}',{Origin:'https://intrus.invalid'}),c.env,403],
   [request('{}',{'Content-Type':'text/plain'}),c.env,403],
   [request('{'),c.env,400],[request('[]'),c.env,400],[request('null'),c.env,400],
   [request('{"owner":"other"}'),c.env,400],[request('{"date":"2020-01-01"}'),c.env,400],
   [request(' '.repeat(33)),c.env,413],
  ])assert.equal((await handleBackgroundCollection(req,env,Date.now(),ops)).status,status);
  assert.equal(calls,0);assert.equal(c.db.prepare('SELECT COUNT(*) AS n FROM weather_collection_status').get().n,0);
 }finally{c.db.close();}
});

test('acquittement seulement après relecture ; doublon vérifié sans relancer le réseau',async()=>{
 const c=await context();let runs=0,reads=0;const ops={run:async()=>{runs++;return {netatmo:'ok',learning:'ok'};},verify:async()=>{reads++;return valid;}};
 try{
  const first=await handleBackgroundCollection(request(),c.env,Date.now(),ops);assert.equal(first.status,200);assert.equal((await first.json()).status,'complete');
  const second=await handleBackgroundCollection(request(),c.env,Date.now(),ops);assert.equal(second.status,200);assert.equal((await second.json()).status,'duplicate');
  assert.equal(runs,1);assert.equal(reads,2);
 }finally{c.db.close();}
});

test('collecte partielle signalée comme telle, sans inventer de modèles ou de stations',async()=>{
 for(const evidence of [{...valid,models:3},{...valid,observations:0},{...valid,dailyModels:0},{...valid,dailyModels:2},{...valid,dailyModels:6},{...valid,verified:false}]){
  const c=await context();try{
   const response=await handleBackgroundCollection(request(),c.env,Date.now(),{run:async()=>({}),verify:async()=>evidence});
   assert.equal(response.status,207);const data=await response.json();assert.equal(data.status,'partial');assert.equal(data.models,evidence.models);
   assert.equal(c.db.prepare('SELECT status FROM weather_collection_status').get().status,'partial');
  }finally{c.db.close();}
 }
});

test('deux appels simultanés ne déclenchent qu’une collecte',async()=>{
 const c=await context();let runs=0;try{
  const ops={run:async()=>{runs++;await new Promise(r=>setTimeout(r,30));return {};},verify:async()=>valid};
  const responses=await Promise.all([handleBackgroundCollection(request(),c.env,Date.now(),ops),handleBackgroundCollection(request(),c.env,Date.now(),ops)]);
  assert.deepEqual(responses.map(r=>r.status).sort(),[200,409]);assert.equal(runs,1);
 }finally{c.db.close();}
});

test('un échec de persistance ne devient pas une réussite et le détail privé est expurgé',async()=>{
 const c=await context();try{
  const response=await handleBackgroundCollection(request(),c.env,Date.now(),{run:async()=>({}),verify:async()=>{throw Error('private fixture');}});
  assert.equal(response.status,503);assert(!JSON.stringify(await response.json()).includes('private'));
  assert.equal(c.db.prepare('SELECT status FROM weather_collection_status').get().status,'failed');
 }finally{c.db.close();}
});

test('un reçu ancien marqué réussi ne masque pas une archive devenue absente',async()=>{
 const c=await context();const at=new Date().toISOString();try{
  c.db.prepare('INSERT INTO weather_collection_status VALUES (?,?,?,?)').run('unattended_hourly_v1',at,'ok','fixture');
  const response=await handleBackgroundCollection(request(),c.env,Date.now(),{run:async()=>{throw Error('Ne pas rappeler en rafale');},verify:async()=>({...valid,observations:0})});
  assert.equal(response.status,409);assert.equal((await response.json()).status,'busy');
 }finally{c.db.close();}
});

test('les diagnostics de collecte ne divulguent jamais les détails bruts',()=>{
 assert.equal(safeCollectionFailure(Error('NETATMO_RATE_LIMIT')),'NETATMO_RATE_LIMIT');
 assert.equal(safeCollectionFailure(Error('private token fixture')),'COLLECTION_STORAGE_OR_PROVIDER_UNAVAILABLE');
 assert.equal(safeCollectionFailure(Object.assign(Error('private url'),{name:'TimeoutError'})),'PROVIDER_TIMEOUT');
});

test('une panne de références physiques ne bloque pas la collecte indépendante des prévisions',async()=>{
 const calls=[];
 const sources=await runCollection({}, {
  collectNetatmo:async()=>{calls.push('stations');return {};},
  recordObservations:async()=>{calls.push('archive-stations');},
  finalizeReferences:async()=>{calls.push('references');throw Error('private fixture');},
  refreshLearning:async()=>{calls.push('forecasts');return {collection:{status:'ok'}};},
 });
 assert.deepEqual(calls,['stations','archive-stations','references','forecasts']);
 assert.equal(sources.netatmo,'ok');assert.equal(sources.references,'unavailable');assert.equal(sources.learning,'ok');
 assert(!JSON.stringify(sources).includes('private fixture'));
});

test('une étape de collecte en échec n’est pas annoncée comme réussie parce que les archives restent lisibles',async()=>{
 for(const result of [{providerCollection:{status:'failed'}},{collection:{status:'failed'}},{qualification:{available:false}}]){
  const sources=await runCollection({}, {
   collectNetatmo:async()=>{throw Error('NETATMO_RATE_LIMIT');},
   recordObservations:async()=>assert.fail('Aucune mesure reçue'),
   finalizeReferences:async()=>({stored:0}),
   refreshLearning:async()=>result,
  });
  assert.equal(sources.netatmo,'unavailable');assert.equal(sources.netatmoFailure,'NETATMO_RATE_LIMIT');
  assert.equal(sources.references,'ok');assert.equal(sources.learning,'unavailable');
 }
});

import {test,mock} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {archiveTestContext} from './archive-test-context.mjs';
const bundle=await build({stdin:{contents:"export * from './worker/meteoai-receipt';export {readSigned} from './worker/learning-store';",resolveDir:process.cwd()},bundle:true,platform:'node',format:'esm',write:false,plugins:[{name:'station-kind',setup(b){b.onResolve({filter:/^\.\/stationService$/},a=>a.importer.endsWith('dailyForecastVerification.ts')?{path:resolve('worker/station-kind.ts')}:undefined);}}]});
await writeFile('qa/meteoai-receipt-test.mjs',bundle.outputFiles[0].text);const api=await import(pathToFileURL(resolve('qa/meteoai-receipt-test.mjs')).href);
const at=Date.parse('2026-10-22T06:00:00Z'),base={lat:50.7567,lon:2.5204,kind:'hourly',computedAt:new Date(at-1000).toISOString(),points:[{validAt:at+3600000,temp:12}]};
const req=(body=base,headers={},method='POST')=>new Request('https://meteoai.test/api/history/meteoai-forecast',{method,headers:{'oai-authenticated-user-id':'test-user','Content-Type':'application/json',Origin:'https://meteoai.test',...headers},...(method==='POST'?{body:JSON.stringify(body)}:{})});
async function context(){const c=await archiveTestContext();c.env.NETATMO_ENCRYPTION_KEY=Buffer.alloc(32,11).toString('base64');c.db.exec('CREATE TABLE IF NOT EXISTS weather_collection_status(channel TEXT PRIMARY KEY,attempted_at TEXT,status TEXT,message TEXT)');return c;}
test('réception téléphone : session, origine, taille, horloge et échéances contrôlées sans écriture invalide',async()=>{
 const c=await context();try{
  for(const [request,code] of [[req(base,{'oai-authenticated-user-id':''}),401],[req(base,{Origin:'https://other.test'}),403],[req(base,{},'GET'),405],[req({...base,computedAt:'2024-01-01'}),400],[req({...base,points:[...base.points,...base.points]}),400],[req({...base,points:[{validAt:at+1,temp:12}]}),400],[req({...base,points:[{validAt:at+3600000,temp:200}]}),400],[req(base,{'Content-Length':'80001'}),413]])assert.equal((await api.receiveMeteoAIForecast(request,c.env,at)).status,code);
  assert.equal(c.db.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE name='weather_meteoai_forecasts'").get().n,0);
 }finally{c.db.close();}
});
test('reçu serveur réel, origine application conservée, hors calibration, limite partagée et aucune donnée passée',async()=>{
 const c=await context(),clock=mock.method(Date,'now',()=>at);try{
  const response=await api.receiveMeteoAIForecast(req({...base,calibrationEligible:true,points:[{validAt:at-3600000,temp:69},...base.points]}),c.env,at);assert.equal(response.status,200);const receipt=await response.json();assert.equal(receipt.stored,true);assert.equal(receipt.calibrationEligible,false);
  const index=c.db.prepare('SELECT * FROM weather_meteoai_forecasts').get(),p=await api.readSigned(index,'runs',c.env);assert.equal(p.origin,'application');assert.equal(p.computedAt,at);assert.equal(index.available_at,at);assert.equal(p.calibrationEligible,false);assert.deepEqual(p.points.map(r=>r.temp),[12]);
  assert.equal((await api.receiveMeteoAIForecast(req(),c.env,at)).status,429);assert.equal(c.db.prepare('SELECT COUNT(*) n FROM weather_meteoai_forecasts').get().n,1);
 }finally{clock.mock.restore();c.db.close();}
});


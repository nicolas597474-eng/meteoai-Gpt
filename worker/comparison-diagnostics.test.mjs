import {test} from 'node:test';
import assert from 'node:assert/strict';
import {archiveTestContext,recordCapture,recordObservations} from './archive-test-context.mjs';
import worker from '../dist/server/index.js';
async function read(env,coords={lat:50.7567,lon:2.5204},signed=true){
 const url=new URL('https://controle.example/api/trpc/weather.getHourlyComparisonDiagnostics');url.searchParams.set('input',JSON.stringify({json:coords}));
 const response=await worker.fetch(new Request(url,{headers:signed?{'oai-authenticated-user-id':'diagnostics-local-test'}:{}}),env,{waitUntil(){}});return response.json();
}
test('diagnostic AI Lab privé : aucun accès hors lieu ou sans identité',async()=>{
 const env={DB:{prepare(){throw Error('Lecture privée interdite');}},BUCKET:{get(){throw Error('Lecture privée interdite');}}};
 assert.equal((await read(env,undefined,false)).error.json.data.code,'UNAUTHORIZED');
 const other=(await read(env,{lat:48.86,lon:2.35})).result.data.json;assert.equal(other.scope,'not_covered');assert.equal(other.summary,null);assert.deepEqual(other.diagnostics,[]);
});
test('entonnoir réel sur archives vérifiées et calcul original, sans faux cycle ni identifiant station',async()=>{
 const {env,db,objects}=await archiveTestContext(),slot=Math.floor(Date.now()/3600000)*3600000-3600000;
 try{
  const at=slot-3*3600000;
  await recordCapture({capturedAt:at,lat:50.7567,lon:2.5204,models:[{modelName:'AROME',hours:[{validAt:slot,temperature:15}]}]},env,'browser',at);
  await recordObservations({lat:50.7567,lon:2.5204,stations:Array.from({length:3},(_,i)=>({id:'netatmo-qa-'+i,temp:14,time:slot+20*60000,distance:1+i}))},env,slot+25*60000);
  const before=[objects.size,db.prepare('SELECT COUNT(*) AS n FROM weather_captures').get().n,db.prepare('SELECT COUNT(*) AS n FROM weather_station_observations').get().n];
  const result=(await read(env)).result.data.json;
  assert.equal(result.kind,'exploratory_archive_read');assert.equal(result.cycleDate,'7 jours');assert.equal(result.summary.comparisons,1);assert.equal(result.summary.referenceHours,1);
  assert.equal(result.diagnostics.length,1);assert.equal(result.diagnostics[0].retainedComparisons,1);assert.equal(result.diagnostics[0].archivedForecasts,1);
  assert(!JSON.stringify(result).includes('stationKey'));assert(!JSON.stringify(result).includes('netatmo-qa'));assert(!('scores' in result));
  assert.deepEqual([objects.size,db.prepare('SELECT COUNT(*) AS n FROM weather_captures').get().n,db.prepare('SELECT COUNT(*) AS n FROM weather_station_observations').get().n],before);
  db.exec('DROP TABLE weather_station_observations');assert.ok((await read(env)).error);
 }finally{db.close();}
});

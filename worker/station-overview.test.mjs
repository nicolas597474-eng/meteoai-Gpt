import {test} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {writeFile,readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {archiveTestContext} from './archive-test-context.mjs';
import worker from '../dist/server/index.js';
const bundle=await build({stdin:{contents:"export * from './worker/station-overview';export * from './worker/server-observations';",resolveDir:process.cwd()},bundle:true,platform:'node',format:'esm',write:false,plugins:[{name:'pure-station-kind',setup(b){b.onResolve({filter:/^\.\/stationService$/},a=>['dailyForecastVerification.ts','stationPerformanceService.ts'].some(n=>a.importer.endsWith(n))?{path:resolve('worker/station-kind.ts')}:undefined);}}]});
await writeFile('qa/station-overview-test-bundle.mjs',bundle.outputFiles[0].text);
const api=await import(pathToFileURL(resolve('qa/station-overview-test-bundle.mjs')).href);
const now=Date.parse('2026-10-20T08:00:00Z'),coords={lat:50.7567,lon:2.5204,radiusKm:50},HOUR=3600000;
test('les vrais lots serveur fournissent les relevés conservés sans inventer de score ni antidater les données courantes',async()=>{
 const c=await archiveTestContext();c.db.exec(await readFile('drizzle/0006_young_marvel_zombies.sql','utf8'));try{
  const live={stations:[{stationId:'netatmo-test',lat:coords.lat,lon:coords.lon,name:'Station test',isActive:true,temperature:99}],fetchedAt:new Date(now).toISOString()};
  for(const offset of [2,30]){
   const receivedAt=now-offset*HOUR;
   await api.recordServerObservations({...coords,providerReceivedAt:receivedAt,stations:[{id:'netatmo-test',temp:0,humidity:0,time:receivedAt-60000,distance:10,anomaly:false}]},c.env,receivedAt);
  }
  const changes=c.db.prepare('SELECT total_changes() AS n').get().n,objects=c.objects.size;
  const history=await api.readServerObservations(c.env,now);
  const day=await api.buildStationOverview({...coords,periodDays:1},live,history,now);
  const week=await api.buildStationOverview({...coords,periodDays:7},live,history,now);
  assert.equal(day.stations.length,1);assert.equal(day.stations[0].readings.length,1);assert.equal(week.stations[0].readings.length,2);
  assert.equal(day.stations[0].latest.temperature,0);assert.equal(day.stations[0].latest.humidity,0);
  assert.equal(day.stations[0].latest.observedAt,now-2*HOUR-60000);assert.equal(day.stations[0].stationPerformance.status,'non_mesuree');assert.equal(day.stations[0].stationPerformance.variables.temperature.estimate,null);
  assert.equal(day.comparison24h.length,24);assert(day.comparison24h.every(p=>p.officialTemperature===null));assert.equal(day.instantDeltaC,null);assert.equal(day.archiveStatus.status,'verified');
  const narrow=await api.buildStationOverview({...coords,radiusKm:5},live,history,now);assert.equal(narrow.stations[0].readings.length,0);
  assert.equal(c.objects.size,objects);assert.equal(c.db.prepare('SELECT total_changes() AS n').get().n,changes);
  assert(!JSON.stringify(day).includes('stationKey'));
 }finally{c.db.close();}
});
test('la route interdit les archives sans identité, refuse une période invalide et masque les erreurs SQL',async()=>{
 const env={DB:{prepare(){throw Error('SQL privé interdit');}},BUCKET:{get(){throw Error('Coffre privé interdit');}}};
 const response=async(input,headers={})=>{
  const url=new URL('https://test.example/api/trpc/weather.getStationReliabilityOverview');url.searchParams.set('input',JSON.stringify({json:input}));
  return (await (await worker.fetch(new Request(url,{headers}),env,{waitUntil(){}})).json());
 };
 const empty=await response({...coords,periodDays:1});assert.deepEqual(empty.result.data.json.stations,[]);assert.equal(empty.result.data.json.archiveStatus.status,'unavailable');
 const invalid=await response({...coords,periodDays:30});assert.match(invalid.error.json.message,/Période/);
 const failed=await response({...coords,periodDays:1},{'oai-authenticated-user-id':'fixture-owner'});
 assert.equal(failed.result.data.json.archiveStatus.status,'unavailable');assert(!JSON.stringify(failed).includes('SQL privé'));
});

test('les deux lectures simultanées partagent une panne sans fuite technique et la prochaine lecture réessaie',async()=>{
 let attempts=0;
 const env={DB:{prepare(){attempts++;throw Error('Panne SQL confidentielle');}},BUCKET:{}};
 const request=new Request('https://test.example/api/trpc/weather.getStationReliabilityOverview',{headers:{'oai-authenticated-user-id':'fixture-owner'}});
 const [day,week]=await Promise.all([api.readStationOverview({...coords,periodDays:1},request,env,now),api.readStationOverview({...coords,periodDays:7},request,env,now)]);
 assert.equal(attempts,2,'Une tentative pour chaque stockage, partagée par les deux lecteurs');
 assert.equal(day.comparisonStatus,'unavailable');assert.equal(week.comparisonStatus,'unavailable');assert(!JSON.stringify([day,week]).includes('SQL confidentielle'));
 await api.readStationOverview(coords,request,env,now+1);assert.equal(attempts,4,'La panne ne reste pas cinq minutes en cache');
});

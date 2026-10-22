import {test} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {resolve} from 'node:path';
const built=await build({entryPoints:['shared/localDashboardWeather.ts'],bundle:true,platform:'node',format:'esm',write:false,plugins:[{name:'pure-stations',setup(b){b.onResolve({filter:/^\.\/stationService$/},()=>({path:resolve('worker/station-kind.ts')}));}}]});
const {buildLocalDashboardWeather:call}=await import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].text).toString('base64'));
const lat=50.7567,lon=2.5204;
const row=(id,km,temp=10,age=5,elevation=null)=>({id:'netatmo-'+id,name:id,lat:lat+km/111.195,lon,temp,time:Date.now()-age*60000,elevation,anomaly:false,distance:0,reliability:100});
const input=(rows,extra={})=>({lat,lon,localMode:'ultra-local',rows,snapshot:null,referenceElevation:null,...extra});
const snapshot=(temp,age=5)=>({temp,capturedAt:new Date(Date.now()-age*60000).toISOString(),source:'open-meteo',sourceKind:'model_current_snapshot'});

test('Ultra-local : distance réelle, fraîcheur par mesure et anomalies filtrées',()=>{
 const data=call(input([row('proche',1),row('loin',11),row('ancien',1,10,35),{...row('anomalie',1),anomaly:true},row('futur',1,10,-60)]));
 assert.equal(data.ultraLocal.stationCount,1);assert.equal(data.ultraLocal.stationsUsed[0].stationId,'netatmo-proche');assert.equal(data.ultraLocal.temperature,10);
 assert.equal(data.ultraLocal.confidenceScore,null);assert.equal(data.ultraLocal.stationsIgnored.length,4);
 assert.equal(data.ultraLocal.humidity,null);assert.equal(data.ultraLocal.pressure,null);assert.equal(data.ultraLocal.windSpeed,null);assert.equal(data.ultraLocal.precipitation,null);
 assert.equal(data.ultraLocal.altitudeCorrection.applied,false);assert.deepEqual(data.ultraLocal.microclimateFactors,[]);
});
test('Local et Ultra-local reprennent les bandes et contrôles distincts du moteur original',()=>{
 const rows=[row('a',1,10),row('b',4,11),row('c',8,12),row('d',15,13),row('zone-elargie',25,14),row('recherche-50',45,15),row('hors-recherche',55,16),row('trente-cinq-min',3,11,35)];
 const local=call(input(rows,{localMode:'local',snapshot:snapshot(12)}));const ultra=call(input(rows,{snapshot:snapshot(12)}));
 assert.equal(local.ultraLocal.stationCount,6);assert.equal(ultra.ultraLocal.stationCount,3);
 assert.deepEqual(ultra.ultraLocal.bandBreakdown.map(b=>b.stationCount),[1,1,1]);assert.equal(local.ultraLocal.bandBreakdown.at(-1).stationCount,1);
 assert.equal(local.coverage.providerRadiusKm,50);assert.equal(local.coverage.modeRadiusKm,30);assert.equal(ultra.coverage.modeRadiusKm,10);
 for(const data of [local,ultra]){
  const sum=data.ultraLocal.stationsUsed.reduce((s,r)=>s+r.weight,0)+data.ultraLocal.modelWeight;assert(Math.abs(sum-1)<.004);
  assert.equal(data.ultraLocal.modelContribution,12);assert.equal(data.currentObservation.source,'local_validated');assert.equal(data.ultraLocal.microclimateAdjustment,0);
 }
});
test('zéro réel conservé ; aucun snapshot expiré ou futur transformé en observation',()=>{
 const zero=call(input([row('zero',1,0)]));assert.equal(zero.ultraLocal.temperature,0);assert.equal(zero.currentObservation.temperature,0);
 const fallback=call(input([],{snapshot:snapshot(0),stationError:'Service indisponible'}));assert.equal(fallback.ultraLocal.temperature,0);assert.equal(fallback.ultraLocal.usesOfficialFallback,true);assert.equal(fallback.currentObservation,null);assert.equal(fallback.netatmo.status,'error');assert.equal(fallback.ultraLocal.modelWeight,0);
 for(const age of [60,-10]){const empty=call(input([],{snapshot:snapshot(12,age)}));assert.equal(empty.ultraLocal.temperature,null);assert.equal(empty.currentObservation,null);}
});
test('altitude corrigée uniquement avec altitude cible et altitude station explicites',()=>{
 const rows=[row('altitude',1,10,5,140)];
 const unknown=call(input(rows));assert.equal(unknown.ultraLocal.temperature,10);assert.equal(unknown.ultraLocal.altitudeCorrection.reason,'reference_altitude_unavailable');
 const known=call(input(rows,{referenceElevation:40}));assert.equal(known.ultraLocal.altitudeCorrection.applied,true);assert.equal(known.ultraLocal.temperature,10.7);
 const higher=call(input([row('plus-bas',1,10,5,40)],{referenceElevation:140}));assert.equal(higher.ultraLocal.temperature,9.4);
 assert.equal(call(input([row('inconnue',1)],{referenceElevation:40})).ultraLocal.altitudeCorrection.applied,false);
});
test('provenance temporelle issue uniquement des stations admises ; date invalide ignorée',()=>{
 const good=row('bonne',1,10,10),bad=row('date-invalide',1);bad.time=1e30;
 const data=call(input([good,bad,row('hors-rayon',15,10,1)]));assert.equal(data.currentObservation.observedAt,new Date(good.time).toISOString());assert.equal(data.ultraLocal.stationCount,1);
});

test('cache Netatmo partagé : requêtes simultanées et bascules de mode ne multiplient pas les appels',async()=>{
 const module=await build({entryPoints:['client/src/lib/netatmoStations.ts'],bundle:true,platform:'node',format:'esm',write:false});
 const {getNetatmoStations}=await import('data:text/javascript;base64,'+Buffer.from(module.outputFiles[0].text).toString('base64'));
 const original=globalThis.fetch;let calls=0;globalThis.fetch=async url=>{assert.equal(new URL(url,'https://meteo.example').searchParams.get('radiusKm'),'50');calls++;return Response.json({radiusKm:50,stations:[row('cache',1),{...row('eloignee',45),distance:45}]});};
 try{const results=await Promise.all([getNetatmoStations(lat,lon),getNetatmoStations(lat,lon)]);assert.equal(calls,1);assert.equal(results[0].length,2);await getNetatmoStations(lat,lon);assert.equal(calls,1);await getNetatmoStations(lat+.1,lon);assert.equal(calls,2);}finally{globalThis.fetch=original;}
});

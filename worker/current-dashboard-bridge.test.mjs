import {test} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
const output=join(mkdtempSync(join(tmpdir(),'meteo-current-')),'current.mjs');
await build({stdin:{contents:"export {collectCurrentDashboardWeather} from './client/src/lib/currentDashboardWeather'; export {getNetatmoStations} from './client/src/lib/netatmoStations';",resolveDir:process.cwd()},outfile:output,bundle:true,format:'esm',platform:'browser',plugins:[{name:'pure-stations',setup(b){b.onResolve({filter:/^\.\/stationService$/},()=>({path:resolve('worker/station-kind.ts')}));}}]});
let index=0;const load=()=>import(pathToFileURL(output).href+'?case='+index++);
const coords={lat:50.757,lon:2.52};
const station=(extra={})=>({id:'netatmo-real-shape',name:'Station de test',lat:50.757,lon:2.521,temp:12,distance:1,time:Date.now()-5*60000,reliability:95,elevation:40,anomaly:false,...extra});
const snapshot=()=>({sourceKind:'model_current_snapshot',source:'open-meteo',capturedAt:new Date().toISOString(),elevationM:40,temp:20,apparentTemp:18,precipitation:0,windSpeed:7,windGust:10,windDirection:180,cloudCover:20,humidity:60,weatherCode:1,condition:'Peu nuageux'});
async function withNetwork(fn,run){const original=globalThis.fetch;globalThis.fetch=fn;try{return await run();}finally{globalThis.fetch=original;}}

test('Dashboard et Stations partagent une collecte, avec température physique et autres champs du snapshot séparés',async()=>{
 const m=await load();let calls=0;
 await withNetwork(async()=>{calls++;return Response.json({radiusKm:50,stations:[station()],expiresAt:Date.now()+600000});},async()=>{
  const [state,rows]=await Promise.all([m.collectCurrentDashboardWeather(coords,Promise.resolve(snapshot())),m.getNetatmoStations(coords.lat,coords.lon)]);
  assert.equal(calls,1);assert.equal(rows.length,1);assert.equal(state.fields.temperature.value,12);assert.equal(state.fields.temperature.provenance.kind,'physical_stations');assert.equal(state.fields.temperature.provenance.stationCount,1);assert.equal(state.fields.apparentTemperature.value,18);assert.equal(state.fields.apparentTemperature.provenance.kind,'open_meteo_snapshot');assert.equal(state.fields.windSpeed.value,7);assert.equal(state.fields.pressure.value,null);assert.equal(state.fields.temperature.observations,undefined);
 });
});
test('sans snapshot, une altitude DEM réelle débloque uniquement la mesure physique ; aucun ressenti ni prévision créé',async()=>{
 const m=await load();let elevationCalls=0;
 await withNetwork(async url=>String(url).includes('/v1/elevation')?(elevationCalls++,Response.json({elevation:[40]})):Response.json({radiusKm:50,stations:[station()],expiresAt:Date.now()+600000}),async()=>{
  const state=await m.collectCurrentDashboardWeather(coords,Promise.resolve(null));assert.equal(elevationCalls,1);assert.equal(state.fields.temperature.value,12);assert.equal(state.fields.temperature.provenance.kind,'physical_stations');assert.match(state.fields.temperature.provenance.reason,/Copernicus/);for(const key of ['apparentTemperature','precipitation','humidity','windSpeed','condition'])assert.equal(state.fields[key].value,null);
 });
});
test('sans altitude vérifiable, aucune agrégation de température physique n’est inventée',async()=>{
 const m=await load();await withNetwork(async url=>String(url).includes('/v1/elevation')?new Response('',{status:503}):Response.json({radiusKm:50,stations:[station()],expiresAt:Date.now()+600000}),async()=>{
  const state=await m.collectCurrentDashboardWeather(coords,Promise.resolve(null));assert.equal(state.fields.temperature.value,null);assert.equal(state.fields.temperature.provenance.kind,'unavailable');assert.match(state.fields.temperature.provenance.reason,/Altitude/);
 });
});
test('anomalies, données anciennes, coordonnées lointaines et altitude absente ne remplacent jamais un zéro modèle valide',async()=>{
 for(const change of [{anomaly:true},{time:Date.now()-4*3600000},{time:Date.now()+3600000},{lat:40,lon:2},{elevation:null}]){
  const m=await load();await withNetwork(async()=>Response.json({radiusKm:50,stations:[station(change)],expiresAt:Date.now()+600000}),async()=>{
   const state=await m.collectCurrentDashboardWeather(coords,Promise.resolve({...snapshot(),temp:0}));assert.equal(state.fields.temperature.value,0);assert.equal(state.fields.temperature.provenance.kind,'open_meteo_snapshot');assert.equal(state.fields.precipitation.value,0);
  });
 }
});
test('une panne Netatmo conserve le snapshot sans transformer un modèle en station',async()=>{
 const m=await load();await withNetwork(async()=>Response.json({error:'Indisponible'},{status:503}),async()=>{const state=await m.collectCurrentDashboardWeather(coords,Promise.resolve(snapshot()));assert.equal(state.fields.temperature.value,20);assert.equal(state.fields.temperature.provenance.kind,'open_meteo_snapshot');assert.equal(state.fields.temperature.provenance.stationCount,0);});
});
test('Hondeghem utilise sa référence DEM vérifiée sans nouvelle requête d’altitude',async()=>{
 const m=await load();let calls=0;await withNetwork(async url=>{calls++;assert(!String(url).includes('/v1/elevation'));return Response.json({radiusKm:50,stations:[station({elevation:44})],expiresAt:Date.now()+600000});},async()=>{const state=await m.collectCurrentDashboardWeather({lat:50.7567,lon:2.5204},Promise.resolve(null));assert.equal(calls,1);assert.equal(state.fields.temperature.value,12);assert.equal(state.fields.temperature.provenance.kind,'physical_stations');assert.match(state.fields.temperature.provenance.reason,/44 m/);});
});

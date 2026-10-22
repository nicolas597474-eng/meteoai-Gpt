import {archiveTestContext,recordCapture,recordObservations} from './archive-test-context.mjs';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {build} from 'esbuild';
import {DatabaseSync} from 'node:sqlite';
const output=join(mkdtempSync(join(tmpdir(),'meteo-comparisons-')),'comparisons.mjs');
await build({entryPoints:['worker/provisional-comparisons.ts'],outfile:output,bundle:true,format:'esm',platform:'browser'});
const {buildProvisionalComparisons,readProvisionalComparisons}=await import(pathToFileURL(output).href);
const slot=Date.parse('2026-10-17T12:00:00Z'),now=slot+65*60000;
const measurements=()=>Array.from({length:3},(_,i)=>({station_key:'station-'+i,measured_at:slot+(20+i*5)*60000,received_at:slot+35*60000,temperature:14,distance:i+1,elevation:30,source:'netatmo_browser_bridge',quality_flags:'[]'}));
const capture=(receivedAt=slot-3*3600000,value=15)=>({id:'capture-'+receivedAt,receivedAt,payload:{kind:'forecast',location:'50.757_2.520',capturedAt:receivedAt,models:[{modelName:'AROME',modelId:'meteofrance_arome_france',availableAt:receivedAt,requestStartedAt:receivedAt,hours:[{validAt:slot,temperature:value}]}]}});
test('raccordement avec le moteur original : référence à trois stations et écart exact, sans classement ni calibration',()=>{const r=buildProvisionalComparisons([capture()],measurements(),now);assert.equal(r.comparisonCount,1);assert.equal(r.details[0].observed,14);assert.equal(r.details[0].forecast,15);assert.equal(r.details[0].error,1);assert.equal(r.details[0].stations,3);assert.equal(r.models[0].mae,null);assert.equal(r.officialRanking,false);assert.equal(r.calibration,'not_active');});
test('aucune comparaison sur un créneau en cours ni avec moins de trois stations',()=>{const pending=buildProvisionalComparisons([capture()],measurements(),slot+45*60000);assert.equal(pending.comparisonCount,0);assert.equal(pending.pendingReferenceHours,1);assert.equal(buildProvisionalComparisons([capture()],measurements().slice(0,2),now).comparisonCount,0);});
test('pas de fuite temporelle : la réception serveur et les règles strictes de disponibilité restent prioritaires',()=>{for(const availability of [slot,slot+25*60000]){const c=capture(availability);c.payload.capturedAt=slot-6*3600000;c.payload.models[0].availableAt=slot-6*3600000;assert.equal(buildProvisionalComparisons([c],measurements(),now).comparisonCount,0);}});
test('contrôle spatial original, alertes de qualité et dernières mesures par station',()=>{const m=measurements();m.push({...m[0],measured_at:slot+10*60000,temperature:40});m.push({...m[1],station_key:'loin',distance:25});m.push({...m[1],station_key:'incoherent',temperature:40});m.push({...m[2],station_key:'alerte',quality_flags:'["source_flagged"]'});const r=buildProvisionalComparisons([capture()],m,now);assert.equal(r.comparisonCount,1);assert.equal(r.details[0].observed,14);assert.equal(r.details[0].stations,3);assert.equal(r.excludedMeasurements,3);});
test('dernier run admissible par échéance, puis séparation des horizons sans doubler les observations',()=>{
 const far=capture(slot-8*3600000,16),near=capture(slot-3*3600000,15);
 const one=buildProvisionalComparisons([capture(slot-5*3600000,20),near,far],measurements(),now);
 assert.equal(one.comparisonCount,1);assert.equal(one.details[0].forecast,15);
 far.payload.models[0].hours.push({validAt:slot+3600000,temperature:16});
 const m=[...measurements(),...measurements().map(o=>({...o,measured_at:o.measured_at+3600000,received_at:o.received_at+3600000}))];
 const r=buildProvisionalComparisons([near,far],m,now+3600000);
 assert.equal(r.comparisonCount,2);assert.equal(r.models.length,2);assert.deepEqual(r.details.map(d=>d.forecast).sort(),[15,16]);assert(r.models.every(m=>m.comparisons===1&&m.mae===null));
});
async function seed(env,age=0){
 const delta=age*86400000,at=slot-3*3600000-delta;
 await recordCapture({capturedAt:at,lat:50.7567,lon:2.5204,models:[{modelName:'AROME',hours:[{validAt:slot-delta,temperature:15}]}]},env,'browser',at);
 await recordObservations({lat:50.7567,lon:2.5204,stations:measurements().map((m,i)=>({id:'netatmo-fixture-'+i,temp:m.temperature,time:m.measured_at-delta,distance:m.distance,elevation:m.elevation}))},env,slot+35*60000-delta);
}
test('les fichiers physiques et prévisions corrompus sont exclus, sans écriture de contrôle',async()=>{
 const {env,db,objects}=await archiveTestContext();try{
  await seed(env);for(const key of objects.keys())if(key.startsWith('history/captures/'))objects.set(key,'altéré');
  let r=await readProvisionalComparisons(env,now);assert.equal(r.rejectedArchives,1);assert.equal(r.comparisonCount,0);assert.equal(r.measurementsRead,3);
  db.exec('UPDATE weather_station_observations SET distance=5');r=await readProvisionalComparisons(env,now);assert.equal(r.integrity.rejectedPhysicalFiles,1);assert.equal(r.measurementsRead,0);assert.equal(r.comparisonCount,0);
 }finally{db.close();}
});
test('les fenêtres 7, 14 et 30 jours relisent les vrais writers et leurs fichiers, sans mélange de périodes',async()=>{
 const {env,db}=await archiveTestContext();try{
  for(const age of [2,10,20,40])await seed(env,age);
  for(const [days,expected] of [[7,1],[14,2],[30,3]]){
   const r=await readProvisionalComparisons(env,now,days);assert.equal(r.windowDays,days);assert.equal(r.comparisonCount,expected);assert.equal(r.capturesRead,expected);assert.equal(r.measurementsRead,expected*3);assert.equal(r.rejectedArchives,0);assert.equal(r.boundedRead,false);assert.equal(r.calibration,'not_active');
  }
 }finally{db.close();}
});
test('des captures récentes postérieures ne masquent plus les prévisions antérieures aux mesures',async()=>{
 const {env,db}=await archiveTestContext();try{
  await seed(env);
  for(let i=0;i<12;i++){const at=slot+(40+i)*60000;await recordCapture({capturedAt:at,lat:50.7567,lon:2.5204,models:[{modelName:'AROME',hours:[{validAt:slot+3600000,temperature:30}]}]},env,'browser',at);}
  const result=await readProvisionalComparisons(env,now);assert.equal(result.comparisonCount,1);assert.equal(result.details[0].forecast,15);assert.equal(result.capturesRead,1);assert.equal(result.diagnostics[0].retainedComparisons,1);
 }finally{db.close();}
});
test('une panne de lecture physique reste une erreur au lieu d’un compteur nul',async()=>{
 const env={DB:{prepare(){throw Error('Base indisponible');}}};await assert.rejects(readProvisionalComparisons(env,now),/indisponible/);
});

test('même avec un échantillon plus mûr, les statistiques restent exploratoires et ne réactivent pas la calibration',()=>{const c=[],m=[];for(let i=0;i<21;i++){const x=capture(slot+(i-3)*3600000,15);x.payload.models[0].hours[0].validAt=slot+i*3600000;c.push(x);m.push(...measurements().map(o=>({...o,measured_at:o.measured_at+i*3600000,received_at:o.received_at+i*3600000})));}const r=buildProvisionalComparisons(c,m,now+21*3600000);assert.equal(r.models[0].comparisons,21);assert.equal(r.models[0].mae,1);assert.equal(r.models[0].rmse,1);assert.equal(r.models[0].bias,1);assert.equal(r.models[0].officialRanking,false);assert.equal(r.calibration,'not_active');});

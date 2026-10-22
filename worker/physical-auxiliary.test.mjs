import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {build} from 'esbuild';
import {archiveTestContext} from './archive-test-context.mjs';
const built=await build({entryPoints:['worker/server-observations.ts'],bundle:true,platform:'node',format:'esm',write:false});
const api=await import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].text).toString('base64'));
const now=Date.parse('2026-10-20T16:08:00Z');
const input=()=>({lat:50.7567,lon:2.5204,radiusKm:50,providerReceivedAt:now,stations:[0,1,2].map(i=>({id:'netatmo-aux-'+i,temp:10,humidity:70,time:now-60000,distance:i+1,elevation:null,anomaly:false,pressure:1007,windSpeed:0,windGust:0,precipitation:0,precipitationPeriodMinutes:60,measurementTimes:{pressure:now-120000,windSpeed:now-180000,windGust:now-180000,precipitation:now-240000}}))});
async function context(){const c=await archiveTestContext();c.db.exec(await readFile('drizzle/0006_young_marvel_zombies.sql','utf8'));return c;}
test('archives v3 : zéro et horodatage propre à chaque grandeur ; aucune qualification implicite',async()=>{
 const c=await context();try{
  const v=input();v.stations[1].measurementTimes.windGust=now+1;v.stations[2].precipitationPeriodMinutes=1440;
  await api.recordServerObservations(v,c.env,now);const result=await api.readServerObservations(c.env,now),row=result.rows[0];
  assert.equal(row.auxiliary.windSpeed.value,0);assert.equal(row.auxiliary.precipitation.value,0);assert.equal(row.auxiliary.precipitation.periodMinutes,60);assert.equal(row.auxiliary.pressure.measuredAt,now-120000);assert.equal(row.auxiliary.pressure.basis,'mean_sea_level');
  assert.equal(result.auxiliaryCoverage.windGust,2);assert.equal(result.auxiliaryCoverage.precipitation,2);assert.equal(result.rejectedArchives,0);
  const stored=JSON.parse([...c.objects.values()][0]);assert.equal(stored.calibrationEligible,false);assert.equal(stored.version,3);
 }finally{c.db.close();}
});
test('les anciennes archives v2 restent lisibles sans ajout rétrospectif de champs',async()=>{
 const c=await context();try{
  await api.recordServerObservations(input(),c.env,now);const index=c.db.prepare('SELECT * FROM weather_server_observations').get(),p=JSON.parse(c.objects.get(index.object_key));p.version=2;p.rows.forEach(row=>delete row.auxiliary);
  const text=JSON.stringify(p),digest=createHash('sha256').update(text).digest('hex'),key='history/server-observations/'+digest+'.json';c.objects.set(key,text);c.db.prepare('UPDATE weather_server_observations SET digest=?,object_key=?').run(digest,key);
  const result=await api.readServerObservations(c.env,now);assert.equal(result.status,'verified');assert.equal(result.rows.length,3);assert.equal(result.rows[0].humidity,70);assert.equal(result.rows[0].auxiliary,undefined);assert.equal(result.auxiliaryCoverage.windSpeed,0);
 }finally{c.db.close();}
});

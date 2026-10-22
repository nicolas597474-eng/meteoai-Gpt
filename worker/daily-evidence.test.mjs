import {test} from 'node:test';
import assert from 'node:assert/strict';
import {archiveTestContext,recordObservations} from './archive-test-context.mjs';
import worker from '../dist/server/index.js';
async function read(env,input={lat:50.7567,lon:2.5204},signed=true){
 const url=new URL('https://controle.example/api/trpc/weather.getEvidenceStatus');url.searchParams.set('input',JSON.stringify({json:input}));
 return (await worker.fetch(new Request(url,{headers:signed?{'oai-authenticated-user-id':'daily-local-test'}:{}}),env,{waitUntil(){}})).json();
}
test('preuve quotidienne : contrôle privé et absence de réemploi des données pour un autre lieu',async()=>{
 const env={DB:{prepare(){throw Error('Lecture privée interdite');}},BUCKET:{get(){throw Error('Lecture privée interdite');}}};
 assert.equal((await read(env,undefined,false)).error.json.data.code,'UNAUTHORIZED');
 const other=(await read(env,{lat:48.86,lon:2.35})).result.data.json;assert.equal(other.dailyCoverage.scope,'not_covered');assert.equal(other.date,null);assert.equal(other.coverageHours,null);assert.equal(other.qualifiedScoreCount,null);assert.equal(other.isEligible,false);
});
test('18 heures réelles des writers : seuil candidat atteint sans créer de score ou de qualification officielle',async()=>{
 const {env,db,objects}=await archiveTestContext();
 try{
  const now=Date.now(),date=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Paris'}).format(new Date(now-48*3600000));
  // À partir de 03 h UTC : évite l’heure locale ambiguë, tout en gardant 18 heures sur la même date.
  const start=Date.parse(date+'T03:00:00Z');
  for(let hour=0;hour<18;hour++){
   const slot=start+hour*3600000;
   await recordObservations({lat:50.7567,lon:2.5204,stations:Array.from({length:3},(_,i)=>({id:'netatmo-daily-'+i,temp:0,time:slot+10*60000,distance:i+1}))},env,slot+20*60000);
  }
  const before=objects.size,first=(await read(env)).result.data.json;
  assert.equal(first.dailyCoverage.filesChecked,18);assert.equal(first.dailyCoverage.measurementsVerified,54);assert.equal(first.dailyCoverage.days.length,1);
  assert.equal(first.dailyCoverage.days[0].usableHours,18);assert.equal(first.dailyCoverage.days[0].thresholdMet,true);assert.equal(first.dailyCoverage.days[0].closedDay,true);
  assert.equal(first.isEligible,false);assert.equal(first.qualifiedScoreCount,null);assert.equal(first.date,null);assert.equal(objects.size,before);assert(!JSON.stringify(first).includes('stationKey'));
  db.exec('UPDATE weather_station_observations SET distance=48 WHERE rowid=(SELECT MIN(rowid) FROM weather_station_observations)');
  const changed=(await read(env)).result.data.json;assert.equal(changed.dailyCoverage.filesRejected,1);assert.equal(changed.dailyCoverage.days[0].usableHours,17);assert.equal(changed.dailyCoverage.days[0].thresholdMet,false);
  db.exec('DROP TABLE weather_station_observations');assert.ok((await read(env)).error);
 }finally{db.close();}
});

test('la limite quotidienne de 24 fichiers reste explicite et borne réellement les lectures',async()=>{
 const {env,db}=await archiveTestContext();try{
  const slot=Math.floor(Date.now()/3600000)*3600000-2*3600000;
  for(let i=0;i<25;i++)await recordObservations({lat:50.7567,lon:2.5204,stations:Array.from({length:3},(_,station)=>({id:'netatmo-bound-'+station,temp:10,time:slot+10*60000+i*1000,distance:station+1}))},env,slot+20*60000+i*1000);
  let reads=0;const get=env.BUCKET.get;env.BUCKET.get=async key=>{reads++;return get(key);};
  const result=(await read(env)).result.data.json;
  assert.equal(result.dailyCoverage.filesLimit,24);assert.equal(result.dailyCoverage.filesChecked,24);assert.equal(result.dailyCoverage.boundedRead,true);assert.equal(reads,24);assert.equal(result.dailyCoverage.days[0].usableHours,1);
 }finally{db.close();}
});

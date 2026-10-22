import {test} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {archiveTestContext} from './archive-test-context.mjs';
import worker from '../dist/server/index.js';
const output=await build({entryPoints:['worker/collection-journal.ts'],bundle:true,platform:'node',format:'esm',write:false});
const {recordCollectionJournal,readCollectionJournal,normalizeCollectionJournal}=await import('data:text/javascript;base64,'+Buffer.from(output.outputFiles[0].text).toString('base64'));
const now=Date.now();
const input=at=>({lat:50.7567,lon:2.5204,startedAt:at-1000,completedAt:at,diagnostics:[{modelName:'AROME',modelId:'meteofrance_arome_france_hd',status:'partial',attemptCount:2,hoursReceived:48,valuesReceived:800,expectedValueCount:960,expectedHoursCount:48,errorCode:null}]});
test('une suspension sans appel est conservée comme telle ; zéro tentative ne peut pas confirmer une réception',async()=>{
 const payload=input(now),row=payload.diagnostics[0];Object.assign(row,{status:'failed',attemptCount:0,hoursReceived:0,valuesReceived:0,errorCode:'rate_limit_suspended'});
 assert.equal(normalizeCollectionJournal(payload,now).diagnostics[0].attemptCount,0);
 const {env,db}=await archiveTestContext();try{await recordCollectionJournal(payload,env,'server',now);const result=await readCollectionJournal(env,now);assert.equal(result.entries[0].requestAttempts,0);assert.equal(result.entries[0].errorCode,'rate_limit_suspended');}finally{db.close();}
 row.valuesReceived=1;assert.throws(()=>normalizeCollectionJournal(payload,now));row.valuesReceived=0;row.errorCode='provider_http_4xx';assert.throws(()=>normalizeCollectionJournal(payload,now));
});
test('writer puis lecteur réels : intégrité et ordre des lots, sans inventer la confirmation d’écriture',async()=>{
 const {env,db,objects}=await archiveTestContext();try{
  assert.equal((await readCollectionJournal(env,now)).status,'none');
  await recordCollectionJournal(input(now),env,'browser',now);
  await recordCollectionJournal(input(now-10000),env,'browser',now);
  const result=await readCollectionJournal(env,now);
  assert.equal(result.completedAt,now);assert.equal(result.entries[0].requestAttempts,2);assert.equal(result.entries[0].archiveRowsWritten,null);assert.equal(result.entries[0].projectionRowsWritten,null);
  const key=db.prepare('SELECT message FROM weather_collection_status WHERE channel=?').get('hourly_journal_v1').message;objects.set(key,'altéré');await assert.rejects(readCollectionJournal(env,now),/Empreinte/);
 }finally{db.close();}
});
test('route du journal : identité, origine, taille et format contrôlés avant écriture',async()=>{
 const env={DB:{prepare(){throw Error('Écriture interdite');}},BUCKET:{put(){throw Error('Écriture interdite');}}};
 const post=(headers,body=JSON.stringify(input(now)))=>worker.fetch(new Request('https://controle.example/api/history/collection-journal',{method:'POST',headers,body}),env,{waitUntil(){}});
 assert.equal((await post({})).status,401);
 assert.equal((await post({'oai-authenticated-user-id':'test',Origin:'https://autre.invalid','Content-Type':'application/json'})).status,403);
 assert.equal((await post({'oai-authenticated-user-id':'test',Origin:'https://controle.example','Content-Type':'application/json'},'x'.repeat(50001))).status,413);
 assert.equal((await post({'oai-authenticated-user-id':'test',Origin:'https://controle.example','Content-Type':'application/json'},'{')).status,400);
});
test('rapport AI Lab : journal confirmé distinct d’une capture de prévision',async()=>{
 const {env,db}=await archiveTestContext();try{
  await recordCollectionJournal(input(now),env,'browser',now);
  const url=new URL('https://controle.example/api/trpc/weather.getForecastCollectionReport');url.searchParams.set('input',JSON.stringify({json:{lat:50.7567,lon:2.5204}}));
  const response=await worker.fetch(new Request(url,{headers:{'oai-authenticated-user-id':'test'}}),env,{waitUntil(){}}),result=(await response.json()).result.data.json;
  assert.equal(result.hourlyModelCollectionAvailable,true);assert.equal(result.hourlyModelCollection.length,1);assert.equal(result.snapshot,null);assert.equal(result.lastForecastSuccess,null);assert.equal(result.journalDiagnostics.origin,'browser');assert.equal(result.scheduledAt,null);
 }finally{db.close();}
});

test('couverture réelle par champ conservée, anciens journaux lisibles et confirmations non inventées',async()=>{
 const {env,db}=await archiveTestContext();try{
  const coverageOutput=await build({entryPoints:['server/forecastVariableCoverage.ts'],bundle:true,platform:'node',format:'esm',write:false});
  const {HOURLY_FORECAST_VARIABLES}=await import('data:text/javascript;base64,'+Buffer.from(coverageOutput.outputFiles[0].text).toString('base64'));
  const payload=input(now);payload.diagnostics[0].valuesReceived=528;
  payload.diagnostics[0].variableDiagnostics=HOURLY_FORECAST_VARIABLES.map((v,i)=>({key:v.key,slots:Array.from({length:48},(_,hour)=>({validAt:now+hour*3600000,status:i<11?'valid':'provider_null',rawValue:'doit rester hors résumé'}))}));
  const normalized=normalizeCollectionJournal(payload,now,'server');
  assert.equal(normalized.diagnostics[0].variableSummary.length,20);
  assert.equal(normalized.diagnostics[0].variableSummary.reduce((sum,v)=>sum+v.receivedCount,0),528);
  assert.ok(!JSON.stringify(normalized).includes('rawValue'));
  await recordCollectionJournal(payload,env,'server',now);
  const entry=(await readCollectionJournal(env,now)).entries[0];
  assert.equal(entry.expectedHoursCount,48);assert.equal(entry.variableSummary[19].providerNullCount,48);
  assert.equal(entry.archiveRowsWritten,null);assert.equal(entry.projectionRowsWritten,null);
  const legacy=input(now-10000);assert.ok(!('variableSummary' in normalizeCollectionJournal(legacy,now,'browser').diagnostics[0]));
  const invalid=structuredClone(payload);invalid.diagnostics[0].valuesReceived=960;
  assert.throws(()=>normalizeCollectionJournal(invalid,now,'server'),/Total de valeurs/);
  const duplicate=structuredClone(payload);duplicate.diagnostics[0].variableDiagnostics[0].slots[1].validAt=duplicate.diagnostics[0].variableDiagnostics[0].slots[0].validAt;
  assert.throws(()=>normalizeCollectionJournal(duplicate,now,'server'),/Créneau de variable/);
  const badCount=structuredClone(normalized);badCount.diagnostics[0].variableSummary[0].receivedCount=49;
  assert.throws(()=>normalizeCollectionJournal(badCount,now,'server'),/incohérente/);
 }finally{db.close();}
});

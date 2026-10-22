import {test} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {archiveTestContext} from './archive-test-context.mjs';
import worker from '../dist/server/index.js';
const bundle=await build({stdin:{contents:"export * from './worker/learning-store';export * from './worker/learning-collection';export * from './worker/learning-provider-runs';export * from './worker/daily-forecast-collection';export * from './worker/provider-rate-limit';export * from './server/parisHourlyTime';export {resetWeatherFetchCache} from './server/weatherFetch';export {computeOfficialHourlyForecast} from './server/officialHourlyForecast';export * from './worker/physical-reference-store';export {recordServerObservations} from './worker/server-observations';export {recordDailyCapture} from './worker/daily-archive';export * from './shared/qualifiedLearning';export {computeOfficialDailyForecastWithDiagnostics} from './server/officialForecast';",resolveDir:process.cwd()},bundle:true,format:'esm',platform:'node',write:false,plugins:[{name:'physical-kind',setup(b){b.onResolve({filter:/^\.\/stationService$/},a=>a.importer.endsWith('dailyForecastVerification.ts')?{path:resolve('worker/station-kind.ts')}:undefined);}}]});
await mkdir('qa',{recursive:true});await writeFile('qa/learning-test-bundle.mjs',bundle.outputFiles[0].text);
const api=await import(pathToFileURL(resolve('qa/learning-test-bundle.mjs')).href);
const HOUR=3600000,DAY=24*HOUR,coords={lat:50.7567,lon:2.5204},models=[['AROME','meteofrance_arome_france_hd',1],['ICON','dwd_icon_eu',4]],day=Date.parse('2026-10-16T00:00:00Z');
async function context(){const c=await archiveTestContext();for(const file of ['0005_lush_micromax','0006_young_marvel_zombies','0007_tense_thor','0008_motionless_amphibian','0009_white_crusher_hogan'])c.db.exec(await readFile('drizzle/'+file+'.sql','utf8'));c.env.NETATMO_ENCRYPTION_KEY=Buffer.alloc(32,11).toString('base64');return c;}
function capture(date,at){return {...coords,capturedAt:at,days:[{date:new Date(date).toISOString().slice(0,10),forecasts:models.map(([serviceName,modelId,temp])=>({serviceName,modelId,tempMax:temp,tempMin:temp,requestStartedAt:at-100,availableAt:at}))}]};}
function dailyResponse(now){
 const daily={time:[api.getParisDateAndHour(now).date]},daily_units={};
 for(const modelId of ['meteofrance_arome_france_hd','meteofrance_arpege_europe','dwd_icon_eu','ecmwf_ifs025','gfs_seamless','gem_seamless','ukmo_seamless'])for(const [field,value,unit] of [['temperature_2m_max',12,'°C'],['temperature_2m_min',0,'°C']]){daily[field+'_'+modelId]=[value];daily_units[field+'_'+modelId]=unit;}
 return Response.json({timezone:'Europe/Paris',daily,daily_units});
}
async function physicalDay(c,start,hours=18){for(let h=0;h<hours;h++){
 const validAt=start+(h+1)*HOUR,at=validAt+20*60000;
 await api.recordServerObservations({...coords,radiusKm:50,providerReceivedAt:at,stations:[0,1,2].map(i=>({id:'netatmo-learning-station-'+i,temp:0,time:at-60000,distance:i+1,elevation:null,anomaly:false}))},c.env,at);
 await api.finalizePhysicalReferences(c.env,validAt+HOUR+60000);
}}
test('journée terminée : seuil physique, vrais scores de température, sources signées et dédoublonnage',async()=>{
 const c=await context();try{
  await api.recordLearningForecast(capture(day,day-DAY),c.env,day-DAY);await physicalDay(c,day);
  assert.equal((await api.finalizeLearningDays(c.env,day+20*HOUR)).stored,0);
  assert.equal((await api.finalizeLearningDays(c.env,day+DAY+2*HOUR)).stored,1);
  const result=await api.readLearningHistory(c.env,day+DAY+3*HOUR);
  assert.equal(result.qualifiedDays,1);assert.equal(result.scoreCount,4);assert.equal(result.qualifiedGroups,0);assert.equal(result.lastCoverageHours,18);
  assert(result.units.every(u=>u.variable==='temperature_max'||u.variable==='temperature_min'));assert.equal(result.units.find(u=>u.serviceName==='AROME').mae,1);assert.equal(result.units.find(u=>u.serviceName==='ICON').rmse,4);
  const before=c.objects.size;assert.equal((await api.finalizeLearningDays(c.env,day+DAY+4*HOUR)).stored,0);assert.equal(c.objects.size,before);
  assert(!JSON.stringify(result).includes('stationEvidence'));assert(!JSON.stringify(result).includes('stationId'));assert(!JSON.stringify(result).includes('signature'));
  const response=await worker.fetch(new Request('https://controle.example/api/trpc/weather.getEvidenceStatus?input='+encodeURIComponent(JSON.stringify({json:coords})),{headers:{'oai-authenticated-user-id':'test'}}),c.env,{waitUntil(){}}),report=(await response.json()).result.data.json;
  assert.equal(report.qualifiedScoreCount,4);assert.equal(report.isEligible,false);assert.equal(report.dailyCoverage.officialEvidence,'qualified');assert.equal(report.dailyCoverage.learning.modelScores.length,4);assert.equal(report.dailyCoverage.learning.calibration,undefined);
 }finally{c.db.close();}
});
test('17 heures, archives navigateur ou prévision trop tardive ne sont pas transformées en apprentissage',async()=>{
 for(const mode of ['17','browser','late']){
  const c=await context();try{
   if(mode==='browser')await api.recordDailyCapture(capture(day,day-DAY),c.env,'browser',day-DAY);
   else{const at=mode==='late'?day+12*HOUR:day-DAY;await api.recordLearningForecast(capture(day,at),c.env,at);}
   await physicalDay(c,day,mode==='17'?17:18);await api.finalizeLearningDays(c.env,day+DAY+2*HOUR);
   const result=await api.readLearningHistory(c.env,day+DAY+3*HOUR);assert.equal(result.scoreCount,0);assert.equal(result.qualifiedDays,mode==='17'?0:1);
  }finally{c.db.close();}
 }
});

test('des journées altérées ne bloquent ni les autres dates ni leur reprise ultérieure',async()=>{
 const c=await context();try{
  for(const date of [day-2*DAY,day-DAY,day]){await api.recordLearningForecast(capture(date,date-DAY),c.env,date-DAY);await physicalDay(c,date);}
  const damaged=[];
  for(const date of [day,day-DAY]){
   const raw=c.db.prepare('SELECT object_key FROM weather_server_observations WHERE received_at>=? AND received_at<? ORDER BY received_at LIMIT 1').get(date,date+DAY);
   damaged.push([raw.object_key,c.objects.get(raw.object_key)]);c.objects.set(raw.object_key,c.objects.get(raw.object_key)+' ');
  }
  const now=day+DAY+3*HOUR;
  const first=await api.finalizeLearningDays(c.env,now);assert.equal(first.rejected,2);assert.equal(first.stored,0);
  const second=await api.finalizeLearningDays(c.env,now+1000);assert.equal(second.stored,1,'La reprise doit atteindre la date saine malgré deux échecs récents');
  const partial=await api.readLearningHistory(c.env,now+2000);assert.equal(partial.qualifiedDays,1);assert.equal(partial.scoreCount,4);assert.equal(partial.qualification.rejectedDays,2);
  for(const [key,text] of damaged)c.objects.set(key,text);
  for(let retry=0;retry<3;retry++)await api.finalizeLearningDays(c.env,now+3000+retry);
  const repaired=await api.readLearningHistory(c.env,now+4000);assert.equal(repaired.qualifiedDays,3);assert.equal(repaired.scoreCount,12);assert.equal(repaired.qualification.rejectedDays,0);
 }finally{c.db.close();}
});
test('preuve physique altérée, hash recalculé sans signature et clé changée : aucun score confirmé',async()=>{
 const c=await context();try{
  await api.recordLearningForecast(capture(day,day-DAY),c.env,day-DAY);await physicalDay(c,day);
  const raw=c.db.prepare('SELECT object_key FROM weather_server_observations LIMIT 1').get(),original=c.objects.get(raw.object_key);c.objects.set(raw.object_key,original+' ');
  assert.equal((await api.finalizeLearningDays(c.env,day+DAY+2*HOUR)).rejected,1);assert.equal(c.db.prepare('SELECT COUNT(*) AS n FROM weather_learning_days').get().n,0);
  c.objects.set(raw.object_key,original);await api.finalizeLearningDays(c.env,day+DAY+2*HOUR);
  const index=c.db.prepare('SELECT * FROM weather_learning_days').get(),text=c.objects.get(index.object_key);c.env.NETATMO_ENCRYPTION_KEY=Buffer.alloc(32,12).toString('base64');assert.equal((await api.readLearningHistory(c.env,day+DAY+3*HOUR)).filesRejected,1);
  c.env.NETATMO_ENCRYPTION_KEY=Buffer.alloc(32,11).toString('base64');const altered=JSON.parse(text);altered.payload.units[0].mae=0;const body=JSON.stringify(altered),digest=createHash('sha256').update(body).digest('hex'),key='learning/days/'+digest+'.json';c.objects.set(key,body);c.db.prepare('UPDATE weather_learning_days SET digest=?,object_key=?').run(digest,key);
  const result=await api.readLearningHistory(c.env,day+DAY+3*HOUR);assert.equal(result.scoreCount,0);assert.equal(result.filesRejected,1);
  c.db.exec('DROP TABLE weather_learning_days');await assert.rejects(api.readLearningHistory(c.env,day+DAY+3*HOUR));
 }finally{c.db.close();}
});
test('30 dates physiques indépendantes sont réellement lues et modifient les seuls poids quotidiens comparables',async()=>{
 const c=await context();try{
  const current=day+DAY+3*HOUR;
  for(let d=30;d>=1;d--){const date=day-d*DAY;await api.recordLearningForecast(capture(date,date-DAY),c.env,date-DAY);await physicalDay(c,date);await api.finalizeLearningDays(c.env,date+DAY+3*HOUR);}
  const result=await api.readLearningHistory(c.env,current);assert.equal(result.qualifiedDays,30);assert.equal(result.scoreCount,120);assert.equal(result.qualifiedGroups,4);
  const target=new Date(current+DAY).toISOString().slice(0,10),performance=api.learningPerformance(result.units,target,current);assert.equal(performance.length,4);assert(performance.every(p=>p.evaluatedDays===30&&p.sampleSize===30));
  const forecasts=models.map(([serviceName,modelId],i)=>({serviceName,modelId,sourceName:'open-meteo',availableAt:current,requestStartedAt:current-100,tempMax:i?20:10,tempMin:i?15:5,precipitation:null,windSpeed:null,windGust:null,humidity:null,cloudCover:null}));
  const options={locationKey:'50.757_2.520',targetDate:target,issuedAt:current,referenceAt:current,evidenceStoreAvailable:true,evidence:performance};
  const learned=api.computeOfficialDailyForecastWithDiagnostics(forecasts,options),fallback=api.computeOfficialDailyForecastWithDiagnostics(forecasts,{...options,evidence:[]});
  assert.equal(learned.trace.parameterSources.tempMax.find(s=>s.name==='AROME').calibrationStatus,'CALIBRATED');assert(learned.tempMax<fallback.tempMax,'Le modèle réellement moins erroné doit peser davantage');
  assert.equal(api.learningPerformance(result.units,target,current+10*DAY).length,0,'Un score périmé ne doit plus pondérer');
  assert.equal(api.learningPerformance(result.units.filter(u=>u.serviceName==='AROME').slice(0,58),target,current).length,0,'29 dates ne doivent pas suffire');
 }finally{c.db.close();}
});
test('collecte serveur en échec : cache durable de dix minutes et aucune prévision inventée',async()=>{
 const c=await context(),oldFetch=globalThis.fetch;let calls=0;try{api.resetWeatherFetchCache();
  globalThis.fetch=async()=>{calls++;return new Response('{"error":true}',{status:429,headers:{'Content-Type':'application/json'}});};
  const now=Date.now(),first=await api.collectLearningForecasts(c.env,now);assert.equal(first.status,'failed');assert(calls>0&&calls<=8);
  const count=calls,second=await api.collectLearningForecasts(c.env,now+1000);assert.equal(second.attempted,false);assert.equal(calls,count);assert.equal((await api.readLearningHistory(c.env,now+2000)).forecastCount,0);
 }finally{globalThis.fetch=oldFetch;c.db.close();}
});

test('collecte quotidienne réussie : sept modèles signés, agrégateur exclu et source relisible',async()=>{
 const c=await context(),oldFetch=globalThis.fetch;let calls=0;try{api.resetWeatherFetchCache();
  const now=Date.now(),date=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Paris'}).format(now);
  globalThis.fetch=async()=>{calls++;const daily={time:[date]},daily_units={};for(const modelId of ['meteofrance_arome_france_hd','meteofrance_arpege_europe','dwd_icon_eu','ecmwf_ifs025','gfs_seamless','gem_seamless','ukmo_seamless'])for(const [field,value,unit] of [['temperature_2m_max',12,'°C'],['temperature_2m_min',0,'°C'],['precipitation_sum',0,'mm'],['wind_speed_10m_max',10,'km/h'],['wind_gusts_10m_max',20,'km/h'],['relative_humidity_2m_mean',80,'%'],['cloud_cover_mean',20,'%']]){daily[field+'_'+modelId]=[value];daily_units[field+'_'+modelId]=unit;}return Response.json({timezone:'Europe/Paris',daily,daily_units});};
  const result=await api.collectLearningForecasts(c.env,now);assert.equal(result.status,'ok');assert.equal(result.stored,true);assert.equal(calls,1);
  const index=c.db.prepare('SELECT * FROM weather_learning_forecasts').get(),payload=await api.readSigned(index,'forecasts',c.env);
  assert.equal(payload.days[0].forecasts.length,7);assert(payload.days[0].forecasts.every(row=>row.serviceName!=='Open-Meteo'&&row.tempMin===0&&row.precipitation===0));
  assert.equal((await api.readLearningHistory(c.env)).forecastCount,1);
 }finally{globalThis.fetch=oldFetch;c.db.close();}
});

test('nouvelle heure après collecte terminée : nouvelle réponse signée malgré le bail de dix minutes',async t=>{
 let now=Date.parse('2026-10-21T08:58:00Z');t.mock.method(Date,'now',()=>now);
 const c=await context(),oldFetch=globalThis.fetch;let calls=0;try{api.resetWeatherFetchCache();
  globalThis.fetch=async()=>{calls++;return dailyResponse(now);};
  assert.equal((await api.collectLearningForecasts(c.env,now)).stored,true);
  now+=9*60000;assert.equal((await api.collectLearningForecasts(c.env,now)).stored,true);assert.equal(calls,2);
  const rows=c.db.prepare('SELECT * FROM weather_learning_forecasts ORDER BY received_at').all();assert.equal(rows.length,2);
  assert(rows[0].id.endsWith('T08'));assert(rows[1].id.endsWith('T09'));
  for(const row of rows){const proof=await api.readSigned(row,'forecasts',c.env);assert.equal(proof.availableAt,row.received_at);assert.equal(proof.days[0].forecasts[0].availableAt,row.received_at);}
  assert.equal(rows[1].received_at,now);assert.equal(rows[0].received_at,now-9*60000);
  now+=1000;assert.equal((await api.collectLearningForecasts(c.env,now)).attempted,false);assert.equal(calls,2);
 }finally{globalThis.fetch=oldFetch;c.db.close();}
});

test('nouvelle heure : ne reprend ni un bail actif ni une tentative datée dans le futur',async t=>{
 let now=Date.parse('2026-10-21T09:07:00Z');t.mock.method(Date,'now',()=>now);
 for(const [status,at] of [['running','2026-10-21T08:59:00Z'],['ok','2026-10-21T10:00:00Z']]){
  const c=await context(),oldFetch=globalThis.fetch;let calls=0;try{api.resetWeatherFetchCache();globalThis.fetch=async()=>{calls++;return dailyResponse(now);};
   c.db.prepare('INSERT INTO weather_collection_status(channel,attempted_at,status,message) VALUES (?,?,?,?)').run('learning_daily_collection_v1',new Date(at).toISOString(),status,'Fixture');
   assert.equal((await api.collectLearningForecasts(c.env,now)).attempted,false);assert.equal(calls,0);assert.equal(c.db.prepare('SELECT COUNT(*) AS n FROM weather_learning_forecasts').get().n,0);
  }finally{globalThis.fetch=oldFetch;c.db.close();}
 }
});

test('nouvelle heure sous suspension Forecast : aucun appel réseau ni capture quotidienne inventée',async t=>{
 let now=Date.parse('2026-10-21T08:59:00Z');t.mock.method(Date,'now',()=>now);
 const c=await context(),oldFetch=globalThis.fetch;let calls=0;try{api.resetWeatherFetchCache();
  globalThis.fetch=async()=>{calls++;return Response.json({error:true,reason:'Daily API request limit exceeded'},{status:429});};
  assert.equal((await api.collectLearningForecasts(c.env,now)).status,'failed');assert.equal(calls,1);
  now+=8*60000;const result=await api.collectLearningForecasts(c.env,now);assert.equal(result.attempted,true);assert.equal(result.status,'failed');assert.equal(calls,1);
  assert.equal(c.db.prepare('SELECT COUNT(*) AS n FROM weather_learning_forecasts').get().n,0);
 }finally{globalThis.fetch=oldFetch;c.db.close();}
});

function providerValues(date,model,runAt=date-DAY,availableAt=runAt+5*HOUR+60000,times=Array.from({length:18},(_,h)=>date+(h+1)*HOUR)){
 const [modelName,modelId,value]=model;
 return times.map(validTime=>({captureRunId:modelName+'-'+runAt,locationKey:'50.757_2.520',targetDate:new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Paris'}).format(validTime),modelName,modelId,metadataAvailableAt:runAt+4*HOUR,providerRunAt:runAt,requestStartedAt:availableAt-60000,availableAt,validTime,forecastLeadTimeMilliseconds:validTime-runAt,collectionLatencyMilliseconds:availableAt-runAt,variable:'temperature',value,unit:'°C'}));
}

test('quota Forecast : la collecte quotidienne utilise les vrais cycles signés et ne refait pas les appels de la même heure',async()=>{
 const c=await context(),oldFetch=globalThis.fetch;let calls=0;try{api.resetWeatherFetchCache();
  const now=Date.now(),today=api.getParisDateAndHour(now).date,date=new Date(Date.parse(today+'T12:00:00Z')+DAY).toISOString().slice(0,10),next=new Date(Date.parse(date+'T12:00:00Z')+DAY).toISOString().slice(0,10);
  const start=api.parisLocalHourToUniqueEpochMs(date,0),end=api.parisLocalHourToUniqueEpochMs(next,0),times=Array.from({length:(end-start)/HOUR},(_,i)=>start+i*HOUR);
  for(const model of models){const values=providerValues(start,model,now-6*HOUR,now-1000,times);await api.recordLearningProviderRun(values,c.env,now);}
  globalThis.fetch=async()=>{calls++;return Response.json({error:true,reason:'Daily API request limit exceeded'},{status:429});};
  const first=await api.collectLearningForecasts(c.env,now);assert.equal(first.status,'ok');assert.equal(first.mode,'verified_hourly_cycles');assert.equal(first.forecastApiStatus,429);assert.equal(calls,1);
  const index=c.db.prepare('SELECT * FROM weather_learning_forecasts').get(),proof=await api.readSigned(index,'forecasts',c.env);
  assert.equal(proof.days.length,1);assert.equal(proof.days[0].date,date);assert.equal(proof.days[0].forecasts.length,2);assert.equal(proof.days[0].forecasts[0].tempMin,1);assert.equal(proof.days[0].forecasts[0].tempMax,1);assert.equal(proof.days[0].forecasts[0].precipitation,null);
  assert.equal(proof.provenance.coverage[0].expectedHours,times.length);assert(proof.provenance.sourceRevision.length>0);
  c.db.prepare('UPDATE weather_collection_status SET attempted_at=? WHERE channel=?').run(new Date(now-600001).toISOString(),'learning_daily_collection_v1');
  const sameHour=await api.collectLearningForecasts(c.env,now+1000);assert.equal(sameHour.status,'ok');assert.equal(sameHour.stored,false);assert.equal(calls,1);
  const history=await api.readLearningHistory(c.env,now+2000);assert.equal(history.forecastCount,1);assert.equal(history.collection.mode,'verified_hourly_cycles');assert.equal(history.collection.models.length,2);assert.equal(history.scoreCount,0);
  const run=c.db.prepare('SELECT object_key FROM weather_learning_provider_runs LIMIT 1').get(),rawRun=c.objects.get(run.object_key);c.objects.set(run.object_key,rawRun+' ');
  const derived=await api.deriveDailyFromVerifiedCycles(c.env,now+2000);assert.equal(derived.days[0].forecasts.length,1,'Une source altérée ne fournit aucun extrême');assert.equal(derived.filesRejected,1);
  c.objects.set(run.object_key,rawRun);await physicalDay(c,start);await api.finalizeLearningDays(c.env,end+2*HOUR);
  const scored=await api.readLearningHistory(c.env,end+3*HOUR);assert.equal(scored.units.length,4);assert.equal(scored.units.find(u=>u.serviceName==='AROME').mae,1);assert.equal(scored.units.find(u=>u.serviceName==='ICON').mae,4);assert.equal(scored.dailyQualifiedGroups,0,'Une seule journée ne suffit pas à apprendre');
 }finally{globalThis.fetch=oldFetch;c.db.close();}
});

test('GFS GEM UKMET : cycles signes relus puis extremes quotidiens sans modifier les IDs historiques',async()=>{
 const c=await context();try{
  const now=Date.now(),today=api.getParisDateAndHour(now).date,date=new Date(Date.parse(today+'T12:00:00Z')+DAY).toISOString().slice(0,10),next=new Date(Date.parse(date+'T12:00:00Z')+DAY).toISOString().slice(0,10);
  const start=api.parisLocalHourToUniqueEpochMs(date,0),end=api.parisLocalHourToUniqueEpochMs(next,0),times=Array.from({length:(end-start)/HOUR},(_,i)=>start+i*HOUR);
  for(const model of [['GFS','gfs_seamless'],['GEM','gem_seamless'],['UKMET','ukmo_seamless']]){
   const values=providerValues(start,model,now-6*HOUR,now-1000,times).map((v,i)=>({...v,value:i,...(model[0]==='UKMET'?{metadataPublicationBasis:'component_upper_bound'}:{})}));
   assert.equal((await api.recordLearningProviderRun(values,c.env,now)).stored,true);
  }
  const result=await api.deriveDailyFromVerifiedCycles(c.env,now);
  assert.equal(result.filesRejected,0);assert.equal(result.days.length,1);
  const forecasts=result.days[0].forecasts;
  assert.deepEqual(forecasts.map(f=>f.serviceName).sort(),['GEM','GFS','UKMET']);
  assert(forecasts.every(f=>f.tempMin===0&&f.tempMax===times.length-1&&f.precipitation===null));
  const history=await api.readLearningHistory(c.env,now);
  assert.equal(history.providerRunCount,3);assert.equal(history.scoreCount,0);
 }finally{c.db.close();}
});

test('cycles deja signes : verifier les preuves avant de supprimer le telechargement redondant',async()=>{
 const c=await context(),oldFetch=globalThis.fetch;let calls=0;try{
  api.resetWeatherFetchCache();const now=Date.now(),run=Math.floor(now/HOUR)*HOUR-6*HOUR;
  for(const model of models)await api.recordLearningProviderRun(providerValues(day,model,run,now-1000,[now+HOUR]),c.env,now);
  globalThis.fetch=async(input)=>{
   calls++;const url=new URL(String(input));assert.equal(url.hostname,'api.open-meteo.com','Aucun nouveau telechargement Single Runs attendu');
   if(models.some(model=>url.pathname.includes(model[1])))return Response.json({last_run_initialisation_time:run/1000,last_run_availability_time:(run+4*HOUR)/1000,update_interval_seconds:21600,data_end_time:(now+2*DAY)/1000});
   return Response.json({error:true},{status:404});
  };
  const result=await api.collectLearningProviderRuns(c.env,now);
  assert.equal(result.status,'ok');assert.equal(result.stored,0);assert.equal(result.attempts.filter(a=>a.status==='already_archived').length,2);assert(calls<=10);
  assert.equal(c.db.prepare('SELECT COUNT(*) AS n FROM weather_learning_provider_runs').get().n,2);
 }finally{globalThis.fetch=oldFetch;c.db.close();}
});

test('quota persistant : aucun appel avant expiration, autres appareils et archives preserves',async()=>{
 const c=await context(),oldFetch=globalThis.fetch;let calls=0;try{
  api.resetWeatherFetchCache();const now=Date.now();
  await api.recordLearningProviderLimit(c.env,'forecast',{retryAt:now+DAY,period:'day'},now);
  await api.recordLearningProviderLimit(c.env,'single_runs',{retryAt:now+DAY,period:'day'},now);
  globalThis.fetch=async()=>{calls++;throw Error('Un appel bloque ne doit pas sortir');};
  const otherEnv={...c.env};
  const paused=await api.collectDailyForecastBatch(now+1000,otherEnv);assert.equal(paused.httpStatus,null);assert.equal(paused.requestStatus,'suspended');
  assert.equal((await api.collectLearningProviderRuns(otherEnv,now+1000)).status,'rate_limited');
  const history=await api.readLearningHistory(otherEnv,now+1000);
  assert.equal(history.providerRateLimits.length,2);assert.equal(calls,0);assert.equal(history.scoreCount,0);
  assert.equal(await api.readLearningProviderLimit(otherEnv,'forecast',now+DAY),null);
  assert.equal(c.db.prepare('SELECT COUNT(*) AS n FROM weather_learning_forecasts').get().n,0);
 }finally{globalThis.fetch=oldFetch;c.db.close();}
});

test('quota persistant : un delai court concurrent ne raccourcit pas une suspension quotidienne',async()=>{
 const c=await context();try{
  const now=Date.now();
  await Promise.all([api.recordLearningProviderLimit(c.env,'forecast',{retryAt:now+DAY,period:'day'},now),api.recordLearningProviderLimit(c.env,'forecast',{retryAt:now+HOUR,period:'hour'},now+100)]);
  assert.equal((await api.readLearningProviderLimit(c.env,'forecast',now+1000)).retryAt,now+DAY);
  c.db.prepare('UPDATE weather_collection_status SET message=? WHERE channel=?').run('{"version":1,"retryAt":"faux"}','learning_open_meteo_limit_v1/forecast');
  await assert.rejects(api.readLearningProviderLimit(c.env,'forecast',now));
 }finally{c.db.close();}
});

test('journal de quota illisible : les journées déjà vérifiées restent qualifiables et consultables',async()=>{
 const c=await context();try{
  await api.recordLearningForecast(capture(day,day-DAY),c.env,day-DAY);await physicalDay(c,day);
  c.db.prepare('INSERT INTO weather_collection_status VALUES (?,?,?,?)').run('learning_open_meteo_limit_v1/forecast',new Date(day).toISOString(),'rate_limited','{"version":1,"retryAt":"faux"}');
  const now=day+DAY+3*HOUR;
  assert.equal((await api.finalizeLearningDays(c.env,now)).stored,1);
  const history=await api.readLearningHistory(c.env,now);
  assert.equal(history.available,true);assert.equal(history.providerRateLimitsAvailable,false);
  assert.equal(history.scoreCount,4);assert.equal(history.units.find(u=>u.serviceName==='AROME').mae,1);
  await assert.rejects(api.readLearningProviderLimit(c.env,'forecast',now),'Le garde réseau demeure strict');
 }finally{c.db.close();}
});

test('panne du flux Single Runs : le quotidien indépendant continue sans appeler le fournisseur bloqué',async()=>{
 const c=await context(),oldFetch=globalThis.fetch;let calls=0;try{
  api.resetWeatherFetchCache();const now=Date.now();
  c.db.prepare('INSERT INTO weather_collection_status VALUES (?,?,?,?)').run('learning_open_meteo_limit_v1/single_runs',new Date(now).toISOString(),'rate_limited','JSON invalide');
  globalThis.fetch=async input=>{calls++;assert.equal(new URL(String(input)).pathname,'/v1/forecast');return dailyResponse(now);};
  const result=await api.refreshQualifiedLearning(c.env);
  assert.equal(result.available,true);assert.equal(result.providerCollection.status,'failed');assert.equal(result.providerCollection.attempted,false);
  assert.equal(result.collection.status,'ok');assert.equal(result.collection.stored,true);assert.equal(calls,1);
  const history=await api.readLearningHistory(c.env);assert.equal(history.forecastCount,1);assert.equal(history.providerRateLimitsAvailable,false);assert.equal(history.scoreCount,0);
  const index=c.db.prepare('SELECT * FROM weather_learning_forecasts').get(),proof=await api.readSigned(index,'forecasts',c.env);assert.equal(proof.days[0].forecasts.length,7);
  const repeated=await api.refreshQualifiedLearning(c.env);assert.equal(repeated.collection.attempted,false);assert.equal(calls,1,'Le bail de dix minutes reste actif');
 }finally{globalThis.fetch=oldFetch;c.db.close();}
});

test('journal Forecast illisible : repli sur les cycles signés sans appel réseau ni valeurs inventées',async()=>{
 const c=await context(),oldFetch=globalThis.fetch;let calls=0;try{
  api.resetWeatherFetchCache();const now=Date.now(),today=api.getParisDateAndHour(now).date,date=new Date(Date.parse(today+'T12:00Z')+DAY).toISOString().slice(0,10),next=new Date(Date.parse(date+'T12:00Z')+DAY).toISOString().slice(0,10);
  const start=api.parisLocalHourToUniqueEpochMs(date,0),end=api.parisLocalHourToUniqueEpochMs(next,0),times=Array.from({length:(end-start)/HOUR},(_,i)=>start+i*HOUR);
  for(const model of models)await api.recordLearningProviderRun(providerValues(start,model,now-6*HOUR,now-1000,times),c.env,now);
  c.db.prepare('INSERT INTO weather_collection_status VALUES (?,?,?,?)').run('learning_open_meteo_limit_v1/forecast',new Date(now).toISOString(),'rate_limited','null');
  await api.recordLearningProviderLimit(c.env,'single_runs',{period:'day',retryAt:now+DAY},now);
  globalThis.fetch=async()=>{calls++;assert.fail('Aucun appel réseau autorisé');};
  const result=await api.refreshQualifiedLearning(c.env);assert.equal(result.collection.status,'ok');assert.equal(result.collection.mode,'verified_hourly_cycles');assert.equal(result.collection.forecastApiStatus,null);assert.equal(calls,0);
  const history=await api.readLearningHistory(c.env);assert.equal(history.providerRateLimitsAvailable,false);assert.equal(history.providerRateLimits.length,1);assert.equal(history.providerRateLimits[0].provider,'single_runs');assert.equal(history.scoreCount,0);
  const index=c.db.prepare('SELECT * FROM weather_learning_forecasts').get(),proof=await api.readSigned(index,'forecasts',c.env);
  assert.equal(proof.days[0].forecasts.length,2);assert(proof.days[0].forecasts.every(f=>f.precipitation===null));
  await assert.rejects(api.collectDailyForecastBatch(now,c.env));
 }finally{globalThis.fetch=oldFetch;c.db.close();}
});

test('extrêmes quotidiens : journées complètes de 23, 24 ou 25 heures, zéros préservés et aucune heure inventée',()=>{
 for(const [date,expected] of [['2026-03-29',23],['2026-10-20',24],['2026-10-25',25]]){
  const next=new Date(Date.parse(date+'T12:00:00Z')+DAY).toISOString().slice(0,10),start=api.parisLocalHourToUniqueEpochMs(date,0),end=api.parisLocalHourToUniqueEpochMs(next,0),now=start-6*HOUR;
  const hours=Array.from({length:(end-start)/HOUR},(_,i)=>({validAt:start+i*HOUR,temperature:i===0?0:i}));
  const model={modelName:'ICON',modelId:'dwd_icon_eu',providerRunAt:now-6*HOUR,availableAt:now-1000,hours};
  const full=api.aggregateVerifiedDailyTemperatures([model],now);assert.equal(full.coverage[0].expectedHours,expected);assert.equal(full.days[0].forecasts[0].tempMin,0);assert.equal(full.days[0].forecasts[0].tempMax,expected-1);
  assert.equal(api.aggregateVerifiedDailyTemperatures([{...model,hours:hours.slice(1)}],now).days.length,0);
  assert.equal(api.aggregateVerifiedDailyTemperatures([{...model,hours:[...hours,{...hours[0],temperature:100}]}],now).days.length,0);
  assert.equal(api.aggregateVerifiedDailyTemperatures([{...model,hours:hours.map((h,i)=>i===1?{...h,temperature:null}:h)}],now).days.length,0);
  assert.equal(api.aggregateVerifiedDailyTemperatures([model],start+HOUR).days.length,0,'La journée déjà commencée n’est pas présentée comme prévision complète');
 }
});
test('horaire : sept journées de vrais cycles signés qualifient les groupes et sélectionnent le meilleur modèle au bon horizon',async()=>{
 const c=await context();try{
  const current=day+DAY+3*HOUR;
  for(let d=7;d>=1;d--){const date=day-d*DAY;for(const model of models){const values=providerValues(date,model);await api.recordLearningProviderRun(values,c.env,values[0].availableAt);}
   await physicalDay(c,date);await api.finalizeLearningDays(c.env,date+DAY+3*HOUR);
  }
  let history=await api.readLearningHistory(c.env,current);assert.equal(history.qualifiedDays,7);assert.equal(history.hourlyScores.length,14);assert.equal(history.hourlyQualifiedGroups,2);assert.equal(history.dailyQualifiedGroups,0);assert.equal(history.exactHourlyScores.length,252);
  const target=current+24*HOUR,runAt=current-6*HOUR;
  for(const model of models){const values=providerValues(current,model,runAt,current-1000,[target]);await api.recordLearningProviderRun(values,c.env,current);}
  history=await api.readLearningHistory(c.env,current);assert.equal(history.providerModels.length,2);
  const ordinary=models.map(([modelName,modelId],i)=>({modelName,modelId,sourceName:'open-meteo',captureRunId:'ordinary-'+i,availableAt:current,requestStartedAt:current-100,hours:[{date:new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Paris'}).format(target),hour:5,validAt:target,temperature:i?20:10,windSpeed:5,weatherCode:3}]}));
  assert.equal(api.selectLearnedProviderForecasts(ordinary,{...history,hourlyScores:[],exactHourlyScores:[]},current),ordinary,'Sans seuil atteint, aucun remplacement du flux courant');
  const selected=api.selectLearnedProviderForecasts(ordinary,history,current);assert.equal(selected.length,4);
  const forecast=api.computeOfficialHourlyForecast(selected,history.hourlyScores,{historyAvailable:true,historyBasis:'provider_run',exactHistoryAvailable:true,exactHistoryScores:history.exactHourlyScores,referenceAt:current});
  assert.equal(forecast.hours[0].temp,1,'La température vient du vrai cycle du meilleur modèle, sans correction inventée');
  assert.equal(forecast.hours[0].forecastWeighting.variableWeightings.find(v=>v.variable==='temperature').calibrationStatus,'CALIBRATED');
  const legacy=api.computeOfficialHourlyForecast(selected,history.hourlyScores.map(r=>({...r,scoringValidationVersion:1})),{historyAvailable:true,historyBasis:'provider_run',referenceAt:current});
  assert.notEqual(legacy.hours[0].forecastWeighting.variableWeightings.find(v=>v.variable==='temperature').calibrationStatus,'CALIBRATED','Une validation ordinaire v1 ne devient pas une preuve de cycle fournisseur');
 }finally{c.db.close();}
});
test('horaire : une réception tardive ou un cycle supposé ne devient jamais une archive fournisseur',async()=>{
 const c=await context();try{
  const values=providerValues(day,models[0]);
  await assert.rejects(api.recordLearningProviderRun(values.map(v=>({...v,availableAt:v.validTime})),c.env,day));
  await assert.rejects(api.recordLearningProviderRun(values.map(v=>({...v,providerRunAt:v.availableAt})),c.env,day));
  assert.equal(c.db.prepare('SELECT COUNT(*) AS n FROM weather_learning_provider_runs').get().n,0);
 }finally{c.db.close();}
});
test('API publiée : aucune donnée client admise et aucun score nul inventé lors d’une panne de stockage',async()=>{
 const c=await context(),oldFetch=globalThis.fetch;let calls=0;try{api.resetWeatherFetchCache();
  globalThis.fetch=async()=>{calls++;return new Response('{}',{status:429});};
  const url='https://controle.example/api/control/finalize-physical-references';
  for(const body of ['{"stations":[]}','{"scores":0}','{"source":"server"}']){const response=await worker.fetch(new Request(url,{method:'POST',headers:{Origin:'https://controle.example','Content-Type':'application/json'},body}),c.env,{waitUntil(){}});assert.equal(response.status,400);}
  assert.equal(calls,0);
  const read=await worker.fetch(new Request('https://controle.example/api/history/learning-evidence?lat=50.7567&lon=2.5204'),c.env,{waitUntil(){}});assert.equal(read.status,200);assert.equal((await read.json()).scoreCount,0);assert.equal(calls,0);
  c.db.exec('DROP TABLE weather_learning_days');const failed=await worker.fetch(new Request('https://controle.example/api/history/learning-evidence?lat=50.7567&lon=2.5204'),c.env,{waitUntil(){}});assert.equal(failed.status,503);assert(!(await failed.text()).includes('scoreCount'));
 }finally{globalThis.fetch=oldFetch;c.db.close();}
});

test('reprise manuelle : panne des références signalée, prévisions indépendantes tout de même archivées',async()=>{
 const c=await context(),oldFetch=globalThis.fetch;let calls=0;try{
  api.resetWeatherFetchCache();const now=Date.now();
  await api.recordLearningProviderLimit(c.env,'single_runs',{period:'day',retryAt:now+DAY},now);
  c.db.exec('DROP TABLE weather_physical_references');
  globalThis.fetch=async input=>{calls++;assert.equal(new URL(String(input)).pathname,'/v1/forecast');return dailyResponse(now);};
  const response=await worker.fetch(new Request('https://controle.example/api/control/finalize-physical-references',{method:'POST',headers:{Origin:'https://controle.example','Content-Type':'application/json'},body:'{}'}),c.env,{waitUntil(){}});
  assert.equal(response.status,503);assert.match((await response.json()).error,/Références|références/);
  assert.equal(calls,1);assert.equal(c.db.prepare('SELECT COUNT(*) AS n FROM weather_learning_forecasts').get().n,1);
  assert.equal(c.db.prepare('SELECT COUNT(*) AS n FROM weather_learning_days').get().n,0,'Aucun score créé à partir de références indisponibles');
 }finally{globalThis.fetch=oldFetch;c.db.close();}
});

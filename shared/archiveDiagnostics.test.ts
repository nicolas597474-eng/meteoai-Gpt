import {afterEach,describe,expect,it,vi} from 'vitest';
import {readArchiveCollectionReport,verifyForecastArchive} from '../worker/archive-diagnostics';
import {validateCapture} from '../worker/archive';
const now=Date.parse('2026-10-18T15:00:00Z'),coords={lat:50.7567,lon:2.5204};
const request=new Request('https://controle.example/api/trpc/weather.getForecastCollectionReport',{headers:{'oai-authenticated-user-id':'test-reader'}});
const hash=async(text:string)=>Buffer.from(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text))).toString('hex');
async function fixture(at=now-60000,change?:(data:any)=>void){
 const payload={...validateCapture({capturedAt:at,...coords,models:[{modelName:'AROME',modelId:'test',hours:[{validAt:at+3600000,temperature:0,precipitation:0},{validAt:at+7200000,temperature:null,windSpeed:4}]}]},at),origin:'browser',observation:false,calibrationEligible:false};
 change?.(payload);const text=JSON.stringify(payload),digest=await hash(text);
 return {text,row:{id:'test',location_key:'50.757_2.520',captured_at:new Date(at).toISOString(),received_at:new Date(at).toISOString(),origin:'browser',model_count:1,forecast_count:2,digest,object_key:'history/captures/'+digest+'.json'}};
}
function context(fixtures:Awaited<ReturnType<typeof fixture>>[],observation:any={measurements:17,stations:5,rawHours:2,flagged:1,firstMeasuredAt:now-7200000,lastMeasuredAt:now-60000,lastReceivedAt:now-30000}){
 const reads:string[]=[],bindings:any[]=[];
 return {reads,bindings,DB:{prepare:vi.fn((sql:string)=>({bind(...args:any[]){bindings.push({sql,args});return this;},async all(){return {results:fixtures.map(item=>item.row)};},async first(){return observation;}}))},BUCKET:{get:vi.fn(async(key:string)=>{reads.push(key);const data=fixtures.find(item=>item.row.object_key===key);return data?{arrayBuffer:async()=>new TextEncoder().encode(data.text).buffer}:null;}),put:vi.fn(()=>{throw Error('Écriture interdite');})}};
}
afterEach(()=>vi.restoreAllMocks());
describe('diagnostics des archives dans AI Lab',()=>{
 it('confirme le contenu vérifié, conserve zéro et ne reconstruit ni quotidien ni journal',async()=>{
  const data=await fixture(),env=context([data]);vi.spyOn(globalThis,'fetch').mockRejectedValue(Error('Aucun fournisseur'));
  const result=await readArchiveCollectionReport(coords,request,env,now);
  expect(result.archiveDiagnostics.forecastStatus).toBe('verified');expect(result.snapshot?.hourlyCollectedModels).toEqual(['AROME']);
  expect(result.snapshot?.dailyModelCount).toBeNull();expect(result.archiveDiagnostics.models[0]).toMatchObject({hoursArchived:2,valuesArchived:3});
  expect(result.lastForecastSuccess?.collectedAt).toBe(data.row.received_at);
  expect(result.hourlyModelCollectionAvailable).toBe(false);expect(result.hourlyModelCollection).toEqual([]);
  expect(result.lastPhysicalCollection).toBeNull();expect(result.archiveDiagnostics.observationIndex.measurements).toBe(17);
  expect(result.archiveDiagnostics.observationIndex.rawHours).toBe(2);expect(result).not.toHaveProperty('qualifiedScoreCount');
  expect(result.scheduledAt).toBeNull();expect(result.flowStatuses.find(flow=>flow.model==='AROME')?.status).toBe('PARTIAL');
  expect(env.BUCKET.put).not.toHaveBeenCalled();expect(globalThis.fetch).not.toHaveBeenCalled();
  expect(env.bindings.find(item=>item.sql.startsWith('SELECT COUNT(*)')).args).toEqual([now-48*3600000,now,now,'netatmo_browser_bridge']);
 });
 it('écarte une archive altérée et date explicitement le bilan précédent vérifié',async()=>{
  const bad=await fixture(now-10000),good=await fixture(now-7200000);bad.text+=' ';
  const result=await readArchiveCollectionReport(coords,request,context([bad,good]),now);
  expect(result.archiveDiagnostics.rejectedArchives).toBe(1);expect(result.archiveDiagnostics.checkedArchives).toBe(2);
  expect(result.lastForecastSuccess?.collectedAt).toBe(good.row.received_at);
 });
 it('rejette une empreinte valide si la portée, l’index, les modèles ou les échéances sont incorrects',async()=>{
  for(const change of [(p:any)=>p.lon=3,(p:any)=>p.calibrationEligible=true,(p:any)=>p.models.push(p.models[0]),(p:any)=>p.models[0].hours[0].validAt=p.receivedAt-1,(p:any)=>p.models[0].hours[0].temperature='0']){
   const data=await fixture(now-60000,change);await expect(verifyForecastArchive(data.row,context([data]),now)).rejects.toThrow();
  }
  const data=await fixture();data.row.forecast_count=99;await expect(verifyForecastArchive(data.row,context([data]),now)).rejects.toThrow();
 });
 it('ne lit jamais plus de huit objets et ne présente aucune archive rejetée comme réussie',async()=>{
  const fixtures=await Promise.all(Array.from({length:9},(_,i)=>fixture(now-i*60000)));for(const item of fixtures)item.text='altéré';
  const env=context(fixtures),result=await readArchiveCollectionReport(coords,request,env,now);
  expect(env.reads).toHaveLength(8);expect(result.archiveDiagnostics.boundedRead).toBe(true);
  expect(result.archiveDiagnostics.forecastStatus).toBe('integrity_error');expect(result.snapshot).toBeNull();
 });
 it('distingue une lecture impossible d’un index vide et accepte une panne partielle',async()=>{
  const data=await fixture(),env=context([data]);env.DB.prepare.mockImplementation((sql:string)=>{if(sql.includes('weather_captures'))throw Error('Base absente');return {bind(){return this;},async all(){return {results:[]};},async first(){return {measurements:0,stations:0,rawHours:0,flagged:null};}};});
  const unavailable=await readArchiveCollectionReport(coords,request,env,now);
  expect(unavailable.archiveDiagnostics.forecastStatus).toBe('unavailable');expect(unavailable.snapshot).toBeNull();
  expect(unavailable.archiveDiagnostics.observationIndex.measurements).toBe(0);
  const other=context([data],null),partial=await readArchiveCollectionReport(coords,request,other,now);
  expect(partial.archiveDiagnostics.forecastStatus).toBe('verified');expect(partial.archiveDiagnostics.observationIndex.measurements).toBeNull();
 });
 it('protège les lectures et ne réemploie pas les archives de Hondeghem pour un autre lieu',async()=>{
  const env=context([]);
  await expect(readArchiveCollectionReport(coords,new Request(request.url),env,now)).rejects.toMatchObject({status:401});
  const result=await readArchiveCollectionReport({lat:48.86,lon:2.35},request,env,now);
  expect(result.archiveDiagnostics.scope).toBe('not_covered');expect(result.snapshot).toBeNull();
  expect(result.archiveDiagnostics.observationIndex.measurements).toBeNull();expect(env.DB.prepare).not.toHaveBeenCalled();expect(env.BUCKET.get).not.toHaveBeenCalled();
 });
});

import {afterEach,expect,it,vi} from 'vitest';
import {readProviderRateLimit} from './providerRateLimit';
import {collectProviderRunBatch} from './providerRunCollection';
import {resetWeatherFetchCache} from './weatherFetch';

const now=Date.parse('2026-10-19T13:30:00Z');
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();resetWeatherFetchCache();});
it('respecte Retry-After et classe le quota sans promettre une date de rétablissement',async()=>{
 expect(await readProviderRateLimit(Response.json({reason:'Daily API request limit exceeded'},{status:429}),now)).toEqual({period:'day',retryAt:Date.parse('2026-10-20T00:01:00Z')});
 expect(await readProviderRateLimit(Response.json({reason:'Hourly API request limit exceeded'},{status:429,headers:{'Retry-After':'120'}}),now)).toEqual({period:'hour',retryAt:now+120000});
 expect((await readProviderRateLimit(new Response('invalide',{status:429,headers:{'Retry-After':new Date(now+3600000).toUTCString()}}),now))?.retryAt).toBe(now+3600000);
 expect((await readProviderRateLimit(new Response('invalide',{status:429,headers:{'Retry-After':'-1'}}),now))?.retryAt).toBe(now+600000);
 expect(await readProviderRateLimit(new Response('{}',{status:503}),now)).toBeNull();
});

function fakeTransport(onRun:(url:URL)=>Response){
 const calls:string[]=[];
 vi.spyOn(Date,'now').mockReturnValue(now);
 vi.stubGlobal('fetch',vi.fn(async(input:RequestInfo|URL)=>{
  const url=new URL(String(input));
  if(url.hostname==='api.open-meteo.com'){
   const id=url.pathname.split('/')[2];
   const run=Date.parse('2026-10-19T06:00:00Z')/1000+(id==='dwd_icon_eu'?10800:id==='ukmo_uk_deterministic_2km'?3600:id==='cmc_gem_gdps'?-86400:0);
   return Response.json({last_run_initialisation_time:run,last_run_availability_time:now/1000-3600,update_interval_seconds:21600,data_end_time:now/1000+(id==='cmc_gem_gdps'?-86400:172800)});
  }
  calls.push(url.toString());return onRun(url);
 }));return calls;
}
const input={targetDate:'2026-10-19',locationKey:'50.757_2.520',latitude:50.7567,longitude:2.5204};
it('ne demande aucun nouveau téléchargement pour un cycle déjà vérifié et signé',async()=>{
 const calls=fakeTransport(()=>{throw Error('Appel inutile');});
 const batch=await collectProviderRunBatch({...input,hasCapturedRun:async()=>true});
 expect(calls.length).toBe(0);expect(batch.captures.filter(c=>c.status==='already_archived').length).toBe(7);
});
it('arrête les lots restants au premier 429, sans relance individuelle',async()=>{
 const calls=fakeTransport(()=>Response.json({reason:'Daily API request limit exceeded'},{status:429}));
 const batch=await collectProviderRunBatch(input);
 expect(calls.length).toBe(1);expect(batch.rateLimit?.period).toBe('day');
 expect(batch.captures.filter(c=>c.status==='rate_limited').length).toBe(7);expect(batch.values).toEqual([]);
});
it('isole une erreur 400 de modèle une seule fois et ne copie pas la série d’un voisin',async()=>{
 const calls=fakeTransport(url=>{
  const ids=url.searchParams.get('models')!.split(',');
  if(ids.length>1||ids[0]==='gfs_seamless')return Response.json({error:true},{status:400});
  return Response.json({hourly_units:{temperature_2m:'°C'},hourly:{time:[now/1000+3600],temperature_2m:[12]}});
 });
 const batch=await collectProviderRunBatch({...input,hasCapturedRun:async(name)=>!['GFS','GEM'].includes(name)});
 expect(calls.length).toBe(3);expect(batch.captures.find(c=>c.modelName==='GFS')?.status).toBe('request_failed');
 expect(batch.captures.find(c=>c.modelName==='GEM')?.status).toBe('succeeded');
 expect(batch.values.every(v=>v.modelName==='GEM')).toBe(true);
});

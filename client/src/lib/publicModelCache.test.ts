import {describe,expect,it} from 'vitest';
import {PublicModelCache,PUBLIC_MODEL_CACHE,PUBLIC_MODEL_TTL_MS} from './publicModelCache';
function storage(){
 const rows=new Map<string,Response>();
 const cache={match:async(r:Request)=>rows.get(r.url)?.clone(),put:async(r:Request,v:Response)=>{rows.set(r.url,v.clone());},delete:async(r:Request)=>rows.delete(r.url),keys:async()=>Array.from(rows.keys()).map(url=>new Request(url))};
 return {rows,storage:{open:async(name:string)=>{expect(name).toBe(PUBLIC_MODEL_CACHE);return cache;}} as unknown as CacheStorage};
}
const origin='https://meteo.example',key='controle/weather-v2/model-collection-v1/50.757_2.520/2026-10-21';
const model=(at:number)=>JSON.stringify({at,value:{forecasts:[{modelName:'AROME',availableAt:at,requestStartedAt:at-1000,hours:[{temperature:0,precipitation:null}]}],diagnostics:[],collectedAt:new Date(at).toISOString()}});
describe('lots publics persistants',()=>{
 it('survit à une réouverture, garde le zéro, le null et les vraies dates de réception',async()=>{
  const at=Date.parse('2026-10-21T08:00Z'),disk=storage(),before=new PublicModelCache({origin,storage:disk.storage,now:()=>at});
  await before.put(key,model(at));
  const reopened=new PublicModelCache({origin,storage:disk.storage,now:()=>at+120000}),entry=await (await reopened.get(key))!.json();
  expect(entry.at).toBe(at);expect(entry.value.collectedAt).toBe(new Date(at).toISOString());expect(entry.value.forecasts[0]).toMatchObject({availableAt:at,requestStartedAt:at-1000,hours:[{temperature:0,precipitation:null}]});
  entry.value.forecasts[0].hours[0].temperature=999;
  expect((await (await reopened.get(key))!.json()).value.forecasts[0].hours[0].temperature).toBe(0);
 });
 it('expire réellement après trente minutes sans prolonger la fraîcheur à chaque lecture',async()=>{
  let now=Date.parse('2026-10-21T08:00Z');const disk=storage(),cache=new PublicModelCache({origin,storage:disk.storage,now:()=>now});
  await cache.put(key,model(now));now+=PUBLIC_MODEL_TTL_MS-1;expect(await cache.get(key)).not.toBeNull();
  now++;expect(await cache.get(key)).toBeNull();expect(disk.rows.size).toBe(0);
 });
 it('garde les lots quotidiens soixante minutes, y compris lors du nettoyage déclenché par un lot horaire',async()=>{
  let now=Date.parse('2026-10-21T08:00Z');const disk=storage(),cache=new PublicModelCache({origin,storage:disk.storage,now:()=>now}),daily='controle/weather-v2/daily-full-v4/50.757_2.520/2026-10-21/r1';
  await cache.put(daily,JSON.stringify({at:now,value:{days:[{tempMax:0}],modelsUsed:['AROME'],collectedAt:new Date(now).toISOString()}}));
  now+=45*60000;await cache.put(key,model(now));expect(await cache.get(daily)).not.toBeNull();now+=15*60000;expect(await cache.get(daily)).toBeNull();
 });
 it('sépare les lieux, les dates et les révisions d’apprentissage et exclut données courantes et Netatmo',async()=>{
  const at=Date.now(),disk=storage(),cache=new PublicModelCache({origin,storage:disk.storage,now:()=>at});
  await cache.put(key,model(at));expect(await cache.get(key.replace('50.757_2.520','45.924_6.870'))).toBeNull();expect(await cache.get(key.replace('2026-10-21','2026-10-22'))).toBeNull();
  for(const privateKey of ['current/50.757_2.520','netatmo/token','hourly-v5/50.757_2.520/2026-10-21/r1']){await cache.put('controle/weather-v2/'+privateKey,model(at));expect(await cache.get('controle/weather-v2/'+privateKey)).toBeNull();}
  const daily='controle/weather-v2/daily-full-v4/50.757_2.520/2026-10-21/revision-a';
  await cache.put(daily,JSON.stringify({at,value:{days:[{tempMax:0}],modelsUsed:['AROME'],collectedAt:new Date(at).toISOString()}}));
  expect(await cache.get(daily.replace('revision-a','revision-b'))).toBeNull();expect(disk.rows.size).toBe(2);
 });
 it('ignore les données vides, futures ou corrompues et fonctionne si le stockage est refusé',async()=>{
  const at=Date.now(),cache=new PublicModelCache({origin,storage:{open:async()=>{throw Error('Storage disabled');}} as unknown as CacheStorage,now:()=>at});
  await cache.put(key,model(at+1));expect(await cache.get(key)).toBeNull();
  await cache.put(key,'not-json');await cache.put(key,JSON.stringify({at,value:{forecasts:[],diagnostics:[],collectedAt:new Date(at).toISOString()}}));expect(await cache.get(key)).toBeNull();
  await cache.put(key,model(at));expect((await (await cache.get(key))!.json()).at).toBe(at);
 });
 it('borne le cache disque à douze entrées et ne touche pas au cache hors ligne',async()=>{
  let now=Date.now();const disk=storage(),cache=new PublicModelCache({origin,storage:disk.storage,now:()=>now});
  for(let i=0;i<15;i++){now++;await cache.put(key.replace('50.757_2.520',`${i}.000_2.520`),model(now));}
  expect(disk.rows.size).toBe(12);
 });
});

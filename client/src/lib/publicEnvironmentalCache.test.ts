import {afterEach,describe,expect,it,vi} from 'vitest';
import {PublicEnvironmentalCache,PUBLIC_ENVIRONMENTAL_CACHE,ENVIRONMENT_AIR_TTL_MS,ENVIRONMENT_WEATHER_TTL_MS} from './publicEnvironmentalCache';
function disk(){
 const rows=new Map<string,Response>();
 const cache={match:async(request:Request)=>rows.get(request.url)?.clone(),put:async(request:Request,response:Response)=>{rows.set(request.url,response.clone());},delete:async(request:Request)=>rows.delete(request.url),keys:async()=>Array.from(rows.keys()).map(url=>new Request(url))};
 return {rows,storage:{open:async(name:string)=>{expect(name).toBe(PUBLIC_ENVIRONMENTAL_CACHE);return cache;}} as unknown as CacheStorage};
}
const origin='https://meteo.example';
const weatherUrl=(lat=50.7567)=>new URL('https://api.open-meteo.com/v1/forecast?'+new URLSearchParams({latitude:String(lat),longitude:'2.5204',daily:'sunrise,sunset,daylight_duration,cloud_cover_mean',current:'cloud_cover',forecast_days:'16',timezone:'Europe/Paris'}));
const airUrl=(lat=50.7567)=>new URL('https://air-quality-api.open-meteo.com/v1/air-quality?'+new URLSearchParams({latitude:String(lat),longitude:'2.5204',current:'european_aqi,pm2_5,pm10,nitrogen_dioxide,ozone',hourly:'european_aqi',forecast_hours:'24',timezone:'Europe/Paris'}));
const weather={timezone:'Europe/Paris',daily:{time:['2026-10-21'],daylight_duration:[38000],cloud_cover_mean:[40]},current:{cloud_cover:null}};
const air={timezone:'Europe/Paris',current:{time:'2026-10-21T09:00',european_aqi:0,pm2_5:null,pm10:12,nitrogen_dioxide:null,ozone:null},hourly:{time:['2026-10-21T09:00'],european_aqi:[0]}};
afterEach(()=>{vi.useRealTimers();vi.unstubAllGlobals();});
describe('entrées environnementales persistantes',()=>{
 it('survit à une réouverture sans rajeunir les dates ni transformer zéro et null',async()=>{
  const at=Date.parse('2026-10-21T07:05Z'),store=disk(),first=new PublicEnvironmentalCache({origin,storage:store.storage,now:()=>at});
  await first.put(airUrl(),air,at);await first.put(weatherUrl(),weather,at);
  const reopened=new PublicEnvironmentalCache({origin,storage:store.storage,now:()=>at+5*60000});
  const result=await reopened.get(airUrl());expect(result).toEqual(air);expect(result?.current.time).toBe('2026-10-21T09:00');
  result!.current.european_aqi=999;expect((await reopened.get(airUrl()))?.current.european_aqi).toBe(0);
  expect((await reopened.get(weatherUrl()))?.current.cloud_cover).toBeNull();expect(store.rows.size).toBe(2);
  expect((await new PublicEnvironmentalCache({origin,storage:store.storage,now:()=>at+ENVIRONMENT_AIR_TTL_MS}).get(airUrl()))).toBeNull();
 });
 it('respecte les deux durées et sépare les coordonnées exactes',async()=>{
  let now=Date.parse('2026-10-21T07:05Z');const store=disk(),cache=new PublicEnvironmentalCache({origin,storage:store.storage,now:()=>now});
  await cache.put(airUrl(),air,now);await cache.put(weatherUrl(),weather,now);
  expect(await cache.get(airUrl(50.75671))).toBeNull();now+=ENVIRONMENT_WEATHER_TTL_MS;
  expect(await cache.get(weatherUrl())).toBeNull();expect(await cache.get(airUrl())).not.toBeNull();
  now+=ENVIRONMENT_AIR_TTL_MS-ENVIRONMENT_WEATHER_TTL_MS;expect(await cache.get(airUrl())).toBeNull();
 });
 it('ne prolonge pas les vingt minutes lorsqu’une réponse provient déjà du cache mémoire',async()=>{
  let now=Date.parse('2026-10-21T07:05Z');const receivedAt=now,cache=new PublicEnvironmentalCache({origin,now:()=>now});
  now+=11*60000;await cache.put(airUrl(),air,receivedAt);expect(await cache.get(airUrl())).toEqual(air);
  now=receivedAt+ENVIRONMENT_AIR_TTL_MS;expect(await cache.get(airUrl())).toBeNull();
 });
 it('invalide au changement de journée de Paris, y compris le jour du changement d’heure',async()=>{
  let now=Date.parse('2026-10-24T21:59Z');const cache=new PublicEnvironmentalCache({origin,now:()=>now});
  await cache.put(airUrl(),air,now);expect(await cache.get(airUrl())).not.toBeNull();now=Date.parse('2026-10-24T22:00Z');expect(await cache.get(airUrl())).toBeNull();
 });
 it('exclut modèles, comptes, jetons, relief et API non prévues, sans ouvrir de cache',async()=>{
  const open=vi.fn(),cache=new PublicEnvironmentalCache({origin,storage:{open} as unknown as CacheStorage});
  for(const url of [new URL(origin+'/api/netatmo/stations'),new URL('https://api.open-meteo.com/v1/elevation?latitude=50&longitude=2'),new URL('https://api.open-meteo.com/v1/forecast?hourly=temperature_2m'),new URL(airUrl()+'&apikey=secret')]){
   await cache.put(url,air,Date.now());expect(await cache.get(url)).toBeNull();
  }
  expect(open).not.toHaveBeenCalled();
 });
 it('rejette contenu invalide, futur ou corrompu et fonctionne si le stockage est refusé',async()=>{
  const at=Date.parse('2026-10-21T07:05Z'),store=disk(),cache=new PublicEnvironmentalCache({origin,storage:store.storage,now:()=>at});
  await cache.put(airUrl(),{error:true},at);await cache.put(airUrl(),air,at+1);expect(store.rows.size).toBe(0);
  await cache.put(airUrl(),air,at);const key=Array.from(store.rows.keys())[0];store.rows.set(key,new Response('{corrompu'));
  expect(await new PublicEnvironmentalCache({origin,storage:store.storage,now:()=>at}).get(airUrl())).toBeNull();expect(store.rows.size).toBe(0);
  const noDisk=new PublicEnvironmentalCache({origin,storage:{open:async()=>{throw Error('Refusé');}} as unknown as CacheStorage,now:()=>at});
  await noDisk.put(airUrl(),air,at);expect(await noDisk.get(airUrl())).toEqual(air);
 });
 it('borne son stockage propre sans toucher au cache météo ou aux illustrations',async()=>{
  let now=Date.parse('2026-10-21T07:05Z');const store=disk(),cache=new PublicEnvironmentalCache({origin,storage:store.storage,now:()=>now});
  for(let i=0;i<19;i++){now++;await cache.put(airUrl(40+i/100),air,now);}
  expect(store.rows.size).toBe(16);
 });
 it('réouvre les vraies cartes à partir des données brutes tout en recalculant la position des astres',async()=>{
  vi.useFakeTimers({toFake:['Date']});const start=Date.parse('2026-10-21T07:05Z');vi.setSystemTime(start);
  const store=disk(),fetcher=vi.fn(async(input:any)=>Response.json(new URL(String(input)).hostname.startsWith('air-quality')?air:weather));vi.stubGlobal('fetch',fetcher);
  vi.resetModules();const before=await import('../../../server/environmentalData');
  const coords={lat:50.7567,lon:2.5204},a=await before.getEnvironmentalSnapshot(coords,{jsonCache:new PublicEnvironmentalCache({origin,storage:store.storage})});
  expect(fetcher).toHaveBeenCalledTimes(2);expect(store.rows.size).toBe(2);
  vi.setSystemTime(start+5*60000);vi.resetModules();const after=await import('../../../server/environmentalData');
  const b=await after.getEnvironmentalSnapshot(coords,{jsonCache:new PublicEnvironmentalCache({origin,storage:store.storage})});
  expect(fetcher).toHaveBeenCalledTimes(2);expect(b.air).toEqual(a.air);expect(b.astronomy?.altitudeCalculatedAt).toBe(new Date(start+5*60000).toISOString());expect(b.astronomy?.sunAltitudeDeg).not.toBe(a.astronomy?.sunAltitudeDeg);
  vi.setSystemTime(start+21*60000);vi.resetModules();const expired=await import('../../../server/environmentalData');
  await expired.getEnvironmentalSnapshot(coords,{jsonCache:new PublicEnvironmentalCache({origin,storage:store.storage})});expect(fetcher).toHaveBeenCalledTimes(4);
 },20000);
});

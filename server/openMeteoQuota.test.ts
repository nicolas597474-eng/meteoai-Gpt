import {afterEach,expect,it,vi} from 'vitest';
import {fetchWeather,resetWeatherFetchCache,getWeatherResponseAttemptCount} from './weatherFetch';
import {browserWeatherQuota,type WeatherQuotaStore} from './openMeteoQuota';
import {getOpenMeteoTrafficBuckets,resetOpenMeteoTraffic} from './openMeteoTraffic';
import {summarizeTraffic} from '../shared/openMeteoTraffic';
afterEach(()=>{vi.useRealTimers();vi.unstubAllGlobals();resetWeatherFetchCache();resetOpenMeteoTraffic();});
it('un refus quotidien arrête les réessais et les autres demandes du même serveur sans inventer de nouvel HTTP 429',async()=>{
 vi.useFakeTimers();vi.setSystemTime(new Date('2026-10-22T04:00Z'));
 let saved:any=null;const store:WeatherQuotaStore={read:async()=>saved,write:async(_p,v)=>{saved=v;}};
 const network=vi.fn().mockResolvedValueOnce(Response.json({reason:'Daily API request limit exceeded. Please try again tomorrow.'},{status:429})).mockResolvedValue(Response.json({ok:true}));vi.stubGlobal('fetch',network);
 const first=await fetchWeather('https://api.open-meteo.com/v1/forecast?daily=x',{}, {attempts:3,quotaStore:store,cacheTtlMs:0});
 expect(first.status).toBe(429);expect(network).toHaveBeenCalledTimes(1);expect(saved.period).toBe('day');
 const blocked=await fetchWeather('https://api.open-meteo.com/v1/forecast?hourly=y',{}, {quotaStore:store});
 expect(blocked.headers.get('X-MeteoAI-Quota-Suspended')).toBe('1');expect(getWeatherResponseAttemptCount(blocked)).toBe(0);expect(network).toHaveBeenCalledTimes(1);
 expect(summarizeTraffic(getOpenMeteoTrafficBuckets(),24).totals.rateLimited).toBe(1);
 vi.setSystemTime(saved.retryAt);expect((await fetchWeather('https://api.open-meteo.com/v1/forecast?hourly=y',{}, {quotaStore:store})).ok).toBe(true);expect(network).toHaveBeenCalledTimes(2);
});
it('le quota du serveur ne bloque ni un autre contexte ni les métadonnées et laisse relire le cache',async()=>{
 const network=vi.fn().mockResolvedValue(Response.json({value:0}));vi.stubGlobal('fetch',network);
 let value:any=null;const store:WeatherQuotaStore={read:async()=>value,write:async(_p,v)=>{value=v;}};
 const url='https://api.open-meteo.com/v1/forecast?daily=cached';
 await fetchWeather(url,{}, {quotaStore:store,cacheTtlMs:60000});value={retryAt:Date.now()+60000,period:'minute'};
 expect(await (await fetchWeather(url,{}, {quotaStore:store})).json()).toEqual({value:0});expect(network).toHaveBeenCalledTimes(1);
 await fetchWeather('https://api.open-meteo.com/v1/forecast?daily=other',{}, {quotaStore:{read:async()=>null,write:async()=>{}}});
 await fetchWeather('https://api.open-meteo.com/data/metadata.json',{}, {quotaStore:store});expect(network).toHaveBeenCalledTimes(3);
});
it('une suspension du navigateur persiste après réouverture, conserve le délai le plus long et expire',async()=>{
 vi.useFakeTimers();vi.setSystemTime(new Date('2026-10-23T08:00Z'));
 const rows=new Map<string,string>();vi.stubGlobal('window',{localStorage:{getItem:(k:string)=>rows.get(k)??null,setItem:(k:string,v:string)=>rows.set(k,v)}});
 const until=Date.now()+3600000;await browserWeatherQuota.write('forecast',{period:'hour',retryAt:until});await browserWeatherQuota.write('forecast',{period:'minute',retryAt:Date.now()+60000});
 expect((await browserWeatherQuota.read('forecast'))?.retryAt).toBe(until);expect(rows.size).toBe(1);vi.setSystemTime(until);expect(await browserWeatherQuota.read('forecast')).toBeNull();
});

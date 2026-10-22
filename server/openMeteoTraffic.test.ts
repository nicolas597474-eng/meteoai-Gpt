import {afterEach,expect,it,vi} from 'vitest';
import {fetchWeather,resetWeatherFetchCache} from './weatherFetch';
import {getOpenMeteoTrafficBuckets,observeOpenMeteo,resetOpenMeteoTraffic} from './openMeteoTraffic';
import {summarizeTraffic} from '../shared/openMeteoTraffic';
afterEach(()=>{resetWeatherFetchCache();resetOpenMeteoTraffic();vi.unstubAllGlobals();});
it('compte chaque tentative HTTP une seule fois, et distingue cache et demandes groupées',async()=>{
 const fetchMock=vi.fn().mockImplementation(async()=>new Response('{}'));
 vi.stubGlobal('fetch',fetchMock);
 const url='https://api.open-meteo.com/v1/forecast?hourly=temperature_2m&latitude=50.7&apikey=secret';
 await Promise.all([fetchWeather(url,{}, {attempts:1,cacheTtlMs:10000}),fetchWeather(url,{}, {attempts:1,cacheTtlMs:10000})]);
 await fetchWeather(url,{}, {attempts:1,cacheTtlMs:10000});
 const rows=getOpenMeteoTrafficBuckets(),summary=summarizeTraffic(rows,24);
 expect(fetchMock).toHaveBeenCalledTimes(1);
 expect(summary.totals).toMatchObject({requests:1,success:1,cacheHits:1,shared:1,retries:0});
 expect(JSON.stringify(rows)).not.toMatch(/secret|latitude|50\.7|apikey|https/);
});
it('conserve les erreurs serveur transitoires précédant un succès et les erreurs réseau',async()=>{
 vi.stubGlobal('fetch',vi.fn().mockResolvedValueOnce(new Response('{}',{status:503})).mockResolvedValueOnce(new Response('{}')).mockRejectedValueOnce(new Error('offline')));
 await fetchWeather('https://single-runs-api.open-meteo.com/v1/forecast?hourly=x',{}, {attempts:2,cacheTtlMs:0});
 await expect(fetchWeather('https://api.open-meteo.com/v1/forecast?daily=x',{}, {attempts:1})).rejects.toThrow();
 expect(summarizeTraffic(getOpenMeteoTrafficBuckets(),24).totals).toMatchObject({requests:3,success:1,httpErrors:1,rateLimited:0,networkErrors:1,retries:1});
});
it('un refus 429 Open-Meteo reste compté sans relance automatique',async()=>{
 const transport=vi.fn().mockResolvedValue(new Response('{}',{status:429}));vi.stubGlobal('fetch',transport);
 const response=await fetchWeather('https://api.open-meteo.com/v1/forecast?daily=x',{}, {attempts:2,cacheTtlMs:0});
 expect(response.status).toBe(429);expect(transport).toHaveBeenCalledTimes(1);
 expect(summarizeTraffic(getOpenMeteoTrafficBuckets(),24).totals).toMatchObject({requests:1,success:0,httpErrors:1,rateLimited:1,networkErrors:0,retries:0});
});
it('borne les créneaux à 48 heures et ignore Netatmo et les faux domaines',()=>{
 const now=Date.parse('2026-10-21T04:15:00Z');
 observeOpenMeteo('https://api.open-meteo.com/v1/forecast?daily=x','network',200,false,now-49*3600000);
 observeOpenMeteo('https://api.open-meteo.com/v1/forecast?daily=x','network',200,false,now);
 observeOpenMeteo('https://api.netatmo.com/api/getpublicdata','network',200,false,now);
 observeOpenMeteo('https://open-meteo.com.attacker.invalid/','network',200,false,now);
 expect(getOpenMeteoTrafficBuckets()).toHaveLength(1);
 expect(summarizeTraffic(getOpenMeteoTrafficBuckets(),48,now).totals.requests).toBe(1);
 expect(summarizeTraffic(getOpenMeteoTrafficBuckets(),24,now+25*3600000).totals.requests).toBe(0);
});

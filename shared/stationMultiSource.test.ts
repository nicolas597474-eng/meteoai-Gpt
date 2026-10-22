import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {publicStations} from '../worker/netatmo-api.mjs';
import {buildStationSearchReadModel} from './stationSearchReadModel';
import {stationModelReferences,stationSummaryCoverage} from './stationModelReferences';
import {projectLiveComparison,type LiveComparison} from './liveModelComparison';
const now=Date.parse('2026-10-20T09:14:00Z'),t=Math.floor((now-7*60000)/1000),coords={lat:50.7567,lon:2.5204,radiusKm:20};
const fixture=()=>[{_id:'outdoor',place:{city:'Hondeghem',location:[2.5204,50.7667]},measures:{outside:{type:['temperature','humidity'],res:{[t]:[10,92]}},base:{type:'pressure',res:{[t-60]:[1022.4]}},wind:{wind_strength:12,wind_angle:258,gust_strength:23,wind_timeutc:t-120},rain:{rain_60min:0,rain_24h:99,rain_live:5,rain_timeutc:t-180}}}];
beforeEach(()=>vi.useFakeTimers().setSystemTime(now));afterEach(()=>vi.useRealTimers());
function read(body:any=fixture()){return buildStationSearchReadModel(coords,{rows:publicStations(body,coords.lat,coords.lon,50,now)});}
describe('synthèse multi-source — chaîne fournisseur vers noyau local',()=>{
 it('conserve pression, vent, rafales, direction et pluie horaire avec les heures propres et les unités Netatmo',()=>{
  const data=read(),station=data.stations[0];
  expect(station.pressure).toBe(1022.4);expect(station.windSpeed).toBe(12);expect(station.windGust).toBe(23);expect(station.windDirection).toBe(258);expect(station.precipitation).toBe(0);
  expect(station.measurementTimes?.pressure).toBe(new Date((t-60)*1000).toISOString());expect(station.measurementTimes?.windSpeed).toBe(new Date((t-120)*1000).toISOString());expect(station.measurementTimes?.precipitation).toBe(new Date((t-180)*1000).toISOString());
  for(const field of ['pressure','windSpeed','windGust','precipitation'] as const){expect(data.groundTruth[field]).toBeCloseTo(station[field]!);expect(stationSummaryCoverage(data.groundTruth,field).count).toBe(1);}
 });
 it('refuse les capteurs périmés/futurs ou sans heure sans perdre la température fraîche',()=>{
  const body=fixture();body[0].measures.base.res={[t-7200]:[1020]};body[0].measures.wind.wind_timeutc=t+3600;delete (body[0].measures.rain as any).rain_timeutc;
  const data=read(body);expect(data.groundTruth.temperature).toBe(10);expect(data.groundTruth.pressure).toBeNull();expect(data.groundTruth.windSpeed).toBeNull();expect(data.groundTruth.windGust).toBeNull();expect(data.groundTruth.precipitation).toBeNull();
 });
 it('un capteur manquant ne devient ni zéro ni une prévision ; la pluie 24 h ne remplace pas le cumul 1 h',()=>{
  const body=fixture();delete (body[0].measures.rain as any).rain_60min;delete (body[0].measures as any).wind;
  const data=read(body);expect(data.groundTruth.precipitation).toBeNull();expect(data.groundTruth.windSpeed).toBeNull();expect(stationSummaryCoverage(data.groundTruth,'windSpeed').count).toBe(0);
 });
 it('la pression seule utilise son horodatage, sans emprunter celui de la température',()=>{
  const body=fixture();delete (body[0].measures as any).wind;const data=read(body);expect(data.groundTruth.pressure).toBeCloseTo(1022.4);expect(data.groundTruth.windSpeed).toBeNull();
 });
});
const collection=()=>projectLiveComparison({collectedAt:new Date(now).toISOString(),forecasts:[{modelName:'AROME',availableAt:now-1000,hours:[{validAt:Date.parse('2026-10-20T09:00:00Z'),temperature:11,humidity:90,pressure:1020,windSpeed:15,windGust:27,windDirection:260,precipitation:0}]},{modelName:'best_match',availableAt:now-1000,hours:[{validAt:Date.parse('2026-10-20T09:00:00Z'),temperature:12}]}],diagnostics:[]},[],now);
describe('références Open-Meteo séparées des stations',()=>{
 it('raccorde uniquement les modèles individuels à la même heure et conserve les rafales et la direction',()=>{
  const data=read(),original=JSON.stringify(data.groundTruth),comparison=collection();
  const refs=stationModelReferences(comparison,data.groundTruth,now);expect(refs).toHaveLength(1);expect(refs[0]).toMatchObject({name:'AROME',temperature:11,windGust:27,windDirection:260,precipitation:0,localDeltaC:1,localStationCount:1,coherenceWeight:null});expect(refs[0].updatedAt).toBe('2026-10-20T09:00:00.000Z');expect(JSON.stringify(data.groundTruth)).toBe(original);
 });
 it('ne compte pas le cache périmé, une autre heure, un modèle dupliqué, vide ou une collecte future',()=>{
  const data=collection();expect(stationModelReferences({...data,stale:true},null,now)).toEqual([]);
  const a=data.models[0];data.models.push({...a});expect(stationModelReferences(data,null,now)).toHaveLength(1);
  for(const model of [{...a,collectedAt:now+1},{...a,collectedAt:now-31*60000},{...a,hours:a.hours.map(h=>({...h,validAt:h.validAt+3600000}))},{...a,hours:[]}])expect(stationModelReferences({...data,models:[model]} as LiveComparison,null,now)).toEqual([]);
 });
 it('conserve les variables partielles sans inventer un écart de température',()=>{
  const data=collection();data.models[0].hours[0].temperature=null;const refs=stationModelReferences(data,null,now);expect(refs).toHaveLength(1);expect(refs[0].temperature).toBeNull();expect(refs[0].localDeltaC).toBeNull();
 });
});

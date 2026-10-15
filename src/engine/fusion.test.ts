import { beforeEach, describe, expect, it, vi } from 'vitest';
import { blendedDimensions, dailyForecast, detectRegimes, distance, emptyHour, fuseForecast, horizonBucket, localAdjustment, METRICS, modelWeights, MODELS, parisDate, scoreModel } from './fusion';
import type { Forecast, Hour, Station, Verification } from '../types';
import { addObservation, DEFAULT_PLACE, read, saveForecast, verifications } from '../lib/storage';
const time=Date.UTC(2026,9,15,10),base={...emptyHour(time),temp:15,rain:0,wind:10,humidity:70,pressure:1015,cloud:40,direction:359,code:2};
function forecast(values:(number|null)[],reference=100):Forecast{return {place:DEFAULT_PLACE,fetchedAt:time-3600000,solar:[],models:[...values.map((temp,i)=>({model:MODELS[i],hours:[{...base,temp,direction:i===0?359:1}],elevation:30,fetchedAt:time-3600000})),{model:MODELS[7],hours:[{...base,temp:reference}],elevation:30,fetchedAt:time-3600000}]};}
function record(id:string,error:number,date=time):Verification{return {prediction:{placeId:DEFAULT_PLACE.id,modelId:id,issuedAt:date-2*3600000,hour:{...base,time:date,temp:15+error}},observation:{id:String(date),placeId:DEFAULT_PLACE.id,time:date,values:{temp:15},source:'test'}};}
beforeEach(()=>{let storage=new Map<string,string>();vi.stubGlobal('localStorage',{getItem:(k:string)=>storage.get(k)??null,setItem:(k:string,v:string)=>storage.set(k,v)});vi.useRealTimers();});
describe('fusion et provenance',()=>{
  it('fusionne les modèles physiques sans compter Best Match deux fois',()=>{const h=fuseForecast(forecast([10,20]),[])[0];expect(h.temp).toBe(15);expect(h.contributors).toBe(2);expect(h.tempSpread).toBe(10);expect(h.weights.best_match).toBeUndefined();});
  it('ne convertit pas une valeur absente en zéro',()=>{const h=fuseForecast(forecast([null,20]),[])[0];expect(h.temp).toBe(20);expect(h.tempSpread).toBeNull();expect(h.contributors).toBe(1);expect(h.stability).toBe(0);});
  it('identifie Best Match comme secours sans modèle physique',()=>{const h=fuseForecast(forecast([null],12),[])[0];expect(h.temp).toBe(12);expect(h.contributors).toBe(0);expect(h.confidence).toBeLessThan(20);});
  it('moyenne les directions sur un cercle',()=>{const h=fuseForecast(forecast([10,20]),[])[0];expect(Math.min(Math.abs(h.direction!),Math.abs(h.direction!-360))).toBeLessThan(.01);});
  it('sélectionne le code WMO par vote plutôt que moyenne',()=>{const f=forecast([10,20,15]);f.models[0].hours[0].code=0;f.models[1].hours[0].code=95;f.models[2].hours[0].code=95;expect(fuseForecast(f,[])[0].code).toBe(95);});
  it('renormalise les variables avec données partielles',()=>{const f=forecast([10,20]);f.models[0].hours[0].rain=null;f.models[1].hours[0].rain=2;expect(fuseForecast(f,[])[0].rain).toBe(2);});
  it('borne confiance et stabilité',()=>{for(const h of fuseForecast(forecast([-50,50]),[])){expect(h.confidence).toBeGreaterThanOrEqual(0);expect(h.confidence).toBeLessThanOrEqual(100);expect(h.stability).toBeGreaterThanOrEqual(0);}});
});
describe('scores et apprentissage',()=>{
  it('calcule MAE, RMSE et biais signé',()=>{const s=scoreModel([record('a',-1),record('a',3)],'a');expect(s.mae).toBe(2);expect(s.rmse).toBeCloseTo(Math.sqrt(5));expect(s.bias).toBe(1);});
  it('conserve des scores absents en l’absence d’observation',()=>{const s=scoreModel([],'a');expect(s.mae).toBeNull();expect(s.pod).toBeNull();expect(s.n).toBe(0);});
  it('calcule les événements pluvieux sans fausse précision',()=>{const records=[record('a',0),record('a',0),record('a',0)];records.forEach((r,i)=>{r.prediction.hour.rain=[1,1,0][i];r.observation.values.rain=[1,0,1][i];});const s=scoreModel(records,'a');expect(s.pod).toBe(.5);expect(s.far).toBe(.5);expect(s.csi).toBeCloseTo(1/3);});
  it('n’utilise pas une MAE isolée comme preuve d’apprentissage',()=>{const w=modelWeights(['a','b'],[record('a',.1),record('b',4)],detectRegimes(base));expect(w.a.temp).toBe(.5);expect(w.b.temp).toBe(.5);});
  it('utilise 1/MAE seulement avec 30 jours comparables et plafonne les poids',()=>{
    const now=Date.now(),ids=['a','b','c','d'];const records=ids.flatMap((id,i)=>Array.from({length:30},(_,d)=>record(id,i+1,now-d*86400000)));
    const w=modelWeights(ids,records,detectRegimes(base));expect(w.a.temp).toBeGreaterThan(w.d.temp);expect(w.a.temp).toBeLessThanOrEqual(.3500001);expect(ids.reduce((s,id)=>s+w[id].temp,0)).toBeCloseTo(1);
  });
  it('sépare les horizons courts des prévisions lointaines',()=>{expect(horizonBucket(5*3600000)).toBe('0–6 h');expect(horizonBucket(24*3600000)).toBe('6–24 h');expect(horizonBucket(10*86400000)).toBe('8–16 j');});
});
describe('régimes, dates et distance',()=>{
  it('normalise les 12 influences et les 6 dimensions',()=>{const r=detectRegimes(base),d=blendedDimensions(r);expect(r).toHaveLength(12);expect(r.reduce((s,v)=>s+v.influence,0)).toBeCloseTo(100);expect(METRICS.reduce((s,k)=>s+d[k],0)).toBeCloseTo(1);});
  it('n’affirme pas de neige pour une simple pluie froide',()=>{const r=detectRegimes({...base,temp:-1,rain:1,code:61});expect(r.find(r=>r.id==='snow')?.influence).toBe(0);});
  it('utilise la date de Paris près de minuit',()=>{expect(parisDate(Date.UTC(2026,6,1,23))).toBe('2026-07-02');});
  it('regroupe correctement le jour de changement d’heure',()=>{const f=forecast([15]);f.models.forEach(m=>m.hours=Array.from({length:25},(_,i)=>({...base,time:Date.UTC(2026,9,24,22)+i*3600000})));const days=dailyForecast(fuseForecast(f,[]),f);expect(days).toHaveLength(1);expect(days[0].date).toBe('2026-10-25');});
  it('calcule une distance sans déplacement artificiel',()=>{expect(distance(50,2,50,2)).toBe(0);expect(distance(50,2,51,2)).toBeCloseTo(111.19,1);});
});
describe('stations et vérité terrain',()=>{
  const station:Station={id:'s',name:'test',lat:50,lon:2,elevation:100,temp:20,time:Date.now()-10000,distance:1,reliability:90,source:'test',anomaly:false,interval:10};
  it('laisse le mode standard intact',()=>{const a=localAdjustment([station],base,'standard',200);expect(a.correction).toBe(0);expect(a.contributors).toHaveLength(0);});
  it('applique le gradient uniquement si les deux altitudes sont connues',()=>{expect(localAdjustment([station],base,'local',200).contributors[0].corrected).toBeCloseTo(19.35);expect(localAdjustment([{...station,elevation:null}],base,'local',200).contributors[0].corrected).toBe(20);});
  it('exclut les stations anciennes, futures et aberrantes',()=>{const stations=[{...station,time:Date.now()-2*3600000},{...station,time:Date.now()+3600000},{...station,anomaly:true}];expect(localAdjustment(stations,base,'ultra-local').contributors).toHaveLength(0);});
  it('borne l’ajustement et renormalise les poids',()=>{const a=localAdjustment([station,{...station,id:'s2',distance:8,temp:20}],base,'ultra-local');expect(a.correction).toBeLessThanOrEqual(3);expect(a.contributors.reduce((s,c)=>s+c.weight,0)).toBeCloseTo(1);});
  it('ne compare jamais une prévision capturée après l’observation',()=>{vi.spyOn(Date,'now').mockReturnValue(time);const f=forecast([14],14);f.fetchedAt=time;f.models.forEach(m=>m.hours=[{...base,time:time+2*3600000}]);saveForecast(f);addObservation({id:'late',placeId:DEFAULT_PLACE.id,time:time+2*3600000,values:{temp:15},source:'test'});expect(verifications(DEFAULT_PLACE.id).length).toBeGreaterThan(0);addObservation({id:'early',placeId:DEFAULT_PLACE.id,time:time+15*60000,values:{temp:15},source:'test'});expect(verifications(DEFAULT_PLACE.id).every(r=>r.prediction.issuedAt<=r.observation.time-3600000)).toBe(true);vi.restoreAllMocks();});
  it('ne réécrit pas une capture après actualisation',()=>{vi.spyOn(Date,'now').mockReturnValue(time);const f=forecast([14],14);f.models.forEach(m=>m.hours=[{...base,time:time+2*3600000,temp:14}]);saveForecast(f);f.models.forEach(m=>m.hours[0].temp=99);saveForecast(f);expect(read<any[]>(`predictions:${DEFAULT_PLACE.id}`,[])[0].hour.temp).toBe(14);vi.restoreAllMocks();});
});

import {describe,it,expect} from 'vitest';
import type {DashboardFusionTrace} from '@shared/dashboardFusionTrace';
import {hourlyDetailKey,selectedHourlyDetailIndex,findHourlyDetailTrace,hourlyDetailTemperature,formatHourlyDetailDate,formatHourlyDetailNumber} from './hourlyDetail';
const first=Date.parse('2026-10-25T00:00:00Z'),second=Date.parse('2026-10-25T01:00:00Z');
const hours=[{date:'2026-10-25',hour:'02:00',validAt:first},{date:'2026-10-25',hour:'02:00',validAt:second}];
function trace(value:number|null):DashboardFusionTrace[number]{return {validAt:second,variables:[{key:'temperature',label:'Température',unit:'°C',value,status:'UNCALIBRATED_ROBUST',selection:'weighted_ensemble_fallback',models:[],excluded:[],precipitation:null}]};}
describe('détails horaires alignés sur l’instant réel',()=>{
 it('formate les moyennes et petits cumuls sans flottants illisibles sur mobile',()=>{
   expect(formatHourlyDetailNumber(10.414285714285715)).toBe('10,4');
   expect(formatHourlyDetailNumber(0.04,2)).toBe('0,04');
   expect(formatHourlyDetailNumber(0)).toBe('0');
   expect(formatHourlyDetailNumber(null)).toBe('—');
   expect(formatHourlyDetailNumber(NaN)).toBe('—');
 });
 it('distingue les deux heures de Paris du changement d’heure',()=>{
   expect(hourlyDetailKey(hours[0])).not.toBe(hourlyDetailKey(hours[1]));
   expect(formatHourlyDetailDate(hours[0])).not.toBe(formatHourlyDetailDate(hours[1]));
   expect(selectedHourlyDetailIndex(hours,hourlyDetailKey(hours[1]))).toBe(1);
 });
 it('retrouve la même échéance après un changement de couverture sans choisir sa voisine',()=>{
   const target=hourlyDetailKey(hours[1]);
   expect(selectedHourlyDetailIndex([hours[1]],target)).toBe(0);
   expect(selectedHourlyDetailIndex([hours[0]],target)).toBeNull();
   expect(selectedHourlyDetailIndex(hours,null)).toBeNull();
 });
 it('ne réutilise jamais la trace d’une autre heure',()=>{
   expect(findHourlyDetailTrace([trace(12)],first)).toBeNull();
   expect(findHourlyDetailTrace([trace(12)],undefined)).toBeNull();
   expect(findHourlyDetailTrace([trace(12)],second)?.validAt).toBe(second);
 });
 it('sépare la température prévue de l’observation injectée sur le point actuel',()=>{
   const point={temp:20,multiModelMetrics:{temperature:{weightedMean:10}}};
   expect(hourlyDetailTemperature(point,trace(11),true)).toBe(11);
   expect(hourlyDetailTemperature(point,null,true)).toBe(10);
   expect(hourlyDetailTemperature({temp:20},null,true)).toBeNull();
   expect(hourlyDetailTemperature({temp:20},null,false)).toBe(20);
 });
 it('conserve les absences attestées et la température nulle',()=>{
   expect(hourlyDetailTemperature({temp:20},trace(null),false)).toBeNull();
   expect(hourlyDetailTemperature({temp:20},trace(0),true)).toBe(0);
   expect(hourlyDetailTemperature({temp:20,multiModelMetrics:{temperature:{weightedMean:null}}},null,false)).toBeNull();
 });
});

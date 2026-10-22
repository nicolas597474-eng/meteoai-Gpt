import {describe,it,expect} from 'vitest';
import {summarizeMeteoAIReliability,type MeteoAIPair} from './meteoaiReliability';
const pair=(date:string,kind:'hourly'|'daily',error:number):MeteoAIPair=>({kind,date,variable:kind==='hourly'?'temperature':'temperature_max',validAt:1,availableAt:0,observedAt:2,forecast:10+error,observed:10});
describe('Notes MeteoAI sur tout l’historique',()=>{
 it('note deux jours sans attendre sept dates et ignore la composante absente',()=>{
  const r=summarizeMeteoAIReliability([{date:'2024-01-01',pairs:[pair('2024-01-01','hourly',1)]},{date:'2026-10-20',pairs:[pair('2026-10-20','hourly',2)]}]);
  expect(r.hourly.note).toBe(7);expect(r.hourly.qualified).toBe(false);expect(r.hourly.evaluatedDays).toBe(2);expect(r.daily.note).toBeNull();expect(r.global.note).toBe(7);expect(r.global.partial).toBe(true);expect(r.startDate).toBe('2024-01-01');
 });
 it('donne le même poids aux deux catégories, sans laisser le nombre d’heures écraser le quotidien',()=>{
  const r=summarizeMeteoAIReliability([{date:'2026-10-20',pairs:[...Array.from({length:24},()=>pair('2026-10-20','hourly',1)),pair('2026-10-20','daily',3)]}]);
  expect(r.hourly.note).toBe(8);expect(r.daily.note).toBe(4);expect(r.global.note).toBe(6);expect(r.global.partial).toBe(false);
 });
 it('conserve les vrais zéros et borne la note sans transformer une absence en zéro',()=>{
  const r=summarizeMeteoAIReliability([{date:'2026-10-20',pairs:[pair('2026-10-20','hourly',0),pair('2026-10-20','daily',12)]}]);
  expect(r.hourly.note).toBe(10);expect(r.daily.note).toBe(0);expect(r.global.note).toBe(5);expect(summarizeMeteoAIReliability([]).global.note).toBeNull();
 });
 it('passe de provisoire à consolidé lorsque les deux critères sont réunis',()=>{
  const days=Array.from({length:7},(_,i)=>{const date='2026-10-'+(10+i);return {date,pairs:Array.from({length:5},()=>pair(date,'hourly',1))};});
  expect(summarizeMeteoAIReliability(days).hourly.qualified).toBe(true);expect(summarizeMeteoAIReliability(days.slice(0,6)).hourly.qualified).toBe(false);
  const partial=summarizeMeteoAIReliability(days,false);expect(partial.hourly.note).toBeNull();expect(partial.global.note).toBeNull();expect(partial.hourly.comparisonCount).toBe(35);
 });
});

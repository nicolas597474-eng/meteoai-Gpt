import {describe,it,expect} from 'vitest';
import {buildDailyPhysicalCoverage} from '../worker/daily-coverage';
import type {VerifiedObservation} from '../worker/observation-integrity';
const HOUR=3600000,now=Date.parse('2026-10-19T18:15:00Z');
function measurements(slots:number[],count=3):VerifiedObservation[]{return slots.flatMap(slot=>Array.from({length:count},(_,i)=>({stationKey:'station-'+i,measuredAt:slot+10*60000,receivedAt:slot+20*60000,temperature:0,flags:[],distance:i+1,elevation:null})));}
describe('couverture quotidienne physique candidate',()=>{
 it('applique le seuil original de 18 heures uniques, conserve zéro et indique une journée terminée',()=>{
  const slots=Array.from({length:18},(_,i)=>Date.parse('2026-10-18T00:00:00Z')+i*HOUR),rows=measurements(slots);
  const days=buildDailyPhysicalCoverage([...rows,...rows,...rows.map(row=>({...row,measuredAt:row.measuredAt+60000}))],now);
  expect(days).toHaveLength(1);expect(days[0]).toMatchObject({date:'2026-10-18',measuredHours:18,usableHours:18,thresholdMet:true,closedDay:true});expect(days[0].hours).toHaveLength(18);
 });
 it('ne cumule pas les heures de deux journées pour franchir le seuil',()=>{
  const slots=Array.from({length:18},(_,i)=>Date.parse('2026-10-18T16:00:00Z')+i*HOUR),days=buildDailyPhysicalCoverage(measurements(slots),now);
  expect(days).toHaveLength(2);expect(days.map(day=>day.usableHours).sort((a,b)=>a-b)).toEqual([6,12]);expect(days.every(day=>!day.thresholdMet)).toBe(true);expect(days[0].closedDay).toBe(false);
 });
 it('n’injecte ni heure en cours, ni future, ni station signalée ou hors rayon dans la couverture exploitable',()=>{
  const slot=Date.parse('2026-10-19T17:00:00Z'),rows=measurements([slot]);rows[0].flags=['source_flagged'];
  const days=buildDailyPhysicalCoverage([...rows,...measurements([slot+HOUR]),...measurements([slot+2*HOUR])],now);
  expect(days[0]).toMatchObject({measuredHours:1,usableHours:0,pendingHours:1,thresholdMet:false});
  const far=measurements([slot]);far[0].distance=21;expect(buildDailyPhysicalCoverage(far,now)[0].usableHours).toBe(0);
 });
 it('exclut les deux créneaux de l’heure répétée à Paris, sans gonfler le compteur',()=>{
  const slots=['2026-10-25T00:00:00Z','2026-10-25T01:00:00Z','2026-10-25T02:00:00Z'].map(Date.parse);
  const days=buildDailyPhysicalCoverage(measurements(slots),Date.parse('2026-10-26T02:00:00Z'));
  expect(days[0]).toMatchObject({date:'2026-10-25',ambiguousHours:2,usableHours:1,measuredHours:1});expect(days[0].hours).toEqual([3]);
 });
 it('ne remplit pas les dates absentes et exige trois stations exploitables',()=>{
  expect(buildDailyPhysicalCoverage([],now)).toEqual([]);
  const slots=[Date.parse('2026-10-18T10:00:00Z')];expect(buildDailyPhysicalCoverage(measurements(slots,2),now)[0].usableHours).toBe(0);
 });
});

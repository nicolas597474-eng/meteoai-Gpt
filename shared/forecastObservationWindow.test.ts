import {describe,it,expect,vi} from 'vitest';
import {readForecastsBeforeObservedHours} from '../worker/forecast-observation-window';
const HOUR=3600000,now=Date.parse('2026-10-19T03:00:00Z');
const measurement=(measuredAt:number)=>({stationKey:'s',measuredAt,receivedAt:measuredAt+60000,temperature:0,flags:[],distance:1,elevation:null});
describe('sélection temporelle des archives',()=>{
 it('ne recherche que huit heures terminées distinctes et signale la borne',async()=>{
  const bindings:any[][]=[],env={DB:{prepare:vi.fn(()=>({bind(...args:any[]){bindings.push(args);return this;},async all(){return {results:[]};}}))},BUCKET:{get:vi.fn()}};
  const rows=Array.from({length:11},(_,i)=>measurement(now-(i+1)*HOUR+60000));rows.push(rows[0],measurement(now+1),{...measurement(now-15*HOUR),flags:['source_flagged']});
  const result=await readForecastsBeforeObservedHours(env,rows,now);
  expect(result.searchedHours).toBe(8);expect(result.observedHours).toBe(11);expect(result.unmatchedHours).toBe(8);expect(result.boundedRead).toBe(true);expect(env.BUCKET.get).not.toHaveBeenCalled();
  expect(bindings[0]).toEqual(['50.757_2.520',new Date(now-HOUR).toISOString(),new Date(now-73*HOUR).toISOString()]);
 });
 it('écarte une archive à empreinte incorrecte et conserve le motif d’exclusion',async()=>{
  const env={DB:{prepare:()=>({bind(){return this;},all:async()=>({results:[{id:'invalid',digest:'bad',object_key:'bad'}]})})},BUCKET:{get:vi.fn()}};
  const result=await readForecastsBeforeObservedHours(env,[measurement(now-HOUR+1),measurement(now-2*HOUR+1)],now);
  expect(result.checkedArchives).toBe(1);expect(result.rejectedArchives).toBe(1);expect(result.captures).toEqual([]);expect(env.BUCKET.get).not.toHaveBeenCalled();
 });
 it('ne transforme pas une réponse SQL invalide en absence de prévision',async()=>{
  const env={DB:{prepare:()=>({bind(){return this;},all:async()=>({})})}};
  await expect(readForecastsBeforeObservedHours(env,[measurement(now-HOUR+1)],now)).rejects.toThrow('indisponible');
 });
});

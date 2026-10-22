import {describe,it,expect} from 'vitest';
import {normalizeCollectionJournal} from '../worker/collection-journal';
import {OFFICIAL_HOURLY_MODELS} from '../server/officialModels';
const now=Date.parse('2026-10-19T04:00:00Z');
const model=OFFICIAL_HOURLY_MODELS[0];
const input=()=>({lat:50.7567,lon:2.5204,startedAt:now-1000,completedAt:now,diagnostics:[{modelName:model.name,modelId:model.modelId,status:'succeeded',attemptCount:1,hoursReceived:48,valuesReceived:960,expectedValueCount:960,expectedHoursCount:48,errorCode:null}]});
describe('journal de collecte à la consultation',()=>{
 it('garde les huit modèles sous la limite réseau malgré des traces internes volumineuses',()=>{
  const value=input() as any;
  value.diagnostics=[...OFFICIAL_HOURLY_MODELS,{name:'best_match',modelId:null}].map(m=>({...value.diagnostics[0],modelName:m.name,modelId:m.modelId,variableDiagnostics:{raw:'x'.repeat(100000)}}));
  expect(JSON.stringify(value).length).toBeGreaterThan(50000);
  const text=JSON.stringify(normalizeCollectionJournal(value,now));
  expect(text.length).toBeLessThan(5000);expect(JSON.parse(text).diagnostics).toHaveLength(8);expect(text).not.toContain('variableDiagnostics');
 });
 it('conserve un vrai résultat et retire tout texte ou champ libre non nécessaire',()=>{
  const value=input() as any;value.secret='clé-secrète';value.diagnostics[0].rawResponse='jeton';value.diagnostics[0].errorCode='https://exemple.invalid?token=secret';
  const result=normalizeCollectionJournal(value,now);expect(result.diagnostics[0].errorCode).toBe('collection_failed');expect(JSON.stringify(result)).not.toContain('secret');expect(result.timingScope).toBe('batch');expect(result.origin).toBe('browser');
 });
 it('refuse les lieux, dates, modèles, doublons et compteurs invalides',()=>{
  const changes=[(v:any)=>v.lon=4,(v:any)=>v.completedAt=now-2000,(v:any)=>v.startedAt=now-1800001,(v:any)=>v.diagnostics[0].modelName='inventé',(v:any)=>v.diagnostics[0].modelId='autre',(v:any)=>v.diagnostics.push(v.diagnostics[0]),(v:any)=>v.diagnostics[0].attemptCount=0,(v:any)=>v.diagnostics[0].hoursReceived=NaN];
  for(const change of changes){const value=input();change(value);expect(()=>normalizeCollectionJournal(value,now)).toThrow();}
 });
 it('accepte un vrai échec sans créer de prévisions ou une heure d’émission fournisseur',()=>{
  const value=input();value.diagnostics[0]={...value.diagnostics[0],status:'failed',hoursReceived:0,valuesReceived:0,errorCode:'timeout' as any};
  const result=normalizeCollectionJournal(value,now);expect(result.diagnostics[0].status).toBe('failed');expect(result).not.toHaveProperty('forecasts');expect(result).not.toHaveProperty('providerRunAt');
 });
});

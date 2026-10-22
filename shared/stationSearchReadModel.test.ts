import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {buildStationSearchReadModel,stationSearchInput} from './stationSearchReadModel';
const now=Date.parse('2026-10-18T14:00:00Z'),coords={lat:50.7567,lon:2.5204,radiusKm:50};
const row=(extra={})=>({id:'netatmo-test',name:'Station test',lat:50.7667,lon:2.5204,temp:0,time:now-600000,distance:0,reliability:95,elevation:15,anomaly:false,...extra});
beforeEach(()=>vi.useFakeTimers().setSystemTime(now));afterEach(()=>vi.useRealTimers());
describe('stations physiques AI Lab',()=>{
 it('conserve zéro, les heures propres et les variables manquantes sans injecter de modèle',()=>{
  const data=buildStationSearchReadModel(coords,{rows:[row()],fetchedAt:new Date(now-60000).toISOString(),fromCache:true});
  expect(data.totalFound).toBe(1);expect(data.stations[0].sourceKind).toBe('physical');
  expect(data.stations[0].distanceKm).toBeGreaterThan(1);expect(data.stations[0].temperature).toBe(0);
  expect(data.groundTruth.temperature).toBe(0);expect(data.groundTruth.humidity).toBeNull();
  expect(data.groundTruth.windSpeed).toBeNull();expect(data.modelReferences).toEqual([]);
  expect(data.groundTruth.altitudeCorrection.applied).toBe(false);
  expect(data.sourceDiagnosticsFromCache).toBe(true);expect(data.fetchedAt).toBe(new Date(now-60000).toISOString());
  expect(data).not.toHaveProperty('qualifiedScoreCount');
 });
 it('distingue recherche à 50 km et synthèse locale à 30 km, sans étendre le noyau',()=>{
  const data=buildStationSearchReadModel(coords,{rows:[row({id:'netatmo-far',lat:51.15}),row({id:'netatmo-out',lat:51.3})]});
  expect(data.totalFound).toBe(1);expect(data.stations[0].distanceKm).toBeGreaterThan(40);
  expect(data.groundTruth.stationCount).toBe(0);expect(data.groundTruth.temperature).toBeNull();
  expect(data.physicalStationDiagnostics.exclusionReasons.length).toBeGreaterThan(0);
 });
 it('réévalue la fraîcheur depuis le relevé, même si la réponse provient du cache',()=>{
  const data=buildStationSearchReadModel(coords,{rows:[row({id:'netatmo-stale',time:now-75*60000}),row({id:'netatmo-future',time:now+60000}),row({id:'netatmo-anomaly',anomaly:true})],fromCache:true});
  expect(data.totalFound).toBe(3);expect(data.activeCount).toBe(1);
  expect(data.groundTruth.temperature).toBeNull();expect(data.groundTruth.stationsUsed).toEqual([]);
  expect(data.physicalStationDiagnostics.exclusionReasons.length).toBeGreaterThan(0);
 });
 it('ne compte pas deux fois un identifiant et ne promeut pas une référence de modèle',()=>{
  const data=buildStationSearchReadModel(coords,{rows:[row({temp:2,time:now-1200000}),row(),row({id:'openmeteo-grid',temp:99})]});
  expect(data.totalFound).toBe(1);expect(data.stations[0].temperature).toBe(0);
 });
 it('distingue réponse vide, source déconnectée, panne et hors ligne sans fausse collecte',()=>{
  const empty=buildStationSearchReadModel(coords,{rows:[]});
  expect(empty.sourceDiagnostics[0].status).toBe('success_empty');
  for(const [code,status] of [['NETATMO_NOT_CONNECTED','not_configured'],['NETATMO_RATE_LIMIT','error'],['OFFLINE','error']]){
   const data=buildStationSearchReadModel(coords,{rows:[row()],errorCode:code});
   expect(data.sourceDiagnostics[0].status).toBe(status);expect(data.stations).toEqual([]);
   expect(data.groundTruth.temperature).toBeNull();expect(data.fetchedAt).toBeNull();
  }
 });
 it('valide le lieu et le rayon avant toute collecte',()=>{
  expect(stationSearchInput(undefined)).toEqual(coords);
  for(const input of [{lat:NaN},{lon:181},{lat:86},{radiusKm:51},{radiusKm:0}])expect(()=>stationSearchInput(input)).toThrow();
 });
 it('transmet seulement une humidité valide mesurée avec la température, y compris zéro',()=>{
  const data=buildStationSearchReadModel(coords,{rows:[row({humidity:0})]});
  expect(data.stations[0].humidity).toBe(0);expect(data.groundTruth.humidity).toBe(0);
  expect(data.stations[0].measurementTimes?.humidity).toBe(new Date(now-600000).toISOString());
  for(const humidity of [undefined,null,NaN,101,-1,'60']){
   const s=buildStationSearchReadModel(coords,{rows:[row({humidity})]});
   expect(s.stations[0].humidity).toBeNull();expect(s.stations[0].measurementTimes?.humidity).toBeUndefined();
  }
 });
 it('renvoie les diagnostics compris par la page pour une panne, une déconnexion et une zone vide',()=>{
  expect(buildStationSearchReadModel(coords,{rows:[],errorCode:'OFFLINE'}).physicalStationDiagnostics.netatmoStatus).toBe('temporarily_unavailable');
  expect(buildStationSearchReadModel(coords,{rows:[],errorCode:'NETATMO_NOT_CONNECTED'}).physicalStationDiagnostics.netatmoStatus).toBe('not_connected');
  expect(buildStationSearchReadModel(coords,{rows:[]}).physicalStationDiagnostics.netatmoStatus).toBe('connected_empty');
  expect(buildStationSearchReadModel(coords,{rows:[row()]}).physicalStationDiagnostics.netatmoStatus).toBe('live');
 });
});

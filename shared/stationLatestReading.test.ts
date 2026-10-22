import {describe,it,expect} from 'vitest';
import {stationLatestReading} from './stationLatestReading';
const now=Date.parse('2026-10-20T08:00:00Z');
const station={stationId:'netatmo-test',latest:{observedAt:now-40*60000,temperature:10,humidity:90,windSpeed:8}};
const live={stationId:'netatmo-test',updatedAt:new Date(now-60000).toISOString(),temperature:0,humidity:0,windSpeed:null,isActive:true};
describe('dernier relevé réellement affiché',()=>{
 it('préfère la mesure directe plus récente, conserve les zéros et son propre âge',()=>{
  const result=stationLatestReading(station,live,now);
  expect(result.kind).toBe('live');expect(result.reading?.temperature).toBe(0);expect(result.reading?.humidity).toBe(0);expect(result.ageMinutes).toBe(1);
  expect(result.reading?.windSpeed).toBeNull();expect(station.latest.temperature).toBe(10);
 });
 it('conserve une archive plus récente, sans fusion des deux relevés',()=>{
  const result=stationLatestReading(station,{...live,updatedAt:new Date(now-60*60000).toISOString()},now);
  expect(result.kind).toBe('archive');expect(result.reading?.temperature).toBe(10);expect(result.ageMinutes).toBe(40);
 });
 it('ne choisit pas une autre station, une mesure signalée, future ou sans heure vérifiable',()=>{
  for(const bad of [{...live,stationId:'autre'},{...live,isActive:false},{...live,updatedAt:new Date(now+60000).toISOString()},{...live,updatedAt:null},{...live,measurementTimes:{temperature:null}}]){
   expect(stationLatestReading(station,bad,now).kind).toBe('archive');
  }
  expect(stationLatestReading({stationId:station.stationId,latest:null},null,now).reading).toBeNull();
 });
 it('signale une contradiction au même instant sans réécrire le relevé archivé',()=>{
  const result=stationLatestReading(station,{...live,updatedAt:new Date(station.latest.observedAt).toISOString()},now);
  expect(result.conflict).toBe(true);expect(result.kind).toBe('archive');expect(result.reading?.temperature).toBe(10);
 });
 it('ne transforme pas un champ absent ou invalide en zéro',()=>{
  const result=stationLatestReading({stationId:station.stationId},{...live,humidity:'0',pressure:NaN},now);
  expect(result.reading?.humidity).toBeNull();expect(result.reading?.pressure).toBeNull();expect(result.reading?.temperature).toBe(0);
 });
});

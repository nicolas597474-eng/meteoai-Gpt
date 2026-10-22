import {describe,it,expect} from 'vitest';
import {currentStationPresentation,usedLocalStations} from './currentStationPresentation';
const now=Date.parse('2026-10-20T08:00:00Z');
describe('carte et synthèse des stations actuelles',()=>{
 it('le compteur locales utilisées exclut les stations distantes, écartées, modèles et distances inconnues',()=>{
  const row={stationId:'proche',isUsed:true,sourceKind:'physical',distanceKm:30};
  const stations=[row,{...row,stationId:'loin',distanceKm:30.001},{...row,distanceKm:50},{...row,distanceKm:null},{...row,distanceKm:NaN},{...row,distanceKm:-1},{...row,isUsed:false},{...row,sourceKind:'model'}];
  expect(usedLocalStations(stations)).toEqual([row]);expect(usedLocalStations([])).toEqual([]);
 });
 it('distingue stations trouvées et contributions réellement utilisées, sans heure de rafraîchissement inventée',()=>{
  const stations=[{stationId:'a',isActive:true,temperature:0,humidity:0,updatedAt:new Date(now-10*60000).toISOString()},{stationId:'b',isActive:true,temperature:10,updatedAt:new Date(now-30*60000).toISOString()},{stationId:'c',isActive:false,temperature:15,updatedAt:new Date(now-60000).toISOString()}];
  const result=currentStationPresentation({stations,groundTruth:{stationsUsed:[{stationId:'a'},{stationId:'c'}]}},now);
  expect(result.stations).toHaveLength(3);expect(result.usedCount).toBe(1);
  expect(result.stations.map(s=>s.isUsed)).toEqual([true,false,false]);
  expect(result.stations[0].latest.temperature).toBe(0);expect(result.stations[0].latest.humidity).toBe(0);
  expect(result.lastMeasurementAt).toBe(now-10*60000);expect(result.stations[0].ageMinutes).toBe(10);
  expect(result.stations.every(s=>s.archivedReadingCount===null)).toBe(true);
 });
 it('reste vide sans données et ne transforme pas une date absente ou future en relevé récent',()=>{
  expect(currentStationPresentation(undefined,now)).toEqual({stations:[],usedCount:0,lastMeasurementAt:null});
  for(const updatedAt of [null,'invalide',new Date(now+60000).toISOString()]){
   const result=currentStationPresentation({stations:[{stationId:'a',isActive:true,updatedAt}],groundTruth:{stationsUsed:[{stationId:'a'}]}},now);
   expect(result.lastMeasurementAt).toBeNull();expect(result.stations[0].ageMinutes).toBeNull();expect(result.usedCount).toBe(0);expect(result.stations[0].isUsed).toBe(false);
  }
 });
 it('raccorde uniquement les compteurs des archives vérifiées du même lieu et du même rayon',()=>{
  const data={lat:50.7567,lon:2.5204,radiusKm:50,stations:[{stationId:'a',isActive:true,updatedAt:new Date(now-60000).toISOString()},{stationId:'b',isActive:true,updatedAt:new Date(now-60000).toISOString()}]};
  const overview={center:{lat:data.lat,lon:data.lon},radiusKm:50,archiveStatus:{status:'verified',boundedRead:false,rejectedArchives:0},stations:[{stationId:'b',readings:[]},{stationId:'a',readings:[{temperature:10},{temperature:11}]}]};
  expect(currentStationPresentation(data,now,overview).stations.map(s=>s.archivedReadingCount)).toEqual([2,0]);
  for(const other of [{...overview,radiusKm:20},{...overview,center:{lat:48.8,lon:2.3}},{...overview,archiveStatus:{status:'unavailable'}},{...overview,archiveStatus:{status:'verified',boundedRead:true}},{...overview,archiveStatus:{status:'verified',rejectedArchives:1}}]){
   expect(currentStationPresentation(data,now,other).stations.map(s=>s.archivedReadingCount)).toEqual([null,null]);
  }
  expect(currentStationPresentation(data,now,{...overview,stations:[]}).stations.map(s=>s.archivedReadingCount)).toEqual([null,null]);
 });
 it('garde la mesure courante et le motif réel distincts de la présence des archives',()=>{
  const data={lat:50,lon:2,radiusKm:50,stations:[{stationId:'a',isActive:true,temperature:0,humidity:0,updatedAt:new Date(now-60000).toISOString()}],groundTruth:{stationsUsed:[],stationsIgnored:[{stationId:'a',reason:'Hors rayon local'}]}};
  const overview={center:{lat:50,lon:2},radiusKm:50,archiveStatus:{status:'verified'},stations:[{stationId:'a',readings:[{temperature:20}],latest:{temperature:20}}]};
  const row=currentStationPresentation(data,now,overview).stations[0];
  expect(row.latest.temperature).toBe(0);expect(row.archivedReadingCount).toBe(1);expect(row.ageMinutes).toBe(1);expect(row.isUsed).toBe(false);expect(row.exclusionReason).toBe('Hors rayon local');
 });
});

import {describe,it,expect} from 'vitest';
import {terrainSamples,terrainHorizon,TERRAIN_DISTANCES_KM} from './terrainHorizon';
describe('horizon réel échantillonné',()=>{
 it('échantillonne aussi bien une colline proche qu’un massif distant',()=>{
  const samples=terrainSamples({lat:50.76,lon:2.52});
  expect(samples).toHaveLength(360);expect(TERRAIN_DISTANCES_KM[0]).toBe(.1);expect(TERRAIN_DISTANCES_KM.at(-1)).toBe(50);
  const north=samples.filter(p=>p.azimuthDeg===0),east=samples.find(p=>p.azimuthDeg===90)!;
  expect(north.at(-1)!.lat).toBeGreaterThan(51.2);expect(east.lon).toBeGreaterThan(2.52);
 });
 it('retient le sommet masquant et non uniquement le point à 5 km',()=>{
  const samples=terrainSamples({lat:45.9,lon:6.8});
  const elevations=samples.map(p=>p.azimuthDeg===180&&p.distanceKm===.5?200:100);
  const peak=terrainHorizon(samples,elevations,100).find(p=>p.azimuthDeg===180)!;
  expect(peak.distanceKm).toBe(.5);expect(peak.elevationDeg).toBeGreaterThan(11);expect(peak.elevationDeg).toBeLessThan(11.2);
  const far=terrainHorizon(samples,samples.map(p=>p.azimuthDeg===90&&p.distanceKm===20?2000:100),100).find(p=>p.azimuthDeg===90)!;
  expect(far.distanceKm).toBe(20);expect(far.elevationDeg).toBeGreaterThan(5);
 });
 it('conserve la courbure et l’abaissement d’un horizon sans inventer des sommets',()=>{
  const samples=terrainSamples({lat:50,lon:2});
  const flat=terrainHorizon(samples,samples.map(()=>100),100);
  expect(flat).toHaveLength(36);expect(flat.every(p=>p.elevationDeg<0&&p.elevationDeg>-.1)).toBe(true);
 });
 it('refuse les altitudes incomplètes et les coordonnées invalides',()=>{
  const samples=terrainSamples({lat:50,lon:2});
  expect(()=>terrainHorizon(samples,[0],0)).toThrow('incomplet');
  expect(()=>terrainHorizon(samples,samples.map(()=>NaN),0)).toThrow('incomplet');
  expect(()=>terrainSamples({lat:91,lon:2})).toThrow('invalides');
 });
});

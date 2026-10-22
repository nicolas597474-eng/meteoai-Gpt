import {describe,it,expect} from 'vitest';
import {stationChartGeometry} from './stationComparisonChart';
const point=(stationTemperature:number|null,officialTemperature:number|null)=>({stationTemperature,officialTemperature,stationSampleCount:3});
describe('tracé des températures stations/modèles',()=>{
 it('conserve un zéro et coupe chaque courbe à son heure manquante, sans comprimer le temps',()=>{
  const g=stationChartGeometry([point(0,1),point(null,null),point(2,3)],1);
  expect(g.hasPairs).toBe(true);expect(g.temperature).toHaveLength(2);expect(g.forecast).toHaveLength(2);
  expect(g.temperature[0]).toMatch(/^16\.0,/);expect(g.temperature[1]).toMatch(/^544\.0,/);
  expect(g.isolated('stationTemperature')).toHaveLength(2);
 });
 it('reste sans comparaison si les deux séries ne partagent aucun instant',()=>{
  expect(stationChartGeometry([point(0,null),point(null,1)],1).hasPairs).toBe(false);
  expect(stationChartGeometry([],1).labels).toEqual([]);
 });
 it('limite les libellés horaires pour mobile en conservant la première et la dernière date',()=>{
  const points=Array.from({length:24},(_,i)=>({...point(i,i),validAt:Date.UTC(2026,9,20,i),label:'Heure complète UTC '+i}));
  const g=stationChartGeometry(points,1);expect(g.labels).toHaveLength(4);expect(g.labels[0].index).toBe(0);expect(g.labels.at(-1)?.index).toBe(23);
  expect(g.labels.every(l=>l.text.length<=10)).toBe(true);expect(g.labels[0].title).toBe('Heure complète UTC 0');
  expect(stationChartGeometry(points.slice(0,7),7).labels).toHaveLength(7);
 });
});

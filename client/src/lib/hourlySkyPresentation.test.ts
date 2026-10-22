import {describe,it,expect} from 'vitest';
import {hourlySkyCondition} from './hourlySkyPresentation';
import {getIconNameFromCondition,MeteoIcon} from '@/components/MeteoIcon';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {dashboardCurrentIcon} from './dashboardCurrentIcon';
describe('présentation du ciel à l’échéance et au lieu',()=>{
 it('montre la lune dans une nuit claire et le soleil en journée',()=>{
  const point={weatherCode:0,condition:'sunny'};
  expect(hourlySkyCondition({...point,validAt:Date.parse('2026-10-21T01:00:00Z')},50.7567,2.5204)).toBe('clear_night');
  expect(hourlySkyCondition({...point,validAt:Date.parse('2026-10-21T12:00:00Z')},50.7567,2.5204)).toBe('sunny');
 });
 it('présente aussi les éclaircies nocturnes dans les rubans et graphiques sans soleil',()=>{
  for(const condition of ['few_clouds','partly_cloudy','Peu nuageux','Partiellement nuageux','Éclaircies']){
   const point={condition,validAt:Date.parse('2026-10-23T01:00:00Z')};
   const presented=hourlySkyCondition(point,50.7567,2.5204);
   expect(presented).toBe('partly_cloudy_night');
   expect(point.condition).toBe(condition);
   const icon=getIconNameFromCondition(presented);
   expect(icon).toBe('partly_cloudy_night');
   const html=renderToStaticMarkup(createElement(MeteoIcon,{name:icon}));
   expect(html).toContain('meteo3d-clear-night_9a98fab7.png');
   expect(html).toContain('meteo3d-overcast');
   expect(html).not.toContain('meteo3d-partly-cloudy');
  }
  expect(getIconNameFromCondition('Nuit partiellement nuageuse')).toBe('partly_cloudy_night');
 });
 it('utilise les codes seuls, le lieu et l’échéance future plutôt que l’heure de consultation',()=>{
  for(const weatherCode of [1,2])expect(hourlySkyCondition({weatherCode,validAt:Date.parse('2026-10-23T01:00Z')},50.7567,2.5204)).toBe('partly_cloudy_night');
  const point={condition:'partly_cloudy',validAt:Date.parse('2026-10-23T04:00Z')};
  expect(hourlySkyCondition(point,50.7567,2.5204)).toBe('partly_cloudy_night');
  expect(hourlySkyCondition(point,35,139)).toBe('partly_cloudy');
  expect(hourlySkyCondition({...point,validAt:Date.parse('2026-10-23T12:00Z')},50.7567,2.5204)).toBe('partly_cloudy');
 });
 it('emploie la même limite astronomique sur Dashboard et Prévisions près du lever et du coucher',()=>{
  const coords={lat:50.7567,lon:2.5204};
  for(const condition of ['Peu nuageux','Ensoleillé']){
   for(const start of ['2026-10-21T06:10Z','2026-10-21T16:20Z']){
    for(let minutes=0;minutes<=35;minutes++){
     const validAt=Date.parse(start)+minutes*60000;
     expect(dashboardCurrentIcon(condition,coords,validAt)).toBe(getIconNameFromCondition(hourlySkyCondition({condition,validAt},coords.lat,coords.lon)));
    }
   }
  }
 });
 it('respecte le libellé fourni même si un code contradictoire annonce un ciel dégagé',()=>{
  expect(hourlySkyCondition({weatherCode:0,condition:'Pluie',validAt:Date.parse('2026-10-23T01:00Z')},50.7567,2.5204)).toBe('Pluie');
  for(const condition of ['Ciel couvert','Brouillard','Neige','Orages'])expect(hourlySkyCondition({condition,validAt:Date.parse('2026-10-23T01:00Z')},50.7567,2.5204)).toBe(condition);
 });
 it('conserve la condition si l’échéance ou les coordonnées ne sont pas exploitables',()=>{
  for(const validAt of [null,undefined,NaN,Infinity,1e20])expect(hourlySkyCondition({condition:'partly_cloudy',validAt},50,2)).toBe('partly_cloudy');
  expect(hourlySkyCondition({condition:'partly_cloudy',validAt:Date.parse('2026-10-23T01:00Z')},91,2)).toBe('partly_cloudy');
 });
 it('ne remplace ni la pluie nocturne ni un état sans échéance connue',()=>{
  expect(hourlySkyCondition({weatherCode:61,condition:'rainy',validAt:Date.parse('2026-10-21T01:00:00Z')},50.7567,2.5204)).toBe('rainy');
  expect(hourlySkyCondition({weatherCode:0,condition:'sunny'},50.7567,2.5204)).toBe('sunny');
 });
});

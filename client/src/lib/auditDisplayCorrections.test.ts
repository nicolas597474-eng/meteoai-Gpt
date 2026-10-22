import {describe,it,expect} from 'vitest';
import {dashboardCurrentIcon} from './dashboardCurrentIcon';
import {weightDelta} from './weightDelta';
import {archivedCalculationLabel} from './archivedCalculation';
describe('corrections de présentation de l’audit',()=>{
 it('n’affiche pas de soleil avant son lever et conserve les phénomènes météorologiques',()=>{
  const place={lat:50.7567,lon:2.5204},before=Date.parse('2026-10-21T06:05Z'),day=Date.parse('2026-10-21T10:00Z');
  expect(dashboardCurrentIcon('Ensoleillé',place,before)).toBe('clear_night');
  expect(dashboardCurrentIcon('Peu nuageux',place,before)).toBe('partly_cloudy_night');
  expect(dashboardCurrentIcon('Partiellement nuageux',place,before)).toBe('partly_cloudy_night');
  expect(dashboardCurrentIcon('Pluie',place,before)).toBe('rainy');expect(dashboardCurrentIcon('Ciel couvert',place,before)).toBe('overcast');
  expect(dashboardCurrentIcon('Ensoleillé',place,day)).toBe('sunny');expect(dashboardCurrentIcon('Peu nuageux',place,day)).toBe('few_clouds');
  expect(dashboardCurrentIcon('Ensoleillé',place,Date.parse('2026-10-21T19:00Z'))).toBe('clear_night');
 });
 it('ne prend pas une heure fixe de Paris pour les autres lieux',()=>{
  const at=Date.parse('2026-10-21T04:00Z');
  expect(dashboardCurrentIcon('Ensoleillé',{lat:50,lon:2},at)).toBe('clear_night');
  expect(dashboardCurrentIcon('Ensoleillé',{lat:35,lon:139},at)).toBe('sunny');
 });
 it('aligne signes, couleur et décompte des variations à la précision affichée',()=>{
  for(const value of [0,-0,.00000001,-.00000001,.000049,-.000049])expect(weightDelta(value)).toEqual({direction:0,label:'0.00 pts'});
  expect(weightDelta(.00006)).toEqual({direction:1,label:'+0.01 pts'});expect(weightDelta(-.00006)).toEqual({direction:-1,label:'-0.01 pts'});
  expect(weightDelta(.1).label).toBe('+10.00 pts');expect(weightDelta(NaN)).toEqual({direction:0,label:'—'});
 });
 it('affiche l’heure du calcul réellement archivé, sans la remplacer par l’heure de lecture',()=>{
  expect(archivedCalculationLabel('2026-10-20T23:36:00Z')).toBe('Calcul archivé : 21/10/2026 01:36 (Paris)');
  for(const missing of [null,undefined,'','invalide',0])expect(archivedCalculationLabel(missing)).toBe('Heure de calcul non archivée');
 });
});

import {describe,it,expect} from 'vitest';
import {dailyDisplayDate,dailyDetailDate,selectedDailyIndex,dailyForecastForToday} from './dailyDetail';
describe('jours du Dashboard en heure de Paris',()=>{
 it('indique aujourd’hui à Paris même lorsque la date UTC est celle de la veille',()=>{
   const now=Date.parse('2026-10-17T22:30:00Z');
   expect(dailyDisplayDate('2026-10-18',now).line1).toBe('Auj.');
   expect(dailyDisplayDate('2026-10-17',now).line1).not.toBe('Auj.');
 });
 it('respecte aussi le lendemain de la fin de l’heure d’été',()=>{
   expect(dailyDisplayDate('2026-10-26',Date.parse('2026-10-25T23:30:00Z')).line1).toBe('Auj.');
   expect(dailyDetailDate('2026-10-25')).toBe('Dimanche 25 octobre 2026');
 });
 it('retrouve la date après une réorganisation, sans choisir un jour voisin absent',()=>{
   expect(selectedDailyIndex([{date:'2026-10-19'},{date:'2026-10-18'}],'2026-10-18')).toBe(1);
   expect(selectedDailyIndex([{date:'2026-10-19'}],'2026-10-18')).toBeNull();
   expect(selectedDailyIndex([],null)).toBeNull();
 });
 it('refuse les dates civiles impossibles au lieu de les déplacer au mois suivant',()=>{
   for(const date of ['2026-02-30','pas de date','2026-1-1'])expect(dailyDetailDate(date)).toBe('Date indisponible');
 });
 it('prend le jour exact à Paris dans un cache commençant la veille, sans modifier ses valeurs',()=>{
   const days=[{date:'2026-10-17',tempMax:15,tempMin:4},{date:'2026-10-18',tempMax:0,tempMin:-2}];
   expect(dailyForecastForToday(days,Date.parse('2026-10-17T22:30:00Z'))).toBe(days[1]);
   expect(dailyForecastForToday(days,Date.parse('2026-10-18T21:59:00Z'))).toEqual({date:'2026-10-18',tempMax:0,tempMin:-2});
 });
 it('ne substitue pas les maxima d’hier ou de demain à une journée manquante',()=>{
   const now=Date.parse('2026-10-25T23:30:00Z');
   expect(dailyForecastForToday([{date:'2026-10-25'},{date:'2026-10-27'}],now)).toBeNull();
   expect(dailyForecastForToday([{date:'2026-10-27'},{date:'2026-10-26'}],now)?.date).toBe('2026-10-26');
 });
});

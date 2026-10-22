import {expect,it} from 'vitest';
import {selectForecastDetails,forecastDetailsNotice} from './forecastDetailsState';
import {requestForecastReload,takeForecastReload} from './forecastRefreshRequest';
const fresh={hours:[{temp:12}],days:[],dailyStatus:'not_requested',officialSnapshot:{snapshotStatus:'live',hourlyStatus:'ready',computedAt:'2026-10-20T11:20:00Z'}};
const old={hours:[{temp:8}],days:[{date:'2026-10-20',tempMax:15}],dailyStatus:'ready',officialSnapshot:{snapshotStatus:'stale',hourlyStatus:'ready',computedAt:'2026-10-20T10:00:00Z'},controlCache:{stale:true,cachedAt:'2026-10-20T10:00:00Z'}};
it('ne laisse pas un ancien enrichissement masquer les heures fraîchement reçues',()=>{
 const result=selectForecastDetails<any>(fresh,old);
 expect(result.hours).toEqual(fresh.hours);expect(result.days).toEqual(old.days);expect(result.officialSnapshot.snapshotStatus).toBe('live');expect(result.dailyCacheStale).toBe(true);expect(old.hours[0].temp).toBe(8);
 const notice=forecastDetailsNotice(result,{busy:false,failed:false,offline:false});expect(notice?.message).toContain('Prévisions quotidiennes enregistrées');expect(notice?.message).not.toContain('en cours');
});
it('retire le bandeau lorsque les prévisions courantes et quotidiennes sont fraîches',()=>{
 const detailed={...fresh,days:old.days,dailyStatus:'ready'};
 expect(forecastDetailsNotice(selectForecastDetails(fresh,detailed),{busy:false,failed:false,offline:false})).toBeNull();
});
it('distingue le travail en cours, un échec, une simple archive et le hors ligne',()=>{
 const busy=forecastDetailsNotice(old,{busy:true,failed:false,offline:false});expect(busy?.busy).toBe(true);expect(busy?.message).toContain('en cours');
 const failed=forecastDetailsNotice(old,{busy:false,failed:true,offline:false});expect(failed?.busy).toBe(false);expect(failed?.message).toContain('n’a pas abouti');expect(failed?.button).toBe('Actualiser les prévisions');
 const offline=forecastDetailsNotice(old,{busy:false,failed:false,offline:true});expect(offline?.message).toContain('Connexion indisponible');expect(offline?.message).toContain('20/10');
 expect(forecastDetailsNotice(old,{busy:false,failed:false,offline:false})?.message).not.toContain('en cours');
});
it('un clic manuel autorise un seul nouvel essai pour chaque variante et seulement pour ce lieu',()=>{
 requestForecastReload(50.7567,2.5204);
 expect(takeForecastReload(48,2,false)).toBe(false);
 expect(takeForecastReload(50.7567,2.5204,false)).toBe(true);expect(takeForecastReload(50.7567,2.5204,false)).toBe(false);
 expect(takeForecastReload(50.7567,2.5204,true)).toBe(true);expect(takeForecastReload(50.7567,2.5204,true)).toBe(false);
});

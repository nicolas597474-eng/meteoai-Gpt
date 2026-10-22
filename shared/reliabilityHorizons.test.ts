import {expect,it} from 'vitest';
import {RELIABILITY_HORIZONS} from './reliabilityHorizons';
it('les libellés des filtres partagés correspondent à des bornes contiguës',()=>{
 expect(RELIABILITY_HORIZONS[0].min).toBe(0);
 expect(RELIABILITY_HORIZONS.at(-1)?.max).toBe(360);
 RELIABILITY_HORIZONS.slice(1).forEach((h,i)=>expect(h.min).toBe(RELIABILITY_HORIZONS[i].max));
 expect(RELIABILITY_HORIZONS.find(h=>h.id==='4-7d')).toMatchObject({min:72,max:168,label:'3–7 jours'});
 expect(RELIABILITY_HORIZONS.find(h=>h.id==='8-10d')).toMatchObject({min:168,max:240,label:'7–10 jours'});
 expect(RELIABILITY_HORIZONS.find(h=>h.id==='11-15d')).toMatchObject({min:240,max:360,label:'10–15 jours'});
});

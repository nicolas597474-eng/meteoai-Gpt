import {expect,it} from 'vitest';
import {refreshAILabInOrder} from './aiLabRefresh';
it('attend les stations puis les nouvelles preuves avant de relire les calculs affichés',async()=>{
 let release! :()=>void;const calls:string[]=[];
 const hold=new Promise<void>(resolve=>{release=resolve;});
 const pending=refreshAILabInOrder({stations:async()=>{calls.push('stations');await hold;calls.push('reçues');},references:async()=>{calls.push('qualifiées');},readers:[async()=>{calls.push('calcul');},async()=>{calls.push('bilan');}]});
 await Promise.resolve();expect(calls).toEqual(['stations']);release();await pending;
 expect(calls).toEqual(['stations','reçues','qualifiées','calcul','bilan']);
});
it('une panne de collecte ne masque pas les autres bilans ni les archives conservées',async()=>{
 const calls:string[]=[];
 const result=await refreshAILabInOrder({stations:async()=>{throw Error('Netatmo indisponible');},references:async()=>{calls.push('archives');throw Error('Reprise échouée');},readers:[async()=>{calls.push('preuves');},async()=>{throw Error('Prévisions indisponibles');},async()=>{calls.push('journal');}]});
 expect(calls).toEqual(['archives','preuves','journal']);expect(result.map(r=>r.status)).toEqual(['fulfilled','rejected','fulfilled']);
});

import {expect,it} from 'vitest';
import {assistantSuggestions} from './suggestions';
import {planQuestion} from './router';
import {wantsGemini} from './gemini';
const now=Date.parse('2026-10-21T10:00:00Z'),place={name:'Hondeghem',lat:50.7567,lon:2.5204};
it('toutes les suggestions correspondent au moteur annoncé et sont comprises par le routeur',()=>{for(const state of [null,{status:'ready',remaining:17}])for(const suggestion of assistantSuggestions(state,now)){const plan=planQuestion(suggestion.question,null,place,now);expect(plan.clarification).toBeUndefined();expect(plan.locationQuery).toBeUndefined();expect(plan.context.intent).not.toBe('unknown');expect(wantsGemini(plan)).toBe(suggestion.engine==='gemini');}});
it('les suggestions Gemini disparaissent pendant une pause, sans clé ou sans quota',()=>{for(const state of [null,{status:'not_configured'},{status:'paused',remaining:17,retryAt:now+60000},{status:'exhausted',remaining:0},{status:'ready',remaining:0},{status:'ready',remaining:17,retryAt:now+60000}]){const suggestions=assistantSuggestions(state,now);expect(suggestions).toHaveLength(8);expect(suggestions.every(s=>s.engine==='local')).toBe(true);}});
it('le retour à un statut disponible propose des analyses avancées sans lancer de requête',()=>{const suggestions=assistantSuggestions({status:'ready',remaining:17,retryAt:now-1},now);expect(suggestions.filter(s=>s.engine==='gemini')).toHaveLength(2);expect(new Set(suggestions.map(s=>s.question)).size).toBe(suggestions.length);});

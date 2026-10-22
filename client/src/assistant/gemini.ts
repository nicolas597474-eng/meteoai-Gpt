import {normalize,type GeminiState,type Plan,type Reply} from './contracts';
const endpoint='/api/assistant/gemini';
const states=new Set(['ready','paused','exhausted','busy','not_configured','authentication_required','unavailable','invalid_response','invalid_request','invalid_origin','method_not_allowed']);
function checked(value:any):GeminiState{
 if(!value||!states.has(value.status)||value.model&&value.model!=='gemini-3.6-flash')return {status:'unavailable'};
 const result:GeminiState={status:value.status,model:'gemini-3.6-flash'};
 if(Number.isInteger(value.remaining)&&value.remaining>=0&&value.remaining<=20)result.remaining=value.remaining;
 if(value.limit===20)result.limit=20;
 for(const k of ['resetAt','retryAt'] as const)if(typeof value[k]==='number'&&Number.isFinite(value[k])&&value[k]>0)result[k]=value[k];
 if(typeof value.reason==='string')result.reason=value.reason.slice(0,80);
 if(typeof value.text==='string'&&value.text.length<=2000&&value.text.trim())result.text=value.text;
 result.cached=value.cached===true;
 return result;
}
export async function readGeminiState(transport:typeof fetch=fetch):Promise<GeminiState>{try{return checked(await (await transport(endpoint,{credentials:'same-origin',cache:'no-store',signal:AbortSignal.timeout(6000)})).json());}catch{return {status:'unavailable'};}}
export function wantsGemini(plan:Plan){if(plan.clarification)return false;const q=normalize(plan.question);return plan.context.intent==='activity'||/pourquoi|explique.*(?:simple|detail|davantage)|conseill|qu en penses|ton avis|quel.*(?:risque|meilleur|mieux)/.test(q);}
export async function enhanceWithGemini(plan:Plan,reply:Reply,state:GeminiState|null=null,transport:typeof fetch=fetch,now=Date.now()):Promise<Reply>{
 if(!wantsGemini(plan)||reply.choices?.length||!reply.sources.length)return reply;
 if(state?.status==='not_configured'||state?.retryAt&&state.retryAt>now)return {...reply,ai:state};
 // Seulement la question en cours et les faits nécessaires. Ni historique, ni identité, ni coordonnées précises.
 const facts=reply.text+'\nSources : '+reply.sources.map(s=>`${s.kind} · ${s.label}${s.updatedAt?' · actualisation '+s.updatedAt:''}${s.validAt?' · échéance '+s.validAt:''}`).join('\n');
 if(facts.length>7000)return {...reply,ai:{status:'unavailable'}};
 try{const response=await transport(endpoint,{method:'POST',credentials:'same-origin',cache:'no-store',headers:{'Content-Type':'application/json'},body:JSON.stringify({question:plan.question,facts}),signal:AbortSignal.timeout(15000)});const ai=checked(await response.json());return {...reply,ai};}catch{return {...reply,ai:{status:'unavailable'}};}
}
const at=(value:number)=>new Date(value).toLocaleString('fr-FR',{timeZone:'Europe/Paris',weekday:'long',day:'numeric',month:'long',year:'numeric',hour:'2-digit',minute:'2-digit'})+' (heure de Paris)';
const resumeAt=(s:GeminiState)=>[s.retryAt,s.resetAt].find((value):value is number=>typeof value==='number'&&Number.isFinite(value)&&value>0);
export function geminiLabel(s:GeminiState|null){
 if(!s)return 'Vérification de la disponibilité de Gemini…';
 if(s.status==='not_configured')return 'Gemini 3.6 Flash : connexion à terminer. Les réponses locales restent actives.';
 if(s.status==='exhausted'||s.status==='paused'&&s.reason==='provider_daily_quota'){const resume=resumeAt(s);return `Quota Gemini atteint. ${resume?'Reprise prévue le '+at(resume)+', sous réserve du quota disponible lors de la vérification.':'Date de remise à zéro indisponible pour le moment.'} Réponses locales actives.`;}
 if(s.status==='paused'&&['minute_quota','provider_minute_quota'].includes(s.reason??'')){const resume=resumeAt(s);return `Limite de fréquence Gemini atteinte. ${resume?'Nouvel essai possible le '+at(resume)+'.':'Délai de reprise indisponible pour le moment.'} Réponses locales actives.`;}
 if(s.status==='paused')return (s.reason==='provider_configuration'?'Gemini indisponible : configuration ou accès à vérifier. ':'Gemini temporairement suspendu. ')+(s.retryAt?'Nouvelle vérification '+at(s.retryAt)+'. ':'')+'Réponses locales actives.';
 if(s.status==='busy')return 'Une analyse Gemini est déjà en cours. Réponses locales actives.';
 if(s.status==='ready')return `Gemini 3.6 Flash · ${s.remaining??'—'}/20 appel(s) restant(s) dans le compteur MeteoAI · quota du projet partagé.`;
 if(s.status==='invalid_response')return 'Explication Gemini écartée : elle ne satisfait pas les contrôles. Résultat local conservé.';
 return 'Analyse Gemini momentanément indisponible. Réponses locales actives.';
}

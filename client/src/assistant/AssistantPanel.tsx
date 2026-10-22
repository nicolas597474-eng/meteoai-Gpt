import React,{useEffect,useMemo,useRef,useState,type FormEvent} from 'react';
import {Link} from 'wouter';
import {LoaderCircle,Mic,PencilLine,Send,Square,Trash2} from 'lucide-react';
import {useLocation} from '../contexts/LocationContext';
import {trpc} from '../lib/trpc';
import {useQueryClient} from '@tanstack/react-query';
import {collectLiveModelComparison} from '../lib/liveModelQuery';
import {liveComparisonQueryKey} from '../lib/weatherQueryCache';
import {createAssistantRead,createDataPort} from './data';
import {useVoiceQuestion} from './useVoiceQuestion';
import {planQuestion} from './router';
import {answerPlan} from './answers';
import {assistantSuggestions} from './suggestions';
import {readGeminiState,enhanceWithGemini,geminiLabel} from './gemini';
import {clearConversation,emptyConversation,loadConversation,saveConversation,safeLink,MAX_MESSAGES,MEMORY_TTL} from './memory';
import {dateLabel,dateValid,type Conversation,type Place,type Plan,type Reply,type GeminiState} from './contracts';

const kinds={observation:'Observation',forecast:'Prévision',calculation:'Calcul',documentation:'Documentation'};
function storage(){try{return window.localStorage;}catch{return undefined;}}
function timestamp(value:string){if(dateValid(value))return dateLabel(value);const at=Date.parse(value);return Number.isFinite(at)?new Date(at).toLocaleString('fr-FR',{timeZone:'Europe/Paris',day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'})+' (Paris)':'horodatage indisponible';}
export function ReplyDetails({reply}:{reply:Reply}){
 return <>{reply.ai&&<div className="mt-3 rounded-xl border border-violet-300/20 bg-violet-400/5 p-3">{reply.ai.text?<><p className="text-[10px] font-semibold text-violet-200">Interprétation IA · Gemini 3.6 Flash{reply.ai.cached?' · réutilisée depuis le cache':''}</p><p className="mt-1 whitespace-pre-wrap break-words text-sm leading-relaxed text-slate-100">{reply.ai.text}</p></>:<p className="text-[10px] leading-relaxed text-slate-300">{geminiLabel(reply.ai)}</p>}</div>}{reply.sources.length>0&&<ul className="mt-3 space-y-1 border-t border-sky-200/10 pt-2 text-[10px] leading-relaxed text-slate-300" aria-label="Sources de la réponse">{reply.sources.map((s,i)=><li key={i}><span className="font-semibold text-sky-200">{kinds[s.kind]} · </span>{s.label}{s.updatedAt&&<> · source du {timestamp(s.updatedAt)}</>}{s.validAt&&<> · échéance {timestamp(s.validAt)}</>}</li>)}</ul>}{reply.links?.length?<div className="mt-2 flex flex-wrap gap-2">{reply.links.map(link=><Link key={link.href} href={safeLink(link.href)} className="inline-flex min-h-10 items-center rounded-xl border border-sky-300/25 bg-sky-300/5 px-3 text-xs text-sky-200 underline underline-offset-4">{link.label}</Link>)}</div>:null}</>;
}
export function ReplyContent({text,reply}:{text:string;reply?:Reply}){
 const facts=<p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-slate-100">{text}</p>;
 if(!reply?.ai?.text)return <>{facts}{reply&&<ReplyDetails reply={reply} />}</>;
 return <><ReplyDetails reply={reply} /><details className="mt-3 border-t border-sky-200/10 pt-2"><summary className="cursor-pointer py-2 text-xs text-sky-200">Données MeteoAI utilisées</summary><div className="pt-2">{facts}</div></details></>;
}
export default function AssistantPanel({period,horizon}:{period:string;horizon:string}){
 const {activeLocation}=useLocation(),utils=trpc.useUtils(),queryClient=useQueryClient();
 const [conversation,setConversation]=useState<Conversation>(()=>loadConversation(storage()));
 const [input,setInput]=useState(''),[busy,setBusy]=useState(false),[ephemeral,setEphemeral]=useState(false),[pending,setPending]=useState<Plan|null>(null);
 const voice=useVoiceQuestion(setInput);
 const [gemini,setGemini]=useState<GeminiState|null>(null);
 useEffect(()=>{let alive=true;void readGeminiState().then(s=>{if(alive)setGemini(s);});return()=>{alive=false;};},[]);
 useEffect(()=>{if(!gemini?.retryAt)return;let alive=true;const timer=window.setTimeout(()=>{void readGeminiState().then(s=>{if(alive)setGemini(s);});},Math.max(1000,gemini.retryAt-Date.now()+1000));return()=>{alive=false;clearTimeout(timer);};},[gemini?.retryAt]);
 const generation=useRef(0),inFlight=useRef(false),log=useRef<HTMLDivElement>(null),questionInput=useRef<HTMLTextAreaElement>(null),followLatest=useRef(true);
 const active:Place=activeLocation??{name:'Hondeghem',lat:50.7567,lon:2.5204};
 const port=useMemo(()=>createDataPort(createAssistantRead(utils,{fetch:(input:{lat:number;lon:number},options)=>queryClient.fetchQuery({queryKey:liveComparisonQueryKey(input.lat,input.lon),queryFn:()=>collectLiveModelComparison(input.lat,input.lon),staleTime:options.staleTime})}),{period,horizon}),[utils,queryClient,period,horizon]);
 useEffect(()=>{if(conversation.messages.length)setEphemeral(!saveConversation(storage(),conversation));},[conversation]);
 useEffect(()=>{const timer=window.setTimeout(()=>{generation.current++;inFlight.current=false;setBusy(false);setPending(null);clearConversation(storage());setConversation(emptyConversation());},Math.max(0,MEMORY_TTL-(Date.now()-conversation.at)));return()=>clearTimeout(timer);},[conversation.at]);
 useEffect(()=>()=>{generation.current++;inFlight.current=false;},[]);
 useEffect(()=>{if(log.current&&followLatest.current)log.current.scrollTop=log.current.scrollHeight;},[conversation.messages.length,busy]);
 function reset(){voice.cancel();generation.current++;inFlight.current=false;setBusy(false);setPending(null);setInput('');clearConversation(storage());setConversation(emptyConversation());window.requestAnimationFrame(()=>showQuestion(false));}
 function showQuestion(focus=true){const field=questionInput.current;if(!field)return;field.scrollIntoView({block:'center',behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth'});if(focus)field.focus({preventScroll:true});}
 function dictateFromConversation(){if(voice.listening){voice.stop();return;}showQuestion(false);voice.start();}
 useEffect(()=>{const frame=window.requestAnimationFrame(()=>showQuestion(false));return()=>window.cancelAnimationFrame(frame);},[]);
 async function send(question:string,chosen?:Place){
  if(inFlight.current||voice.listening||!question.trim()||question.length>600)return;
  inFlight.current=true;followLatest.current=true;setBusy(true);setInput('');
  const now=Date.now(),base=now-conversation.at>=MEMORY_TTL?emptyConversation(now):conversation,plan=chosen&&pending?{...pending,locationQuery:undefined,context:{...pending.context,place:chosen}}:planQuestion(question,base.context,active,now);
  const current=++generation.current;
  setConversation({...base,at:now,messages:[...base.messages,{role:'user' as const,text:chosen?'Lieu choisi : '+chosen.name:question,at:now}].slice(-MAX_MESSAGES)});
  let timeout:ReturnType<typeof setTimeout>|undefined;
  try{
   const localReply=await Promise.race([answerPlan(plan,port,now),new Promise<Reply>((_,reject)=>{timeout=setTimeout(()=>reject(Error('timeout')),25000);})]);
   clearTimeout(timeout);
   if(generation.current!==current)return;
   // Le délai éventuel de Gemini ne doit pas effacer une lecture locale réussie.
   const reply=await enhanceWithGemini(plan,localReply,gemini);
   if(generation.current!==current)return;
   if(reply.ai)setGemini(reply.ai);
   setPending(reply.choices?.length?plan:null);
   setConversation(v=>({...v,at:Date.now(),context:reply.context??v.context,messages:[...v.messages,{role:'assistant' as const,text:reply.text,reply,at:Date.now()}].slice(-MAX_MESSAGES)}));
  }catch{
   if(generation.current!==current)return;
   const reply:Reply={text:'La lecture des données n’a pas abouti. Vérifiez la connexion puis réessayez. Aucune ancienne valeur n’est présentée comme une nouvelle mesure. Les explications de fonctionnement restent disponibles sans réseau.',sources:[],links:[{label:'Prévisions',href:'/details'}]};
   setConversation(v=>({...v,at:Date.now(),context:plan.context,messages:[...v.messages,{role:'assistant' as const,text:reply.text,reply,at:Date.now()}].slice(-MAX_MESSAGES)}));
  }finally{clearTimeout(timeout);if(generation.current===current){inFlight.current=false;setBusy(false);}}
 }
 function submit(event:FormEvent){event.preventDefault();void send(input.trim());}
 const last=conversation.messages.at(-1);
 const hasConversation=conversation.messages.length>0;
 const suggestions=assistantSuggestions(gemini);
 return <div className="space-y-3" data-swipe-ignore>
  <div className="overflow-hidden rounded-2xl border border-sky-200/20 bg-slate-950/35" aria-label="Votre question et la conversation">
   {hasConversation&&<>
   <div ref={log} role="log" aria-label="Conversation avec MeteoAI Assistant" aria-live="polite" aria-relevant="additions" tabIndex={0} onScroll={e=>{const node=e.currentTarget;followLatest.current=node.scrollHeight-node.clientHeight-node.scrollTop<40;}} className="max-h-[28rem] touch-auto space-y-3 overflow-y-auto overscroll-y-auto p-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300 sm:p-4">
   {conversation.messages.map((m,i)=><article key={m.at+'-'+i} className={'w-fit min-w-0 max-w-[92%] rounded-2xl border p-3 '+(m.role==='user'?'meteoai-assistant-question ml-auto':'mr-auto border-slate-500/20 bg-slate-950/45')}><p className="mb-1.5 text-[10px] font-semibold text-sky-200">{m.role==='user'?'Vous':'MeteoAI Assistant'} · {new Date(m.at).toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit',timeZone:'Europe/Paris'})}{m.role==='assistant'&&!m.reply?' · historique local':''}</p><ReplyContent text={m.text} reply={m.reply} /></article>)}
   {busy&&<p role="status" className="flex items-center gap-2 p-2 text-xs text-sky-200"><LoaderCircle className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />Lecture des données utiles…</p>}
   </div>
   {pending&&last?.reply?.choices?.length?<div className="flex flex-wrap gap-2 border-t border-sky-200/15 p-3 sm:p-4" aria-label="Choisir la commune">{last.reply.choices.map(p=><button key={p.lat+','+p.lon} type="button" disabled={busy||voice.listening} onClick={()=>void send(pending.question,p)} className="min-h-11 rounded-xl border border-sky-300/30 bg-slate-950/50 px-3 text-xs text-sky-200">{p.name}</button>)}</div>:null}
   </>}
   <div className={'p-2 sm:p-3'+(hasConversation?' border-t border-sky-200/10':'')} data-assistant-composer>
    <form onSubmit={submit} className="flex items-center gap-1.5">
     <button type="button" onClick={dictateFromConversation} disabled={busy||!voice.available} aria-label={voice.listening?'Arrêter la dictée':'Dicter une question'} title={voice.listening?'Arrêter la dictée':'Dicter une question'} aria-pressed={voice.listening} aria-describedby="assistant-voice-info" className="grid min-h-11 min-w-11 shrink-0 place-items-center meteoai-assistant-action rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300 disabled:opacity-40">{voice.listening?<Square className="h-5 w-5" aria-hidden="true" />:<Mic className="h-5 w-5" aria-hidden="true" />}</button>
     <div className="meteoai-assistant-input min-w-0 flex-1 rounded-3xl border bg-slate-950/60 px-3 py-2.5 focus-within:ring-2 focus-within:ring-violet-300/50"><label htmlFor="assistant-question" className="sr-only">Votre question</label><textarea ref={questionInput} id="assistant-question" value={input} readOnly={voice.listening} onChange={e=>setInput(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.nativeEvent.isComposing){e.preventDefault();void send(input.trim());}}} maxLength={600} rows={1} placeholder="Posez votre question…" className="block max-h-32 min-h-6 w-full text-center leading-6 resize-none overflow-y-auto border-0 bg-transparent p-0 text-sm text-white placeholder:text-slate-400 focus:outline-none [field-sizing:content]" /></div>
     <button type="submit" disabled={busy||voice.listening||!input.trim()} aria-label="Envoyer la question" className="grid min-h-11 min-w-11 shrink-0 place-items-center meteoai-assistant-action rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300 disabled:opacity-40"><Send className="h-5 w-5" aria-hidden="true" /></button>
    </form>
    <div className="mt-1 flex items-center justify-between gap-2">
     <p className="min-w-0 text-[10px] text-slate-400">Lieu de conversation : <span className="text-sky-100">{conversation.context?.place.name??active.name}</span></p>
     {hasConversation&&<div role="group" aria-label="Actions de la conversation" className="flex shrink-0 items-center">
      <button type="button" onClick={()=>showQuestion()} disabled={busy||voice.listening} aria-label="Poser une nouvelle question" title="Poser une nouvelle question" className="grid min-h-11 min-w-11 place-items-center meteoai-assistant-action rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300 disabled:opacity-40"><PencilLine className="h-4 w-4" aria-hidden="true" /></button>
      <button type="button" onClick={reset} aria-label="Supprimer la conversation" title="Nouvelle conversation" className="grid min-h-11 min-w-11 place-items-center meteoai-assistant-action rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300"><Trash2 className="h-4 w-4" aria-hidden="true" /></button>
     </div>}
    </div>
    {voice.message&&<p role="status" className="mt-2 text-xs leading-relaxed text-sky-200">{voice.message}{voice.interim&&<span className="mt-1 block text-slate-300">{voice.interim}</span>}</p>}
   </div>
  </div>
  <div aria-label="Suggestions de questions" className="space-y-2">
   <p className="text-[11px] font-medium text-slate-300">Questions suggérées</p>
   <div className="flex flex-wrap gap-2">{suggestions.map(({question,engine})=><button key={question} type="button" onClick={()=>void send(question)} disabled={busy||voice.listening} className="min-h-11 rounded-xl border border-sky-300/20 bg-slate-950/40 px-3 py-2 text-left text-xs font-medium text-white transition-colors hover:border-sky-300/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300 disabled:opacity-50"><span className={'mb-0.5 block text-[10px] font-medium '+(engine==='gemini'?'text-violet-200':'text-slate-400')}>{engine==='gemini'?'Avec Gemini':'Réponse locale'}</span>{question}</button>)}</div>
  </div>
  <footer className="space-y-2 border-t border-sky-200/10 pt-3">
  <p id="assistant-voice-info" className="text-[10px] leading-relaxed text-slate-400">{voice.available?'Dictée fournie par votre navigateur : l’audio peut être traité par son service de reconnaissance. Relisez le texte avant de l’envoyer.':'Dictée indisponible dans ce navigateur. Vous pouvez utiliser le micro de votre clavier ou saisir votre question.'}</p>
  <p className="text-[10px] leading-relaxed text-slate-400">Les explications avancées transmettent à Google la question en cours et les seuls faits utiles ; l’historique complet reste sur cet appareil. Les conseils d’activité ne confirment pas la sécurité d’une sortie. Dates et heures : Europe/Paris.</p>
  <p role="status" className="text-[10px] leading-relaxed text-sky-200">{geminiLabel(gemini)}</p>
  <p className="text-[10px] leading-relaxed text-slate-400">La fermeture du bloc assistant ou « Nouvelle conversation » supprime la conversation sur cet appareil. Si le bloc reste ouvert, l’historique expire après 24 heures sans activité. Les anciens messages gardent leur date ; chaque nouvelle question relit les données utiles.</p>
   {ephemeral&&<p role="status" className="text-xs text-amber-100">Stockage local indisponible : cette conversation reste uniquement en mémoire.</p>}
  </footer>
 </div>;
}

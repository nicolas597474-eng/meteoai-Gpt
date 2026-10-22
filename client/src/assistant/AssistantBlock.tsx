import React,{lazy,Suspense,useState} from 'react';
import {ChevronDown,MessageCircle,X} from 'lucide-react';
import {clearConversation} from './memory';
const AssistantPanel=lazy(()=>import('./AssistantPanel'));
export default function AssistantBlock({period,horizon}:{period:string;horizon:string}){
 const [open,setOpen]=useState(false);
 function toggle(){if(open){try{clearConversation(window.localStorage);}catch{}}setOpen(!open);}
 return <section className="weather-surface-hero meteoai-assistant-frame overflow-hidden rounded-[1.7rem] border p-4 sm:p-5" aria-labelledby="meteoai-assistant-title" data-swipe-ignore>
  <div className="flex items-start gap-3"><span className="grid h-10 w-10 shrink-0 place-items-center"><MessageCircle className="meteoai-assistant-action h-5 w-5" aria-hidden="true" /></span><div className="min-w-0 flex-1"><h2 id="meteoai-assistant-title" className="text-lg font-semibold text-white">MeteoAI Assistant</h2><p className="mt-1 text-xs leading-relaxed text-slate-300">Votre météo, les modèles et la fiabilité expliqués à partir des données disponibles.</p><p className="mt-1.5 text-[10px] text-sky-200">Réponses locales · Gemini selon disponibilité et quota</p></div><button type="button" onClick={toggle} aria-expanded={open} aria-controls="meteoai-assistant-panel" aria-label={open?'Fermer MeteoAI Assistant':'Ouvrir MeteoAI Assistant'} className="grid min-h-11 min-w-11 place-items-center rounded-full border-0 bg-transparent meteoai-assistant-action focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300">{open?<X className="h-5 w-5" aria-hidden="true" />:<ChevronDown className="h-5 w-5" aria-hidden="true" />}</button></div>
  {open&&<div id="meteoai-assistant-panel" className="mt-4"><Suspense fallback={<p role="status" className="p-3 text-sm text-slate-300">Ouverture de la conversation…</p>}><AssistantPanel period={period} horizon={horizon} /></Suspense></div>}
 </section>;
}

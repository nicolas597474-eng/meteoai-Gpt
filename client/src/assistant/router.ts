import {normalize,dateAt,dateValid,shiftDate,type Activity,type Context,type Intent,type Place,type Plan,type Variable} from './contracts';

const variables:Array<[Variable,RegExp]>=[['probability',/probabilite|chance.*pluie/],['apparentTemperature',/ressenti/],['dewPoint',/rosee/],['windGust',/rafale/],['windSpeed',/\bvent\b/],['humidity',/humidite/],['pressure',/pression/],['cloudCover',/nuage|nebulosite/],['visibility',/visibilite/],['uvIndex',/\buv\b/],['precipitation',/pluie|pleuv|precipitation|millimetre|\bmm\b/],['temperature',/temperature|degre|chaud|froid/]];
const activities:Array<[Activity,RegExp]>=[['kayak',/kayak|canoe/],['randonnée',/randonne/],['vélo',/velo|cyclis/],['jardinage',/jardin/],['tonte',/tond|tonte/],['promenade',/promen|balad/],['plage',/plage|baign/]];
const weekdays=['dimanche','lundi','mardi','mercredi','jeudi','vendredi','samedi'];
export function planQuestion(question:string,previous:Context|null,active:Place,now=Date.now()):Plan{
 const q=normalize(question),today=dateAt(now),follow=/^(et\b|pour\b|a\b|demain\b|apres demain\b|samedi\b|dimanche\b|pourquoi\b|combien\b)/.test(q);
 const context:Context={place:previous?.place??active,date:today,period:'now',variable:'temperature',intent:'weather',models:[],topic:'',page:'/laboratoire',...(follow&&previous?previous:{})};
 const plan:Plan={question,context,explicitDate:false,explicitPlace:false};
 if(!q||question.length>600){plan.clarification='Posez une question de 1 à 600 caractères.';return plan;}
 const protection=/\b(?:k[ -]?way|impermeable|cape de pluie|veste de pluie|coupe[ -]?pluie|parapluie)\b/.test(q)?(/parapluie/.test(q)?'umbrella':'raincoat'):follow&&previous?.intent==='rainProtection'&&!variables.some(([,pattern])=>pattern.test(q))?previous.protection:undefined;
 const dateMatch=q.match(/\b(\d{4}-\d{2}-\d{2})\b/),shortDate=q.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{4}))?\b/);
 let date:string|undefined;
 if(dateMatch)date=dateMatch[1];
 else if(shortDate)date=`${shortDate[3]??today.slice(0,4)}-${shortDate[2].padStart(2,'0')}-${shortDate[1].padStart(2,'0')}`;
 else if(/apres demain/.test(q))date=shiftDate(today,2);
 else if(/\bdemain\b/.test(q))date=shiftDate(today,1);
 else if(/aujourd hui|ce matin|ce soir|cet apres midi/.test(q))date=today;
 else if(/\bhier\b/.test(q))date=shiftDate(today,-1);
 else{const days=weekdays.filter(d=>q.includes(d));if(days.length>1)plan.clarification='Quelle journée souhaitez-vous examiner en premier ?';if(days.length===1){const day=new Date(today+'T12:00:00Z').getUTCDay(),delta=(weekdays.indexOf(days[0])-day+7)%7;date=shiftDate(today,delta||(/prochain/.test(q)?7:0));}}
 if(date){plan.explicitDate=true;if(!dateValid(date))plan.clarification='Cette date est invalide. Indiquez une date au format jour/mois/année.';else{context.date=date;context.period='day';}}
 else if(/maintenant|actuel|en ce moment|fait il/.test(q)){context.date=today;context.period='now';plan.explicitDate=true;}
 if(/week end|semaine prochaine/.test(q)||!protection&&/ce soir|cet apres midi|ce matin|\b\d{1,2}\s*h\b|\ba \d{1,2}:\d{2}/.test(q))plan.clarification='Précisez une journée ou « maintenant ». Je ne peux pas remplacer votre période par une autre.';
 if(protection){
  context.protection=protection;context.variable='precipitation';
  if(!/maintenant|en ce moment/.test(q))context.period='day';
  const times=[...q.matchAll(/\b(\d{1,2})(?:\s*h(?:eures?)?(?:\s*(\d{2}))?|:(\d{2}))\b/g)];
  const parts=(['morning','afternoon','evening'] as const).filter(part=>({morning:/\bmatin(?:ee)?\b/,afternoon:/apres[ -]midi/,evening:/\bsoir(?:ee)?\b/})[part].test(q));
  if(times.length>1||parts.length>1)plan.clarification='Quelle heure ou quelle partie de la journée souhaitez-vous vérifier en premier ?';
  if(/\bnuit\b|\bdans\s+\d.*(?:h|heure)|entre|a partir de|jusqu/.test(q)||times.length===0&&/\bheures?\b/.test(q))plan.clarification='Précisez une heure au format 11:00, ou une partie de la journée : matin, après-midi ou soir.';
  if(times.length===1){const h=Number(times[0][1]),m=Number(times[0][2]??times[0][3]??0);if(h>23||m>59)plan.clarification='Cette heure est invalide. Indiquez une heure entre 00:00 et 23:59.';else{context.time=String(h).padStart(2,'0')+':'+String(m).padStart(2,'0');delete context.daypart;}}
  else if(parts.length===1){context.daypart=parts[0];delete context.time;}
  if(parts.length===1&&context.time){const hour=Number(context.time.slice(0,2)),part=parts[0],valid=part==='morning'?hour>=6&&hour<12:part==='afternoon'?hour>=12&&hour<18:hour>=18;if(!valid)plan.clarification='L’heure et la partie de la journée ne correspondent pas. Quelle heure souhaitez-vous vérifier ?';}
 }
 const placeMatch=question.match(/(?:^|\s)(?:à|a|pour|sur)\s+([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ'’\- ]{1,90})/i);
 if(placeMatch){let query=placeMatch[1].replace(/[?.!,;].*$/,'').trim();query=query.replace(/\s+(?:demain|aujourd’hui|aujourd'hui|après-demain|apres demain|lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche|le \d|en \d|avec\b|pour\b|et\b).*$/i,'').trim();
  if(query&&!/^(?:la |le |les |mon |ma |mes |une? |du |des |quoi|faire|ce |cet |cette |demain|aujourd|samedi|dimanche|lundi|mardi|mercredi|jeudi|vendredi|velo|kayak|tonte|jardinage)/i.test(normalize(query))){plan.locationQuery=query;plan.explicitPlace=true;}
 }
 const variable=variables.find(([,pattern])=>pattern.test(q));if(variable)context.variable=variable[0];
 const activity=activities.find(([,pattern])=>pattern.test(q));if(activity)context.activity=activity[0];
 const namedModels=['AROME','ARPEGE','ICON','ECMWF','GFS','GEM','UKMET'].filter(m=>new RegExp('\\b'+m.toLowerCase()+'\\b').test(q));
 let intent:Intent;
 if(protection)intent='rainProtection';
 else if(/comment|a quoi|que signifie|c est quoi|explique|pourquoi|fonctionne|acceder|ajouter/.test(q)&&/ai lab|ultra.local|fusion|ponder|poids|score|fiabilite|graphique|favori|prevision|modele|station|mae|rmse|biais/.test(q))intent='guide';
 else if(activity||follow&&previous?.intent==='activity'&&!variable)intent='activity';
 else if(/station|capteur/.test(q))intent='stations';
 else if(/poids|ponderation|fusion/.test(q))intent='weights';
 else if(/score|fiabilite|comparaisons? archive|historique/.test(q))intent='reliability';
 else if(namedModels.length||/compar.*modele|modele.*compar/.test(q))intent='models';
 else if(variable||/meteo|quel temps|temps fait|temps fera|bonjour|salut/.test(q)||follow&&previous)intent=follow&&previous&&!variable?previous.intent:'weather';
 else intent='unknown';
 context.intent=intent;context.models=namedModels.length?namedModels:follow&&previous?previous.models:[];context.topic=q.slice(0,140);
 if(intent==='rainProtection')context.variable='precipitation';
 if(!follow&&!activity)delete context.activity;
 if(intent!=='rainProtection'){delete context.protection;delete context.daypart;delete context.time;}
 if(intent==='stations'&&!variable)context.variable='temperature';
 return plan;
}

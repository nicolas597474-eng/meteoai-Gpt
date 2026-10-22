import {dateAt,dateLabel,finite,normalize,number,shiftDate,VARIABLES,type Context,type DataPort,type Plan,type Reply,type Source} from './contracts';
import {documentedAnswer} from './knowledge';
import {activityWindows} from './activities';
import {rainProtectionAdvice} from './rainProtection';
import {noteFromMeanAbsoluteError} from '../components/weather/ReliabilityEvidenceSections';
const clock=(at:number)=>new Date(at).toLocaleTimeString('fr-FR',{timeZone:'Europe/Paris',hour:'2-digit',minute:'2-digit'});
const unavailable=(text:string,context:Context):Reply=>({text,context,sources:[],links:[{label:'Ouvrir Prévisions',href:'/details'}]});
export async function answerPlan(plan:Plan,port:DataPort,now=Date.now()):Promise<Reply>{
 const c={...plan.context},q=normalize(plan.question);
 if(plan.clarification)return unavailable(plan.clarification,c);
 if(c.intent==='unknown')return {...documentedAnswer(plan.question),text:'Je ne suis pas certain d’avoir compris ce que vous souhaitez savoir ou décider. Pouvez-vous préciser votre demande ? Par exemple : faut-il prévoir une protection contre la pluie, quelles rafales sont annoncées, ou quel créneau choisir pour une sortie ?',context:c};
 if(c.intent==='guide')return {...documentedAnswer(plan.question),context:c};
 if(plan.locationQuery){
  if(normalize(c.place.name.split(',')[0])!==normalize(plan.locationQuery)){
   const choices=await port.resolvePlace(plan.locationQuery),exact=choices.filter(p=>normalize(p.name.split(',')[0])===normalize(plan.locationQuery!));
   if(exact.length===1)c.place=exact[0];else if(choices.length===1)c.place=choices[0];
   else return {text:choices.length?'Plusieurs lieux correspondent. Sélectionnez celui que vous souhaitez utiliser.':'Aucun lieu correspondant trouvé. Précisez la commune.',sources:[],choices,context:c};
  }
 }
 const head=`${c.place.name} · ${c.period==='now'?'maintenant':dateLabel(c.date)}`;
 const result=(text:string,sources:Source[],href='/details'):Reply=>({text:head+'\n'+text,context:c,sources,links:[{label:'Ouvrir la page concernée',href}]});
 if(c.intent==='reliability'){
  if(plan.explicitDate&&c.period==='day')return unavailable('La fiabilité se lit sur l’historique déjà comparé aux observations, pas comme une note météo pour une journée future. Demandez « Quel est le score de fiabilité ? » pour lire les notes disponibles.',c);
  const d=await port.reliability(c.place);
  if(d?.meteoaiReliability&&!c.models.length&&c.variable==='temperature'){
   const h=d.meteoaiReliability,notes=[['Globale',h.global],['Horaire',h.hourly],['Quotidienne',h.daily]] as const;
   const text=notes.map(([label,cell])=>`${label} MeteoAI : ${h.complete&&finite(cell?.note)?number(cell.note)+'/10'+(cell.qualified?'':' · provisoire'):'non disponible'}.`).join('\n');
   return result(text+'\n'+h.reason+(h.global?.partial?' La globale est partielle : une seule composante est disponible.':'')+'\nCes notes comparent les températures MeteoAI archivées aux observations physiques, sur tout l’historique disponible.',[{kind:'calculation',label:'Historique MeteoAI · prévisions contre observations physiques',href:'/laboratoire'}],'/laboratoire');
  }
  if(d?.evidence?.status!=='available')return unavailable('Aucune archive de fiabilité lisible pour ce lieu. Les archives d’un autre lieu ne sont pas utilisées en remplacement.',c);
  const raw=d.notes?.provisionalHourly,note=noteFromMeanAbsoluteError(d.notes?.hourly?.qualifiedCells>0?d.notes.hourly.mae:null);
  const source:Source={kind:'calculation',label:`Archives vérifiées · ${d.period?.startDate} → ${d.period?.endDate} · ${d.selectedHorizon?.label}`,href:'/laboratoire'};
  const dates=(d.metrics??[]).map((r:any)=>Date.parse(r.latestComputedAt??'')).filter(finite);if(dates.length)source.updatedAt=new Date(Math.max(...dates)).toISOString();
  if(c.variable!=='temperature'||c.models.length){
   const key=({temperature:'temperature',apparentTemperature:'apparent_temperature',humidity:'humidity',windSpeed:'wind_speed',windGust:'wind_gust',precipitation:'rain_liquid_1h',pressure:'pressure_msl'} as Record<string,string>)[c.variable];
   const rows=(d.metrics??[]).filter((r:any)=>r.variable===key&&(!c.models.length||c.models.includes(r.modelName)));
   return result((c.variable==='pressure'?'La Fiabilité évalue la pression au niveau de la mer, distincte de la pression de surface.\n':c.variable==='precipitation'?'La Fiabilité évalue ici la pluie liquide sur une même fenêtre de 60 minutes.\n':'')+(rows.length?rows.map((r:any)=>{const m=r.rawValidated===true?r.rawMetrics:null;return `${r.modelName} · ${r.variableLabel??c.variable} : ${m&&finite(m.mae)?`MAE ${number(m.mae,2)} ${r.unit}, ${m.comparisonCount} comparaison(s) sur ${m.evaluatedDays} date(s) · ${r.status==='qualified'?'qualifié':'provisoire, non qualifié'}`:'aucune métrique vérifiée disponible'}.`;}).join('\n'):'Aucune métrique vérifiée disponible pour ce modèle et cette variable à l’horizon sélectionné.'),[source],'/laboratoire');
  }
  return result((note===null?'Note horaire de température : non disponible.':`Note horaire de température : ${number(note)}/10.`)+`\n${raw?.comparisonCount??0} comparaison(s) de température sur ${raw?.evaluatedDays??0} date(s), pour ${raw?.modelCount??0} modèle(s). Les seuils s’appliquent séparément à chaque modèle, variable et horizon : ${d.evidence.minimumComparisons} comparaisons et ${d.evidence.minimumComparableDays} dates distinctes.`+(finite(raw?.mae)?` MAE provisoire moyenne : ${number(raw.mae,2)} °C.`:'')+(d.evidence.filesRejected||d.evidence.boundedRead?' Lecture partielle : les limites signalées dans la page restent applicables.':''),[source],'/laboratoire');
 }
 if(c.intent==='stations'){
  if(c.period!=='now'&&c.date!==dateAt(now))return unavailable('La recherche de stations présente les relevés actuels, pas une mesure future ou une archive choisie par date. Demandez « la station la plus proche maintenant » ou ouvrez Historique.',c);
  if(c.variable!=='temperature')return unavailable('Cette comparaison de stations porte actuellement sur la température. Les autres mesures restent consultables dans Stations lorsqu’elles sont disponibles.',c);
  const stations=(await port.stations(c.place)).filter(s=>finite(s.temp)&&finite(s.time)&&s.time<=now+60000&&now-s.time<=30*60000&&!s.anomaly&&s.distance<=50).sort((a,b)=>a.distance-b.distance).slice(0,/compar|plusieurs|ecart/.test(q)?3:1);
  if(!stations.length)return {...unavailable('Aucune station avec une température admissible datant de moins de 30 minutes dans la zone de 50 km. Vérifiez la connexion Netatmo et la page Stations.',c),links:[{label:'Stations',href:'/ranking'},{label:'Connexion Netatmo',href:'/connexion-netatmo'}]};
  const lines=stations.map(s=>`${s.name} : ${number(s.temp)} °C, à ${number(s.distance)} km, relevé de ${clock(s.time)}.`);
  if(stations.length>1)lines.push(`Écart entre températures extrêmes de ces ${stations.length} stations : ${number(Math.max(...stations.map(s=>s.temp))-Math.min(...stations.map(s=>s.temp)))} °C. Les heures de mesure peuvent différer ; ce n’est pas un score de fiabilité.`);
  return result(lines.join('\n'),stations.map(s=>({kind:'observation',label:`Netatmo · ${s.name}`,updatedAt:new Date(s.time).toISOString(),href:'/ranking'})),'/ranking');
 }
 if(c.date<dateAt(now)||c.date>shiftDate(dateAt(now),14))return {...unavailable('Cette date est hors de la fenêtre de prévision de quinze jours. Consultez Historique pour les dates passées ; une archive ne devient pas une observation actuelle.',c),links:[{label:'Historique',href:'/history'}]};
 if(c.intent==='rainProtection'){
  const forecast=await port.forecast(c.place,false);
  if(forecast.stale)return unavailable('Je ne peux pas encore vous conseiller : les prévisions horaires doivent être actualisées pour vérifier les précipitations.',c);
  const advice=rainProtectionAdvice(forecast,c,now);
  return advice.hasEvidence?result(advice.text,[{kind:'forecast',label:'Prévisions MeteoAI · précipitations Open-Meteo',updatedAt:forecast.updatedAt,validAt:c.date,href:'/details'}]):unavailable(advice.text,c);
 }
 if(c.intent==='models'){
  if(c.variable==='probability'||!['temperature','precipitation','windSpeed','windGust','humidity','pressure'].includes(c.variable))return unavailable('Précisez une comparaison de température, pluie, vent, rafales, humidité ou pression entre modèles.',c);
  const d=await port.comparison(c.place),at=Date.parse(d?.collectedAt??'');
  if(d?.stale||!finite(at)||at>now+60000||now-at>15*60000)return unavailable('Les valeurs des modèles ne sont pas assez récentes pour cette comparaison. Réessayez après actualisation.',c);
  const slots=(d.slots??[]).filter((t:number)=>finite(t)&&t>=now&&dateAt(t)===c.date);
  const slot=slots[0];if(!slot)return unavailable('Aucune échéance horaire commune reçue pour cette date. Le comparatif horaire ne prolonge pas les modèles courts jusqu’à quinze jours.',c);
  const key=c.variable==='windGust'?'windGust':c.variable;
  const models=(d.models??[]).filter((m:any)=>!m.reference&&(!c.models.length||c.models.includes(m.name)));
  const rows=models.map((m:any)=>({name:m.name,value:m.hours?.find((h:any)=>h.validAt===slot)?.[key]}));
  for(const name of c.models)if(!rows.some((r:any)=>r.name===name))rows.push({name,value:null});
  const available=rows.filter((r:any)=>finite(r.value));
  const text=rows.map((r:any)=>`${r.name} : ${finite(r.value)?`${number(r.value)} ${VARIABLES[c.variable].unit}`:'indisponible'}.`).join('\n');
  return result(`Comparaison à ${clock(slot)} (Paris), même échéance.\n${text||'Aucun modèle sélectionné disponible.'}`+(available.length>=2?`\nÉtendue des valeurs reçues : ${number(Math.max(...available.map((r:any)=>r.value))-Math.min(...available.map((r:any)=>r.value)))} ${VARIABLES[c.variable].unit}. Cet accord ne mesure pas la fiabilité historique.`:''),[{kind:'forecast',label:'Open-Meteo · '+available.map((r:any)=>r.name).join(', '),updatedAt:d.collectedAt,validAt:new Date(slot).toISOString(),href:'/details'}]);
 }
 if(c.intent==='weights'){
  const f=await port.forecast(c.place,false);if(f.stale)return unavailable('La trace disponible est ancienne ou son horodatage source est absent. Actualisez les prévisions avant d’expliquer les poids courants.',c);
  const hour=f.hours.find(h=>h.validAt>=now&&h.date===c.date),key=VARIABLES[c.variable].hour;
  const variable=hour?.forecastWeighting?.variableWeightings?.find((v:any)=>v.variable===({temp:'temperature',windSpeed:'wind_speed',windGust:'wind_gust'} as any)[key]||v.variable===c.variable);
  const weights=variable?.modelWeights?.filter((m:any)=>m.contributedToValue&&finite(m.weight));
  if(!weights?.length)return {...documentedAnswer('Comment fonctionne la pondération des modèles ?'),text:'Aucune trace chiffrée de pondération disponible pour cette variable et cette date.\n'+documentedAnswer('Comment fonctionne la pondération des modèles ?').text,context:c};
  return result(`Poids réellement appliqués à ${clock(hour!.validAt)} pour ${VARIABLES[c.variable].label.toLowerCase()} :\n`+weights.map((m:any)=>`${m.modelName} : ${number(m.weight*100)} %`).join('\n')+`\nMéthode : ${variable.method}. Ces parts ne sont pas des probabilités de réussite.`,[{kind:'calculation',label:'Trace du moteur MeteoAI',updatedAt:f.updatedAt,validAt:new Date(hour!.validAt).toISOString(),href:'/ai-lab'}],'/ai-lab');
 }
 if(c.intent==='activity'){
  if(!c.activity)return unavailable('Quelle activité souhaitez-vous examiner ?',c);
  const f=await port.forecast(c.place,false);if(f.stale)return unavailable('Les prévisions horaires doivent être actualisées avant d’examiner cette activité.',c);
  const a=activityWindows(f.hours.filter(h=>h.date===c.date),c.activity,now),hours=a.windows.map(w=>`${clock(w.start)}–${clock(w.end)} (Paris) : vent ≤ ${number(w.wind)} km/h, rafales ≤ ${number(w.gust)} km/h, précipitations ≤ ${number(w.rain)} mm/h.`);
  return result(`${c.activity} : ${hours.length?'créneau(x) compatible(s) avec les critères de confort choisis':'aucun créneau confirmé avec les données horaires disponibles'}.\n${hours.join('\n')}\nCritères : ${a.criteria}\n${a.missing} heure(s) incomplète(s) exclue(s) sur ${a.examined} heure(s) futures examinées. Ces critères sont des repères, pas une validation de sécurité. Vigilance officielle non vérifiée ici.`+(c.activity==='kayak'?' Débits, courants, niveau et température de l’eau, marées et restrictions locales non disponibles : la sécurité de navigation ne peut pas être confirmée.':c.activity==='tonte'?' L’humidité réelle du sol et de l’herbe n’est pas connue.':c.activity==='plage'?' État de la mer, courants et qualité de baignade non vérifiés.':''),[{kind:'calculation',label:'Critères explicites appliqués aux prévisions Open-Meteo',updatedAt:f.updatedAt,href:'/details'}]);
 }
 if(c.variable==='probability')return unavailable('Je ne dispose pas ici d’une probabilité de pluie validée. La proportion de modèles prévoyant de la pluie n’est pas une probabilité calibrée. Je peux donner les quantités prévues en millimètres.',c);
 if(c.period==='now'&&!['dewPoint','visibility','uvIndex'].includes(c.variable)){
  const reading=await port.current(c.place,c.variable);
  if(!finite(reading.value))return unavailable(`${VARIABLES[c.variable].label} : indisponible actuellement. ${reading.reason??'Aucune valeur récente reçue.'}`,c);
  const description=c.variable==='temperature'?`Il fait actuellement ${number(reading.value)} °C.`:c.variable==='apparentTemperature'?`La température ressentie est de ${number(reading.value)} °C.`:`${VARIABLES[c.variable].label} : ${number(reading.value)} ${VARIABLES[c.variable].unit}.`;
  return result(`${description}\n${reading.kind==='observation'?'Cette valeur vient de la synthèse des observations physiques.':'Cette valeur est une estimation actuelle de modèle, pas une mesure de station.'}`+(reading.reason?' '+reading.reason:''),[{kind:reading.kind,label:reading.label,updatedAt:reading.updatedAt,href:'/'}],'/');
 }
 const f=await port.forecast(c.place,c.period==='day');if(f.stale)return unavailable('Les prévisions reçues sont anciennes ou leur horodatage source n’est pas vérifiable. Actualisez-les ; je ne les présente pas comme une nouvelle prévision.',c);
 if(c.period==='day'){
  const day=f.days.find(d=>d.date===c.date);if(!day)return unavailable('Aucune prévision quotidienne reçue pour cette date. La couverture des modèles courts n’est pas extrapolée.',c);
  const v=VARIABLES[c.variable],value=v.day?day[v.day]:null;
  const text=c.variable==='temperature'?`Pour cette journée, la prévision indique un minimum ${finite(day.tempMin)?'de '+number(day.tempMin)+' °C':'indisponible'} et un maximum ${finite(day.tempMax)?'de '+number(day.tempMax)+' °C':'indisponible'}.`:c.variable==='precipitation'&&finite(value)?(value>0?`Des précipitations sont prévues : ${number(value)} mm cumulés sur la journée locale. Ce total ne précise pas à lui seul à quelles heures il pleuvra.`:`Aucune précipitation n’est prévue dans le cumul disponible : ${number(value)} mm cumulés sur la journée locale. Cela reste une prévision, pas une garantie d’absence de pluie.`):finite(value)?`${v.label}${c.variable==='windSpeed'?' maximal':c.variable==='windGust'?' maximales':''} : ${number(value)} ${v.unit}.`:`${v.label} : aucune valeur quotidienne disponible. Demandez « maintenant » ou consultez le détail horaire.`;
  return result(text,[{kind:'forecast',label:'Prévision officielle MeteoAI · Open-Meteo',updatedAt:f.updatedAt,validAt:c.date,href:'/details'}]);
 }
 const hour=f.hours.find(h=>h.validAt>=now&&h.date===c.date),v=VARIABLES[c.variable],value=hour?.[v.hour];
 if(!hour||!finite(value))return unavailable(`${v.label} : aucune valeur horaire disponible.`,c);
 return result(`${v.label} prévue à ${clock(hour.validAt)} : ${number(value)} ${v.unit}.`,[{kind:'forecast',label:'Prévision horaire MeteoAI · Open-Meteo',updatedAt:f.updatedAt,validAt:new Date(hour.validAt).toISOString(),href:'/details'}]);
}

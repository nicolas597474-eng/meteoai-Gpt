import {dateAt,dateLabel,finite,number,shiftDate,type Context,type Forecast} from './contracts';
const HOUR=3600000;
const timeFormat=new Intl.DateTimeFormat('fr-FR',{timeZone:'Europe/Paris',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
const clock=(at:number)=>timeFormat.format(at);
const minute=(at:number)=>{const [h,m]=clock(at).split(':').map(Number);return h*60+m;};
const bounds={morning:[6*60,12*60],afternoon:[12*60,18*60],evening:[18*60,24*60]} as const;
/** Sélection et conseil de lecture : aucune valeur météo n'est recalculée. */
export function rainProtectionAdvice(forecast:Forecast,context:Context,now:number){
 const gear=context.protection==='umbrella'?'une protection contre la pluie':'votre K-way ou une veste imperméable';
 const period=context.period==='now'?'maintenant':context.date===shiftDate(dateAt(now),1)?'demain':context.date===dateAt(now)?'aujourd’hui':dateLabel(context.date);
 const part=context.daypart?{morning:'le matin',afternoon:'l’après-midi',evening:'le soir'}[context.daypart]:'';
 const range=context.time?context.time.split(':').map(Number):null,target=range?range[0]*60+range[1]:null;
 const matches=(at:number)=>{
  if(dateAt(at)!==context.date||at+HOUR<=now)return false;
  if(context.period==='now')return at<=now&&now<at+HOUR;
  const start=minute(at);
  return target!==null?start<=target&&target<start+60:context.daypart?start>=bounds[context.daypart][0]&&start<bounds[context.daypart][1]:true;
 };
 // Énumérer les vrais créneaux UTC du jour parisien conserve les journées de
 // 23 ou 25 heures, au lieu de supposer artificiellement 24 relevés.
 const midnight=Date.parse(context.date+'T00:00:00Z'),expected:number[]=[];
 for(let at=midnight-14*HOUR;at<=midnight+36*HOUR;at+=HOUR)if(matches(at))expected.push(at);
 const rows=new Map(forecast.hours.filter(h=>finite(h.validAt)&&matches(h.validAt)).map(h=>[h.validAt,h]));
 const wet=expected.map(at=>rows.get(at)).filter(h=>h&&finite(h.precipitation)&&h.precipitation>0);
 const missing=expected.filter(at=>{const rain=rows.get(at)?.precipitation;return !finite(rain)||rain<0;}).length;
 const scope=context.time?'autour de '+context.time:part;
 if(wet.length){
  const times=wet.map(h=>h!.validAt),duplicate=times.some((at,i)=>times.findIndex(t=>clock(t)===clock(at))!==i);
  const show=(at:number)=>duplicate?new Intl.DateTimeFormat('fr-FR',{timeZone:'Europe/Paris',hour:'2-digit',minute:'2-digit',timeZoneName:'shortOffset'}).format(at):clock(at);
  const selected=times.slice(0,6).map(show).join(', '),extra=times.length>6?' et à d’autres heures':'';
  return {text:`Oui, je vous conseille de prévoir ${gear} ${period}${scope?' '+scope:''} : des précipitations sont prévues vers ${selected}${extra} (heure de Paris).`+(missing?' La couverture horaire est partielle ; d’autres heures restent à vérifier.':'')+' Les heures annoncées restent des prévisions.',hasEvidence:true};
 }
 if(expected.length&&missing===0)return {text:`Non, les prévisions ne montrent pas de précipitations ${period}${scope?' '+scope:''} ; je ne vois donc pas de raison météo de prévoir ${gear} pour cette période. Cela reste une prévision, à vérifier avant de sortir.`,hasEvidence:true};
 const daily=context.period==='day'&&!context.daypart&&!context.time?forecast.days.find(d=>d.date===context.date):null;
 if(daily&&finite(daily.precipitation)&&daily.precipitation>=0)return {text:daily.precipitation>0?`Oui, je vous conseille de prévoir ${gear} ${period} : ${number(daily.precipitation,2)} mm de précipitations sont prévus sur la journée. Je n’ai pas les heures nécessaires pour vous dire quand le porter.`:`Le cumul quotidien disponible est nul, mais la couverture horaire est incomplète : je ne peux pas vous confirmer les heures où vous pourrez vous passer d’une protection.`,hasEvidence:true};
 return {text:expected.length?`Je ne peux pas vous dire de façon fiable s’il faut prévoir ${gear} ${period}${scope?' '+scope:''} : les précipitations horaires sont incomplètes pour cette période. Je préfère vous le signaler plutôt que vous donner un horaire inventé.`:'Je n’ai pas de créneau à venir correspondant à cette période. Vérifiez la date et l’heure souhaitées.',hasEvidence:false};
}

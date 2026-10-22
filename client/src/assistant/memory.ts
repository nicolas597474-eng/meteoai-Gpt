import {ALLOWED_LINKS,dateValid,finite,type Context,type Conversation,type Message,type Place} from './contracts';
export const MEMORY_KEY='meteoai-assistant-local-v1',MEMORY_TTL=24*3600000,MAX_MESSAGES=24;
const intents=['weather','stations','models','reliability','weights','activity','rainProtection','guide','unknown'],variables=['temperature','apparentTemperature','precipitation','windSpeed','windGust','humidity','pressure','cloudCover','dewPoint','visibility','uvIndex','probability'];
export function placeValid(p:any):p is Place{return p&&typeof p.name==='string'&&p.name.length>0&&p.name.length<=120&&finite(p.lat)&&finite(p.lon)&&Math.abs(p.lat)<=90&&Math.abs(p.lon)<=180&&(p.localMode===undefined||['standard','local','ultra-local'].includes(p.localMode));}
function contextValid(c:any):c is Context{return c&&placeValid(c.place)&&dateValid(c.date)&&['now','day'].includes(c.period)&&intents.includes(c.intent)&&variables.includes(c.variable)&&Array.isArray(c.models)&&c.models.length<=7&&c.models.every((m:any)=>typeof m==='string'&&m.length<=12)&&typeof c.topic==='string'&&c.topic.length<=140&&c.page==='/laboratoire'&&(c.activity===undefined||['kayak','randonnée','vélo','jardinage','tonte','promenade','plage'].includes(c.activity))&&(c.protection===undefined||['raincoat','umbrella'].includes(c.protection))&&(c.daypart===undefined||['morning','afternoon','evening'].includes(c.daypart))&&(c.time===undefined||typeof c.time==='string'&&/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(c.time));}
export const emptyConversation=(now=Date.now()):Conversation=>({version:1,at:now,context:null,messages:[]});
export function loadConversation(storage:Pick<Storage,'getItem'|'removeItem'>|undefined,now=Date.now()):Conversation{
 try{const text=storage?.getItem(MEMORY_KEY);if(!text)return emptyConversation(now);if(text.length>100000)throw Error('Taille');const v=JSON.parse(text);
  if(v.version!==1||!finite(v.at)||v.at>now||now-v.at>=MEMORY_TTL||v.context!==null&&!contextValid(v.context)||!Array.isArray(v.messages)||v.messages.length>MAX_MESSAGES)throw Error('Mémoire expirée ou invalide');
  // Ne restaurer que le texte : ni anciennes valeurs structurées ni liens issus du stockage.
  const messages:Message[]=v.messages.map((m:any)=>{if(!m||!['user','assistant'].includes(m.role)||typeof m.text!=='string'||m.text.length>6000||!finite(m.at)||m.at>now)throw Error('Message invalide');return {role:m.role,text:m.text,at:m.at};});
  return {version:1,at:v.at,context:v.context,messages};
 }catch{try{storage?.removeItem(MEMORY_KEY);}catch{}return emptyConversation(now);}
}
export function saveConversation(storage:Pick<Storage,'setItem'>|undefined,value:Conversation){
 try{storage?.setItem(MEMORY_KEY,JSON.stringify({...value,messages:value.messages.slice(-MAX_MESSAGES).map(({role,text,at,reply})=>({role,text:(text+(reply?.ai?.text?'\n\nInterprétation IA · Gemini 3.6 Flash\n'+reply.ai.text:'')).slice(0,6000),at}))}));return !!storage;}catch{return false;}
}
export function clearConversation(storage:Pick<Storage,'removeItem'>|undefined){try{storage?.removeItem(MEMORY_KEY);}catch{}}
export const safeLink=(href:string)=>ALLOWED_LINKS.has(href)?href:'/laboratoire';

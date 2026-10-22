import type {EnvironmentalJsonCache} from '../../../server/environmentalData';
/** Raw public environmental inputs only. Positions and phases are never persisted. */
export const PUBLIC_ENVIRONMENTAL_CACHE='meteoai-public-environment-v1';
export const ENVIRONMENT_WEATHER_TTL_MS=10*60_000,ENVIRONMENT_AIR_TTL_MS=20*60_000;
const MAX_ENTRIES=16,MAX_BYTES=1_000_000,MAX_ENTRY_BYTES=100_000;
type Options={origin:string;storage?:CacheStorage;now?:()=>number};
type Row={at:number;value:Record<string,any>};
const localDay=(at:number)=>new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Paris',year:'numeric',month:'2-digit',day:'2-digit'}).format(at);
function policy(url:URL){
 if(url.protocol!=='https:'||url.username||url.password||url.port||url.hash)return null;
 const lat=url.searchParams.get('latitude'),lon=url.searchParams.get('longitude');
 if(!lat||!lon||!Number.isFinite(Number(lat))||!Number.isFinite(Number(lon))||Math.abs(Number(lat))>90||Math.abs(Number(lon))>180)return null;
 const parameters=Object.fromEntries(url.searchParams);
 const matches=(expected:Record<string,string>)=>Object.keys(parameters).length===Object.keys(expected).length+2
  &&Object.entries(expected).every(([key,value])=>url.searchParams.getAll(key).length===1&&parameters[key]===value)
  &&url.searchParams.getAll('latitude').length===1&&url.searchParams.getAll('longitude').length===1;
 if(url.hostname==='api.open-meteo.com'&&url.pathname==='/v1/forecast'&&matches({daily:'sunrise,sunset,daylight_duration,cloud_cover_mean',current:'cloud_cover',forecast_days:'16',timezone:'Europe/Paris'}))return {kind:'weather' as const,ttl:ENVIRONMENT_WEATHER_TTL_MS};
 if(url.hostname==='air-quality-api.open-meteo.com'&&url.pathname==='/v1/air-quality'&&matches({current:'european_aqi,pm2_5,pm10,nitrogen_dioxide,ozone',hourly:'european_aqi',forecast_hours:'24',timezone:'Europe/Paris'}))return {kind:'air' as const,ttl:ENVIRONMENT_AIR_TTL_MS};
 return null;
}
function sanitize(url:URL,value:any):Record<string,any>|null {
 const rule=policy(url);if(!rule||!value||typeof value!=='object'||value.error)return null;
 const timezone=value.timezone==='Europe/Paris'?'Europe/Paris':null;if(!timezone)return null;
 const numberOrNull=(v:unknown)=>v===null||(typeof v==='number'&&Number.isFinite(v));
 const times=(v:unknown,max:number)=>Array.isArray(v)&&v.length<=max&&v.every(x=>typeof x==='string'&&/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2})?)?$/.test(x));
 const values=(v:unknown,length:number)=>Array.isArray(v)&&v.length===length&&v.every(numberOrNull);
 if(rule.kind==='weather'){
  const daily=value.daily,current=value.current;
  if(!daily||!times(daily.time,16)||!daily.time.length||!values(daily.daylight_duration,daily.time.length)||!values(daily.cloud_cover_mean,daily.time.length))return null;
  if(current?.cloud_cover!==undefined&&!numberOrNull(current.cloud_cover))return null;
  return {timezone,daily:{time:daily.time,daylight_duration:daily.daylight_duration,cloud_cover_mean:daily.cloud_cover_mean,
   ...(times(daily.sunrise,16)?{sunrise:daily.sunrise}:{}),...(times(daily.sunset,16)?{sunset:daily.sunset}:{})},current:{cloud_cover:current?.cloud_cover??null}};
 }
 const current=value.current,hourly=value.hourly;
 if(!current||typeof current.time!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(current.time)||!hourly||!times(hourly.time,48)||!values(hourly.european_aqi,hourly.time.length))return null;
 const fields=['european_aqi','pm2_5','pm10','nitrogen_dioxide','ozone'];
 if(fields.some(key=>current[key]!==undefined&&!numberOrNull(current[key])))return null;
 if(!fields.some(key=>typeof current[key]==='number'&&current[key]>=0))return null;
 return {timezone,current:{time:current.time,...Object.fromEntries(fields.map(key=>[key,current[key]??null]))},hourly:{time:hourly.time,european_aqi:hourly.european_aqi}};
}
export class PublicEnvironmentalCache implements EnvironmentalJsonCache {
 private memory=new Map<string,string>();
 private now:()=>number;
 constructor(private options:Options){this.now=options.now??Date.now;}
 private key(url:URL){const sorted=new URL(url);sorted.searchParams.sort();return sorted.toString();}
 private request(key:string){return new Request(this.options.origin+'/__meteoai_environment__/'+encodeURIComponent(key));}
 private read(url:URL,text:string):Row|null {
  const rule=policy(url);if(!rule||new TextEncoder().encode(text).byteLength>MAX_ENTRY_BYTES)return null;
  try{const row=JSON.parse(text),now=this.now();
   if(!Number.isFinite(row.at)||row.at>now||now-row.at>=rule.ttl||localDay(row.at)!==localDay(now))return null;
   const value=sanitize(url,row.value);return value?{at:row.at,value}:null;
  }catch{return null;}
 }
 private remember(key:string,text:string){
  this.memory.delete(key);this.memory.set(key,text);
  let bytes=Array.from(this.memory.values()).reduce((sum,value)=>sum+new TextEncoder().encode(value).byteLength,0);
  while(this.memory.size>MAX_ENTRIES||bytes>MAX_BYTES){const first=this.memory.keys().next().value!;bytes-=new TextEncoder().encode(this.memory.get(first)!).byteLength;this.memory.delete(first);}
 }
 async get(url:URL){
  if(!policy(url))return null;
  const key=this.key(url),memory=this.memory.get(key);
  if(memory){const row=this.read(url,memory);if(row)return row.value;this.memory.delete(key);}
  try{const cache=await this.options.storage?.open(PUBLIC_ENVIRONMENTAL_CACHE),request=this.request(key),response=await cache?.match(request);
   if(!response)return null;
   const row=this.read(url,await response.text());if(!row){await cache?.delete(request);return null;}
   this.remember(key,JSON.stringify(row));return row.value;
  }catch{return null;}
 }
 async put(url:URL,value:Record<string,any>,receivedAt:number){
  if(!policy(url))return;
  const candidate=JSON.stringify({at:receivedAt,value}),row=this.read(url,candidate);if(!row)return;
  const text=JSON.stringify(row),key=this.key(url);this.remember(key,text);
  try{const cache=await this.options.storage?.open(PUBLIC_ENVIRONMENTAL_CACHE);if(!cache)return;
   await cache.put(this.request(key),new Response(text,{headers:{'Content-Type':'application/json','X-MeteoAI-At':String(receivedAt),'X-MeteoAI-Bytes':String(new TextEncoder().encode(text).byteLength)}}));
   const rows=await Promise.all((await cache.keys()).map(async request=>({request,response:await cache.match(request)})));
   rows.sort((a,b)=>Number(b.response?.headers.get('X-MeteoAI-At'))-Number(a.response?.headers.get('X-MeteoAI-At')));
   let bytes=0,count=0;
   for(const saved of rows){const size=Number(saved.response?.headers.get('X-MeteoAI-Bytes')??MAX_ENTRY_BYTES);
    let valid=false;try{const raw=decodeURIComponent(new URL(saved.request.url).pathname.split('/').pop()!);valid=!!this.read(new URL(raw),await saved.response!.text());}catch{}
    if(!valid||!Number.isFinite(size)||size<0||count>=MAX_ENTRIES||bytes+size>MAX_BYTES){await cache.delete(saved.request);continue;}
    count++;bytes+=size;
   }
  }catch{/* Optional device storage must never block valid environmental data. */}
 }
}
/** Works in the page and its calculation Worker; no server binding or token. */
export const publicEnvironmentalCache=new PublicEnvironmentalCache({origin:typeof location==='undefined'?'https://meteoai.invalid':location.origin,storage:globalThis.caches});

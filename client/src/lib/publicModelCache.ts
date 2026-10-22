/** Public forecast batches only. Current conditions, Netatmo and account data stay out. */
export const PUBLIC_MODEL_CACHE='meteoai-public-model-batches-v1';
import {forecastBatchTtl,HOURLY_FORECAST_CACHE_MS} from '@shared/forecastCachePolicy';
export const PUBLIC_MODEL_TTL_MS=HOURLY_FORECAST_CACHE_MS;
const MAX_BYTES=16_000_000,MAX_ENTRY_BYTES=8_000_000,MAX_ENTRIES=12;
type Options={origin:string;storage?:CacheStorage;now?:()=>number};
function publicEntry(key:string,text:string,now:number){
 const ttl=forecastBatchTtl(key);
 if(!/^controle\/weather-v2\/(model-collection-v1|daily-full-v4)\//.test(key)||new TextEncoder().encode(text).byteLength>MAX_ENTRY_BYTES)return null;
 try{
  const row=JSON.parse(text);
  if(!Number.isFinite(row?.at)||row.at>now||now-row.at>=ttl||!row.value)return null;
  const value=row.value;
  const receivedAt=Date.parse(value.collectedAt);
  if(!Number.isFinite(receivedAt)||receivedAt>row.at||row.at-receivedAt>=ttl)return null;
  if(key.includes('/model-collection-v1/')){
   if(!Array.isArray(value.forecasts)||!value.forecasts.length||!Array.isArray(value.diagnostics)||!Number.isFinite(Date.parse(value.collectedAt)))return null;
   return {at:row.at,value:{forecasts:value.forecasts,diagnostics:value.diagnostics,collectedAt:value.collectedAt}};
  }
  if(!Array.isArray(value.days)||!value.days.length||!Array.isArray(value.modelsUsed)||!Number.isFinite(Date.parse(value.collectedAt)))return null;
  return {at:row.at,value:{days:value.days,modelsUsed:value.modelsUsed,dailyStatus:value.dailyStatus,aiLabDetails:value.aiLabDetails,learningSummary:value.learningSummary,collectedAt:value.collectedAt}};
 }catch{return null;}
}
export class PublicModelCache {
 private memory=new Map<string,{text:string;bytes:number}>();
 private now:()=>number;
 constructor(private options:Options){this.now=options.now??Date.now;}
 private request(key:string){return new Request(this.options.origin+'/__meteoai_model_batch__/'+encodeURIComponent(key));}
 private remember(key:string,text:string){
  const bytes=new TextEncoder().encode(text).byteLength;
  if(bytes>MAX_ENTRY_BYTES)return;
  this.memory.delete(key);this.memory.set(key,{text,bytes});
  let total=Array.from(this.memory.values()).reduce((sum,row)=>sum+row.bytes,0);
  while(this.memory.size>MAX_ENTRIES||total>MAX_BYTES){const oldest=this.memory.keys().next().value!;total-=this.memory.get(oldest)!.bytes;this.memory.delete(oldest);}
 }
 async get(key:string):Promise<{json:()=>Promise<any>}|null>{
  const memory=this.memory.get(key);
  if(memory){if(publicEntry(key,memory.text,this.now()))return {json:async()=>JSON.parse(memory.text)};this.memory.delete(key);}
  if(!/^controle\/weather-v2\/(model-collection-v1|daily-full-v4)\//.test(key))return null;
  try{
   const cache=await this.options.storage?.open(PUBLIC_MODEL_CACHE),request=this.request(key),response=await cache?.match(request);
   if(!response)return null;
   const text=await response.text(),entry=publicEntry(key,text,this.now());
   if(!entry){await cache?.delete(request);return null;}
   const sanitized=JSON.stringify(entry);this.remember(key,sanitized);
   return {json:async()=>JSON.parse(sanitized)};
  }catch{return null;}
 }
 async put(key:string,text:string){
  const entry=publicEntry(key,text,this.now());if(!entry)return;
  const sanitized=JSON.stringify(entry);this.remember(key,sanitized);
  try{
   const cache=await this.options.storage?.open(PUBLIC_MODEL_CACHE);if(!cache)return;
   await cache.put(this.request(key),new Response(sanitized,{headers:{'Content-Type':'application/json','X-MeteoAI-At':String(entry.at),'X-MeteoAI-Bytes':String(new TextEncoder().encode(sanitized).byteLength)}}));
   const rows=await Promise.all((await cache.keys()).map(async request=>{const response=await cache.match(request);return {request,at:Number(response?.headers.get('X-MeteoAI-At')??0),bytes:Number(response?.headers.get('X-MeteoAI-Bytes')??MAX_ENTRY_BYTES)};}));
   rows.sort((a,b)=>b.at-a.at);let bytes=0,count=0;
   for(const row of rows){
    const storedKey=decodeURIComponent(new URL(row.request.url).pathname.split('/').at(-1)!);
    if(!Number.isFinite(row.at)||row.at>this.now()||this.now()-row.at>=forecastBatchTtl(storedKey)||count>=MAX_ENTRIES||bytes+row.bytes>MAX_BYTES){await cache.delete(row.request);continue;}
    count++;bytes+=row.bytes;
   }
  }catch{/* Optional device storage must never prevent the weather from loading. */}
 }
}

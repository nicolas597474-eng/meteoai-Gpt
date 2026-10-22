import {readProviderRateLimit,type ProviderRateLimit} from './providerRateLimit';
export type QuotaProvider='forecast'|'single_runs';
export type WeatherQuotaStore={read:(provider:QuotaProvider)=>Promise<ProviderRateLimit|null>;write:(provider:QuotaProvider,limit:ProviderRateLimit)=>Promise<void>};
const KEY='meteoai-open-meteo-pauses-v1';
const memory=new Map<QuotaProvider,ProviderRateLimit>();
function valid(value:any,now=Date.now()):value is ProviderRateLimit{return value&&['minute','hour','day','unknown'].includes(value.period)&&Number.isSafeInteger(value.retryAt)&&value.retryAt>now&&value.retryAt<=now+7*86400000;}
/** Les limites du navigateur ne sont jamais importées depuis les compteurs serveur. */
export const browserWeatherQuota:WeatherQuotaStore={
 async read(provider){
  let value=memory.get(provider);
  try{const stored=JSON.parse(window.localStorage.getItem(KEY)??'{}')[provider];if(valid(stored)&&(!value||stored.retryAt>value.retryAt))value=stored;}catch{}
  if(valid(value))return value;memory.delete(provider);return null;
 },
 async write(provider,limit){
  if(!valid(limit))return;
  const previous=await this.read(provider);if(previous&&previous.retryAt>=limit.retryAt)return;
  memory.set(provider,limit);
  try{const rows=JSON.parse(window.localStorage.getItem(KEY)??'{}');const clean=Object.fromEntries((['forecast','single_runs'] as const).flatMap(key=>valid(rows[key])?[[key,rows[key]]]:[]));window.localStorage.setItem(KEY,JSON.stringify({...clean,[provider]:limit}));}catch{}
 },
};
export function quotaProvider(input:RequestInfo|URL):QuotaProvider|null{
 try{const url=new URL(typeof input==='string'?input:input instanceof URL?input.toString():input.url);if(url.protocol!=='https:')return null;
  if(url.hostname==='single-runs-api.open-meteo.com')return 'single_runs';
  return url.hostname==='api.open-meteo.com'&&url.pathname==='/v1/forecast'?'forecast':null;
 }catch{return null;}
}
export function defaultWeatherQuota(){return typeof window==='undefined'?undefined:browserWeatherQuota;}
export async function quotaResponse(provider:QuotaProvider,store:WeatherQuotaStore){
 const limit=await store.read(provider);if(!valid(limit))return null;
 return Response.json({error:true,reason:'Appel suspendu après un refus Open-Meteo.',retryAt:limit.retryAt},{status:429,headers:{'X-MeteoAI-Quota-Suspended':'1','Retry-After':String(Math.max(1,Math.ceil((limit.retryAt-Date.now())/1000)))}});
}
export async function recordQuotaResponse(response:Response,provider:QuotaProvider,store:WeatherQuotaStore){const limit=await readProviderRateLimit(response);if(limit)await store.write(provider,limit);}

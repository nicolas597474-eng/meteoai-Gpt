/** Cache local des seules prévisions publiques. Aucun compte, jeton ou relevé Netatmo. */
export const FORECAST_CACHE='meteoai-public-forecasts-v1';
export const MAX_FORECAST_AGE=48*3600000;
/** Traces complètes : AI Lab 6 Mo, Prévisions détaillées 8 Mo.
 * Le budget persistant total reste 16 Mo ; les autres entrées restent à 3 Mo. */
function entryByteLimit(key:string){
 try{const [name,,,extended]=JSON.parse(key);return name==='weather.getAILab'?6000000:name==='weather.getDetailedForecast'&&extended===true?8000000:3000000;}catch{return 3000000;}
}
export const offlineForecastStatus=new Map<string,{key:string;name:string;lat:number;lon:number;savedAt:number;reason:string}>();
type Entry={savedAt:number;checkedAt?:number;payload:any};
export type CachedForecast={entry:Entry;fromCache:boolean;reason:'network'|'fresh'|'refreshing'|'offline'|'unavailable'};
type Options={origin:string;storage?:CacheStorage;online:()=>boolean;now?:()=>number;onStatus?:(key:string,result:CachedForecast)=>void;onRefresh?:(key:string)=>void};
export class ForecastOfflineCache {
 private flights=new Map<string,Promise<Entry>>();
 private volatile=new Map<string,{entry:Entry;bytes:number}>();
 private now:()=>number;
 constructor(private options:Options){this.now=options.now??Date.now;}
 private request(key:string){return new Request(this.options.origin+'/__meteoai_forecast__/'+encodeURIComponent(key));}
 private async read(key:string):Promise<Entry|null>{
  // Une réponse reçue mais refusée par CacheStorage reste prioritaire dans
  // cette session. Relire l'ancien fichier après onRefresh créait une boucle.
  const recent=this.volatile.get(key);
  if(recent){if(recent.entry.savedAt<=this.now()+60000&&this.now()-recent.entry.savedAt<=MAX_FORECAST_AGE)return recent.entry;this.volatile.delete(key);}
  try{const cache=await this.options.storage?.open(FORECAST_CACHE),response=await cache?.match(this.request(key));if(!response)return null;
   const entry=await response.json();
   if(!Number.isFinite(entry.savedAt)||entry.savedAt>this.now()+60000||this.now()-entry.savedAt>MAX_FORECAST_AGE||!entry.payload){await cache?.delete(this.request(key));return null;}
   return entry;
  }catch{return null;}
 }
 private async write(key:string,entry:Entry){
  const text=JSON.stringify(entry),size=new TextEncoder().encode(text).byteLength;
  try{
   if(size>entryByteLimit(key))return {persisted:false,size};
   const cache=await this.options.storage?.open(FORECAST_CACHE);if(!cache)return {persisted:false,size};
   await cache.put(this.request(key),new Response(text,{headers:{'Content-Type':'application/json','X-MeteoAI-Saved-At':String(entry.savedAt),'X-MeteoAI-Bytes':String(size)}}));
   const keys=await cache.keys(),rows=await Promise.all(keys.map(async request=>{const response=await cache.match(request);return {request,at:Number(response?.headers.get('X-MeteoAI-Saved-At')??0),bytes:Number(response?.headers.get('X-MeteoAI-Bytes')??3000000)};}));
   rows.sort((a,b)=>b.at-a.at);let total=0;
   for(let i=0;i<rows.length;i++){total+=rows[i].bytes;if(i>=24||total>16000000)await cache.delete(rows[i].request);}
   return {persisted:true,size};
  }catch{return {persisted:false,size};}
 }
 private remember(key:string,entry:Entry,bytes:number){
  // Repli mémoire borné, sans conserver de compte ni augmenter le cache disque.
  if(bytes>16000000)throw new Error('Prévision trop volumineuse pour le cache de cet appareil.');
  this.volatile.delete(key);this.volatile.set(key,{entry,bytes});
  let total=Array.from(this.volatile.values()).reduce((sum,row)=>sum+row.bytes,0);
  while(this.volatile.size>4||total>16000000){const oldest=this.volatile.keys().next().value!;total-=this.volatile.get(oldest)!.bytes;this.volatile.delete(oldest);}
 }
 private refresh(key:string,loader:()=>Promise<Entry>){
  const existing=this.flights.get(key);if(existing)return existing;
  const pending=loader().then(async entry=>{
   if(!Number.isFinite(entry.savedAt)||entry.savedAt>this.now()+60000||this.now()-entry.savedAt>MAX_FORECAST_AGE)throw new Error('Prévision trop ancienne pour être conservée.');
   const checked={...entry,checkedAt:this.now()},stored=await this.write(key,checked);
   if(stored.persisted)this.volatile.delete(key);else this.remember(key,checked,stored.size);
   return checked;
  }).finally(()=>this.flights.delete(key));
  this.flights.set(key,pending);return pending;
 }
 async get(key:string,loader:()=>Promise<Entry>,forceRefresh=false):Promise<CachedForecast>{
  const previous=await this.read(key);
  const report=(result:CachedForecast)=>{this.options.onStatus?.(key,result);return result;};
  if(!this.options.online()){
   if(previous)return report({entry:previous,fromCache:true,reason:'offline'});
   throw new Error('Aucune prévision enregistrée pour ce lieu. Connectez-vous pour la télécharger.');
  }
  // Actualiser attend la relecture ; un échec conserve la dernière prévision hors ligne.
  if(forceRefresh){
   try{return report({entry:await this.refresh(key,loader),fromCache:false,reason:'network'});}
   catch(error){if(previous)return report({entry:previous,fromCache:true,reason:'unavailable'});throw error;}
  }
  if(previous){
   const checkedAt=Number.isFinite(previous.checkedAt)&&previous.checkedAt!<=this.now()?previous.checkedAt!:previous.savedAt;
   if(this.now()-checkedAt<60000)return report({entry:previous,fromCache:true,reason:'fresh'});
   // Réponse immédiate ; un seul rafraîchissement partagé par lieu et procédure.
   const alreadyRefreshing=this.flights.has(key);
   const pending=this.refresh(key,loader);
   if(!alreadyRefreshing)void pending.then(entry=>{report({entry,fromCache:false,reason:'network'});this.options.onRefresh?.(key);},()=>report({entry:previous,fromCache:true,reason:'unavailable'}));
   return report({entry:previous,fromCache:true,reason:'refreshing'});
  }
  return report({entry:await this.refresh(key,loader),fromCache:false,reason:'network'});
 }
}

/** Marquage explicite ; une ancienne température instantanée n'est jamais réaffichée. */
export function markCachedForecast(value:any,savedAt:number){
 return {...value,currentSnapshot:null,...(value.officialSnapshot?{officialSnapshot:{...value.officialSnapshot,snapshotStatus:'stale',staleReason:'saved_device_forecast'}}:{}),...(value.forecastComparison?{forecastComparison:{...value.forecastComparison,currentSnapshot:null},snapshotStatus:value.snapshotDate?'archived':'unavailable'}:{}),...(Array.isArray(value.models)?{stale:true}:{}),controlCache:{stale:true,cachedAt:new Date(savedAt).toISOString(),source:'device'}};
}

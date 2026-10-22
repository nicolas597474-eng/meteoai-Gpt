/** Public geographic metadata only: no account, weather or credentials. */
export const GEOGRAPHY_STORAGE_KEY = 'meteoai-public-geography-v1';
export const GEOGRAPHY_TTL_MS = 7 * 86_400_000;
export const EMPTY_SEARCH_TTL_MS = 15 * 60_000;
const MAX_ENTRIES = 48, MAX_BYTES = 160_000, MAX_ENTRY_BYTES = 16_000;
export type PublicPlace = {name:string;latitude:number;longitude:number;admin1?:string;country?:string;population?:number};
export type ReferenceElevation = {value:number;source:string;retrievedAt:string};
type Value = {kind:'search';places:PublicPlace[]} | {kind:'elevation';elevation:ReferenceElevation};
type Entry = {key:string;at:number;value:Value};
type Options = {storage?:()=>Pick<Storage,'getItem'|'setItem'>|undefined;now?:()=>number;fetcher?:typeof fetch};
const coordinatesValid = (lat:number,lon:number)=>Number.isFinite(lat)&&Number.isFinite(lon)&&Math.abs(lat)<=90&&Math.abs(lon)<=180;
const text = (value:unknown):value is string=>typeof value==='string'&&value.length<=256;
function placeValid(value:any):value is PublicPlace {
 return value && text(value.name) && value.name.length>0 && coordinatesValid(value.latitude,value.longitude)
  && (value.admin1===undefined||text(value.admin1)) && (value.country===undefined||text(value.country))
  && (value.population===undefined||(Number.isFinite(value.population)&&value.population>=0));
}
function elevationValid(value:any):value is ReferenceElevation {
 return value && Number.isFinite(value.value)&&value.value>=-500&&value.value<=9000
  && value.source==='Open-Meteo / Copernicus DEM GLO-90'&&Number.isFinite(Date.parse(value.retrievedAt));
}
function entryValid(row:any,now:number):row is Entry {
 if(!row||!text(row.key)||!Number.isFinite(row.at)||row.at>now||!row.value)return false;
 const value=row.value;
 if(value.kind==='search')return /^search:(6|10):.{2,120}$/.test(row.key)&&Array.isArray(value.places)&&value.places.length<=10
  && value.places.every(placeValid)&&now-row.at<(value.places.length?GEOGRAPHY_TTL_MS:EMPTY_SEARCH_TTL_MS);
 if(value.kind==='elevation')return row.key.startsWith('elevation:')&&elevationValid(value.elevation)
  && Date.parse(value.elevation.retrievedAt)===row.at&&now-row.at<GEOGRAPHY_TTL_MS;
 return false;
}
const copy = <T>(value:T):T=>JSON.parse(JSON.stringify(value));
function waitFor<T>(task:Promise<T>,signal?:AbortSignal):Promise<T> {
 if(!signal)return task.then(copy);
 if(signal.aborted)return Promise.reject(signal.reason??new DOMException('Annulé','AbortError'));
 return new Promise((resolve,reject)=>{
  const abort=()=>{cleanup();reject(signal.reason??new DOMException('Annulé','AbortError'));};
  const cleanup=()=>signal.removeEventListener('abort',abort);
  signal.addEventListener('abort',abort,{once:true});
  task.then(value=>{cleanup();resolve(copy(value));},error=>{cleanup();reject(error);});
 });
}
export class PublicGeography {
 private entries=new Map<string,Entry>();
 private flights=new Map<string,Promise<Value>>();
 private loaded=false;
 private now:()=>number;
 constructor(private options:Options={}){this.now=options.now??Date.now;}
 private trim(){
  for(const [key,row] of this.entries)if(!entryValid(row,this.now()))this.entries.delete(key);
  let bytes=Array.from(this.entries.values()).reduce((sum,row)=>sum+JSON.stringify(row).length*2,0);
  while(this.entries.size>MAX_ENTRIES||bytes>MAX_BYTES){const key=this.entries.keys().next().value!;bytes-=JSON.stringify(this.entries.get(key)).length*2;this.entries.delete(key);}
 }
 private load(){
  if(this.loaded)return;this.loaded=true;
  try{
   const saved=this.options.storage?.()?.getItem(GEOGRAPHY_STORAGE_KEY);
   if(!saved||saved.length*2>MAX_BYTES)return;
   const rows=JSON.parse(saved);
   if(Array.isArray(rows))for(const row of rows)if(entryValid(row,this.now())&&JSON.stringify(row).length*2<=MAX_ENTRY_BYTES)this.entries.set(row.key,row);
  }catch{/* Storage is optional, including private browsing. */}
  this.trim();
 }
 private save(){try{this.options.storage?.()?.setItem(GEOGRAPHY_STORAGE_KEY,JSON.stringify(Array.from(this.entries.values())));}catch{}}
 private async read(key:string,loader:()=>Promise<Value>,signal?:AbortSignal):Promise<Value>{
  if(signal?.aborted)throw signal.reason??new DOMException('Annulé','AbortError');
  this.load();this.trim();
  const cached=this.entries.get(key);
  if(cached)return copy(cached.value);
  let task=this.flights.get(key);
  if(!task){
   task=loader().then(value=>{
    const row={key,at:value.kind==='elevation'?Date.parse(value.elevation.retrievedAt):this.now(),value};
    if(entryValid(row,this.now())&&JSON.stringify(row).length*2<=MAX_ENTRY_BYTES){this.entries.set(key,copy(row));this.trim();this.save();}
    return value;
   });
   this.flights.set(key,task);
   void task.then(()=>{},()=>{}).finally(()=>{if(this.flights.get(key)===task)this.flights.delete(key);});
  }
  return waitFor(task,signal);
 }
 async search(name:string,count:6|10=6,signal?:AbortSignal):Promise<PublicPlace[]>{
  const query=name.trim().replace(/\s+/g,' ').toLocaleLowerCase('fr');
  if(query.length<2)return [];
  if(query.length>120)throw Error('Nom de lieu trop long.');
  const value=await this.read(`search:${count}:${query}`,async()=>{
   const url=new URL('https://geocoding-api.open-meteo.com/v1/search');
   url.search=new URLSearchParams({name:query,count:String(count),language:'fr',format:'json'}).toString();
   const response=await (this.options.fetcher??fetch)(url,{signal:AbortSignal.timeout(6000),credentials:'omit'});
   if(!response.ok)throw Error('Recherche indisponible.');
   const data=await response.json();
   if(data?.error||!data||typeof data!=='object'||(data.results!==undefined&&!Array.isArray(data.results)))throw Error('Réponse géographique invalide.');
   const places:PublicPlace[]=(data.results??[]).slice(0,count).map((row:any)=>({name:row.name,latitude:row.latitude,longitude:row.longitude,
    ...(row.admin1!=null?{admin1:row.admin1}:{}),...(row.country!=null?{country:row.country}:{}),...(row.population!=null?{population:row.population}:{})}));
   if(!places.every(placeValid))throw Error('Lieux reçus invalides.');
   return {kind:'search',places};
  },signal);
  if(value.kind!=='search')throw Error('Cache géographique invalide.');
  return value.places;
 }
 async elevation(lat:number,lon:number):Promise<ReferenceElevation|null>{
  if(!coordinatesValid(lat,lon))return null;
  try{
   const value=await this.read(`elevation:${lat},${lon}`,async()=>{
    const url=new URL('https://api.open-meteo.com/v1/elevation');url.search=new URLSearchParams({latitude:String(lat),longitude:String(lon)}).toString();
    const response=await (this.options.fetcher??fetch)(url,{signal:AbortSignal.timeout(6000),credentials:'omit'});
    if(!response.ok)throw Error('Altitude indisponible.');
    const data=await response.json(),elevation={value:data?.elevation?.[0],source:'Open-Meteo / Copernicus DEM GLO-90',retrievedAt:new Date(this.now()).toISOString()};
    if(data?.error||!elevationValid(elevation))throw Error('Altitude invalide.');
    return {kind:'elevation',elevation};
   });
   return value.kind==='elevation'?value.elevation:null;
  }catch{return null;}
 }
}
export const publicGeography=new PublicGeography({storage:()=>typeof localStorage==='undefined'?undefined:localStorage});

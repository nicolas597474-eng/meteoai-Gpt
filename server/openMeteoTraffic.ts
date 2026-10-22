import {validTrafficBucket,emptyTrafficCounts,type TrafficBucket,type TrafficCategory} from '../shared/openMeteoTraffic';
const buckets=new Map<string,TrafficBucket>(),STORAGE_KEY='meteoai-open-meteo-traffic-v1';
let loaded=false;
let instanceId:string|undefined;
export function getTrafficInstanceId(){return instanceId??=crypto.randomUUID();}
function load(){
 if(loaded)return;loaded=true;
 if(typeof window==='undefined')return;
 try{const value=JSON.parse(localStorage.getItem(STORAGE_KEY)??'[]');if(Array.isArray(value))for(const row of value.slice(-48))if(validTrafficBucket(row))buckets.set(row.hour,row);}catch{/* Storage is optional; current-session counters remain available. */}
}
function categoryFor(input:RequestInfo|URL):TrafficCategory|null{
 try{
  const url=new URL(typeof input==='string'?input:input instanceof URL?input.toString():input.url);
  if(url.protocol!=='https:'||!/(^|\.)open-meteo\.com$/.test(url.hostname))return null;
  if(url.pathname.startsWith('/data/'))return 'metadata';
  if(url.hostname.includes('single-runs'))return 'single_runs';
  if(url.hostname.includes('air-quality'))return 'air_quality';
  if(url.searchParams.has('daily'))return 'daily';
  if(url.searchParams.has('hourly'))return 'hourly';
  if(url.searchParams.has('current'))return 'current';
  return 'other';
 }catch{return null;}
}
export function observeOpenMeteo(input:RequestInfo|URL,kind:'network'|'cache'|'shared',status:number|null=null,retry=false,now=Date.now()){
 const category=categoryFor(input);if(!category)return;
 load();const hour=new Date(Math.floor(now/3600000)*3600000).toISOString(),at=new Date(now).toISOString();
 const bucket=buckets.get(hour)??{hour,firstObservedAt:at,lastObservedAt:at,revision:0,categories:{}};
 const counts=bucket.categories[category]??=emptyTrafficCounts();
 if(kind==='network'){counts.requests++;if(retry)counts.retries++;if(status===null)counts.networkErrors++;else if(status>=200&&status<300)counts.success++;else{counts.httpErrors++;if(status===429)counts.rateLimited++;}}
 else if(kind==='cache')counts.cacheHits++;else counts.shared++;
 bucket.revision++;bucket.lastObservedAt=at;buckets.set(hour,bucket);
 for(const key of buckets.keys())if(Date.parse(key)<Date.parse(hour)-47*3600000||Date.parse(key)>Date.parse(hour))buckets.delete(key);
 if(typeof window!=='undefined')try{localStorage.setItem(STORAGE_KEY,JSON.stringify(Array.from(buckets.values())));}catch{}
}
export function getOpenMeteoTrafficBuckets():TrafficBucket[]{load();return structuredClone(Array.from(buckets.values()));}
export function resetOpenMeteoTraffic(){buckets.clear();loaded=true;}

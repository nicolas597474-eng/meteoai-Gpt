/** Technical attempts only. No URL, coordinates, payload, IP or credential is retained. */
export const TRAFFIC_CATEGORIES = ['daily','hourly','current','single_runs','metadata','air_quality','other'] as const;
export type TrafficCategory = typeof TRAFFIC_CATEGORIES[number];
export const TRAFFIC_COUNTERS = ['requests','success','httpErrors','rateLimited','networkErrors','retries','cacheHits','shared'] as const;
export type TrafficCounts = Record<typeof TRAFFIC_COUNTERS[number],number>;
export type TrafficBucket = {hour:string;firstObservedAt:string;lastObservedAt:string;revision:number;categories:Partial<Record<TrafficCategory,TrafficCounts>>};
export const emptyTrafficCounts = ():TrafficCounts => Object.fromEntries(TRAFFIC_COUNTERS.map(key=>[key,0])) as TrafficCounts;
export function validTrafficBucket(value:any):value is TrafficBucket {
 if(!value||!/^\d{4}-\d{2}-\d{2}T\d{2}:00:00\.000Z$/.test(value.hour)||!Number.isFinite(Date.parse(value.hour))||!Number.isSafeInteger(value.revision)||value.revision<1||!Number.isFinite(Date.parse(value.firstObservedAt))||!Number.isFinite(Date.parse(value.lastObservedAt)))return false;
 const start=Date.parse(value.hour);
 if(Date.parse(value.firstObservedAt)<start||Date.parse(value.lastObservedAt)>=start+3600000||value.firstObservedAt>value.lastObservedAt||!value.categories||typeof value.categories!=='object')return false;
 return Object.entries(value.categories).every(([key,counts]:[string,any])=>TRAFFIC_CATEGORIES.includes(key as TrafficCategory)&&counts&&TRAFFIC_COUNTERS.every(k=>Number.isSafeInteger(counts[k])&&counts[k]>=0)&&counts.success+counts.httpErrors+counts.networkErrors===counts.requests&&counts.rateLimited<=counts.httpErrors&&counts.retries<=counts.requests);
}
export function summarizeTraffic(buckets:TrafficBucket[],hours:24|48,now=Date.now()){
 const cutoff=Math.floor(now/3600000)*3600000-(hours-1)*3600000;
 const totals=emptyTrafficCounts(),categories:Partial<Record<TrafficCategory,TrafficCounts>>={};
 let first=Infinity,last=-Infinity;
 for(const bucket of buckets){
  if(!validTrafficBucket(bucket)||Date.parse(bucket.hour)<cutoff||Date.parse(bucket.hour)>now)continue;
  first=Math.min(first,Date.parse(bucket.firstObservedAt));
  last=Math.max(last,Date.parse(bucket.lastObservedAt));
  for(const [key,value] of Object.entries(bucket.categories)){
   const target=categories[key as TrafficCategory]??=emptyTrafficCounts();
   for(const counter of TRAFFIC_COUNTERS){target[counter]+=value[counter];totals[counter]+=value[counter];}
  }
 }
 return {totals,categories,firstObservedAt:Number.isFinite(first)?new Date(first).toISOString():null,lastObservedAt:Number.isFinite(last)?new Date(last).toISOString():null};
}

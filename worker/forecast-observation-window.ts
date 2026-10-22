import {verifyForecastArchive} from './forecast-integrity';
import type {VerifiedObservation} from './observation-integrity';
const HOUR=3600000;

/** Recherche bornée par heure physique réelle, au lieu des seules captures les plus récentes. */
export async function readForecastsBeforeObservedHours(env:any,rows:VerifiedObservation[],now=Date.now()){
 const hours=Array.from(new Set(rows.filter(row=>!row.flags.length&&row.measuredAt<=now).map(row=>Math.floor(row.measuredAt/HOUR)*HOUR))).filter(slot=>slot+HOUR<=now).sort((a,b)=>b-a);
 const sought=hours.slice(0,8);
 const results=await Promise.all(sought.map(slot=>env.DB.prepare('SELECT id,location_key,captured_at,received_at,origin,model_count,forecast_count,object_key,digest FROM weather_captures WHERE location_key=? AND received_at<? AND received_at>=? ORDER BY received_at DESC,id DESC LIMIT 1').bind('50.757_2.520',new Date(slot).toISOString(),new Date(slot-72*HOUR).toISOString()).all()));
 const candidates=new Map<string,any>();let unmatchedHours=0;
 for(const result of results){
  if(!Array.isArray(result?.results)||result.results.length>1)throw Error('Lecture des prévisions indisponible');
  if(!result.results.length)unmatchedHours++;
  for(const row of result.results)candidates.set(row.id,row);
 }
 const captures:{id:string;receivedAt:number;payload:any}[]=[];let rejectedArchives=0;
 for(const row of Array.from(candidates.values())){
  try{const verified=await verifyForecastArchive(row,env,now);captures.push({id:row.id,receivedAt:Date.parse(verified.receivedAt),payload:verified.payload});}
  catch{rejectedArchives++;}
 }
 return {captures,checkedArchives:candidates.size,rejectedArchives,observedHours:hours.length,searchedHours:sought.length,unmatchedHours,boundedRead:hours.length>8};
}

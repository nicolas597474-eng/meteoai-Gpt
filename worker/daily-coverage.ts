import type {VerifiedObservation} from './observation-integrity';
import {buildPhysicalReferences} from './physical-references';
import {getParisDateAndHour,parisLocalHourToUniqueEpochMs} from '../server/parisHourlyTime';
import {buildQualifiedDailyObservation} from '../server/physicalObservationAggregation';
import type {PhysicalCoverageDay} from '../shared/dailyPhysicalEvidence';
const HOUR=3600000;
/** Une heure finie et non ambiguë n'est comptée qu'une fois, dans sa date de Paris. */
export function buildDailyPhysicalCoverage(rows:VerifiedObservation[],now=Date.now(),source:'netatmo_browser_bridge'|'netatmo_server'='netatmo_browser_bridge'):PhysicalCoverageDay[]{
 const today=getParisDateAndHour(now)?.date;
 const dates=new Map<string,{measured:Set<number>;pending:Set<number>;ambiguous:Set<number>}>();
 const slotCache=new Map<number,{local:NonNullable<ReturnType<typeof getParisDateAndHour>>;unique:boolean}|null>();
 const unambiguousHours=new Set<string>();
 for(const row of rows){
  if(!Number.isSafeInteger(row.measuredAt)||row.measuredAt>now)continue;
  const slot=Math.floor(row.measuredAt/HOUR)*HOUR;
  if(!slotCache.has(slot)){const local=getParisDateAndHour(slot);slotCache.set(slot,local?{local,unique:parisLocalHourToUniqueEpochMs(local.date,local.hour)===slot}:null);}
  const cached=slotCache.get(slot);if(!cached)continue;const {local}=cached;
  const group=dates.get(local.date)??{measured:new Set<number>(),pending:new Set<number>(),ambiguous:new Set<number>()};
  if(!cached.unique)group.ambiguous.add(slot);
  else if(slot+HOUR>now)group.pending.add(local.hour);
  else {group.measured.add(local.hour);unambiguousHours.add(local.date+'|'+local.hour);}
  dates.set(local.date,group);
 }
 const observations=rows.map(row=>({station_key:row.stationKey,measured_at:row.measuredAt,received_at:row.receivedAt,temperature:row.temperature,source,quality_flags:JSON.stringify(row.flags),distance:row.distance,elevation:row.elevation}));
 const {snapshots}=buildPhysicalReferences(observations,now,source);
 return Array.from(dates).sort(([a],[b])=>b.localeCompare(a)).map(([date,group])=>{
  const unique=new Map<number,typeof snapshots[number]>();
  for(const snapshot of snapshots){
   if(snapshot.date!==date||!unambiguousHours.has(date+'|'+snapshot.hour))continue;
   unique.set(snapshot.hour,snapshot);
  }
  const values=Array.from(unique.values());
  const aggregation=buildQualifiedDailyObservation(values.map(snapshot=>({...snapshot,windGust:null})));
  return {date,measuredHours:group.measured.size,usableHours:aggregation.coverageHours,hours:Array.from(unique.keys()).sort((a,b)=>a-b),pendingHours:group.pending.size,ambiguousHours:group.ambiguous.size,closedDay:!!today&&date<today,thresholdMet:aggregation.isQualified};
 });
}


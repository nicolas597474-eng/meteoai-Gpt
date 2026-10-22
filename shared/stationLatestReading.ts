const fields=['temperature','humidity','pressure','windSpeed','windGust','precipitation'] as const;
const epoch=(v:unknown)=>typeof v==='number'?v:typeof v==='string'?Date.parse(v):v instanceof Date?v.getTime():NaN;
const number=(v:unknown)=>typeof v==='number'&&Number.isFinite(v)?v:null;
type Reading=Record<(typeof fields)[number],number|null>;
type Candidate={reading:Reading;measuredAt:number;kind:'archive'|'live'};
/** Choisit un relevé entier, avec son propre horodatage. Aucun champ d'une
 * ancienne archive n'est greffé sur une mesure directe plus récente. */
export function stationLatestReading(station:any,live:any,now=Date.now()){
 const candidate=(raw:any,time:unknown,kind:Candidate['kind']):Candidate|null=>{
  const measuredAt=epoch(time);
  if(!raw||!Number.isFinite(measuredAt)||measuredAt>now)return null;
  const reading=Object.fromEntries(fields.map(field=>[field,number(raw[field])])) as Reading;
  return Object.values(reading).some(v=>v!==null)?{reading,measuredAt,kind}:null;
 };
 const archived=candidate(station?.latest,station?.latest?.observedAt,'archive');
 const sameStation=typeof station?.stationId==='string'&&live?.stationId===station.stationId;
 const liveTime=live?.measurementTimes&&Object.hasOwn(live.measurementTimes,'temperature')?live.measurementTimes.temperature:live?.updatedAt;
 const direct=sameStation&&live.isActive!==false?candidate(live,liveTime,'live'):null;
 const conflict=!!(archived&&direct&&archived.measuredAt===direct.measuredAt&&fields.some(f=>archived.reading[f]!==null&&direct.reading[f]!==null&&archived.reading[f]!==direct.reading[f]));
 const selected=direct&&(!archived||direct.measuredAt>archived.measuredAt)?direct:archived;
 return {reading:selected?.reading??null,measuredAt:selected?.measuredAt??null,kind:selected?.kind??null,ageMinutes:selected?Math.max(0,Math.round((now-selected.measuredAt)/60000)):null,conflict};
}

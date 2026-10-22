import {buildAuxiliaryReferences} from './physical-auxiliary-references';
import {evaluateSpatialQuality,buildNormalizedSpatialWeights} from '../server/spatialFusionCore';
import type {HourlyPhysicalSnapshot} from '../server/hourlyForecastRunScoring';
import {getParisDateAndHour} from '../server/parisHourlyTime';
const LOCATION='50.757_2.520',HOUR=3600000;
/** Références exploratoires communes aux comparaisons et à la couverture quotidienne. */
export function buildPhysicalReferences(observations:any[],now=Date.now(),source:'netatmo_browser_bridge'|'netatmo_server'='netatmo_browser_bridge',includeAuxiliary=false){
 const groups=new Map<number,Map<string,any>>();let pendingHours=new Set<number>(),excluded=0;
 for(const o of observations){
  if(o.source!==source||!Number.isFinite(o.measured_at)||o.measured_at>now||o.quality_flags!=='[]'){excluded++;continue;}
  const slot=Math.floor(o.measured_at/HOUR)*HOUR;
  // Pas de score sur un créneau encore en cours ; jamais de mesure future.
  if(slot+HOUR>now){pendingHours.add(slot);continue;}
  const group=groups.get(slot)??new Map<string,any>(),prior=group.get(o.station_key);
  if(!prior||prior.measured_at<o.measured_at)group.set(o.station_key,o);groups.set(slot,group);
 }
 const snapshots:HourlyPhysicalSnapshot[]=[],references:any[]=[];
 for(const [slot,stations] of Array.from(groups)){
  const hasHumidity=Array.from(stations.values()).some(o=>Object.hasOwn(o,'humidity'));
  const sources=Array.from(stations.values()).map(o=>({id:o.station_key,distanceKm:o.distance,updatedAt:new Date(o.measured_at),altitude:o.elevation,temperature:o.temperature,humidity:o.humidity}));
  const checked=evaluateSpatialQuality(sources,{now:slot+HOUR,maxDistanceKm:20,maxFreshnessMin:90,minReliabilityScore:35,maxTempDeviationC:6,refAltitude:null});
  const passed=checked.filter(r=>r.passed).map(r=>r.source);excluded+=checked.length-passed.length;
  if(passed.length<3)continue;
  const weighted=buildNormalizedSpatialWeights(passed,{now:slot+HOUR,refAltitude:null}).filter(r=>r.finalWeight>0);
  if(weighted.length<3)continue;
  const temperature=weighted.reduce((sum,r)=>sum+r.adjustedTemperature!*r.finalWeight,0),local=getParisDateAndHour(slot);
  if(!local)continue;
  // Même contrôle spatial et même instant source ; poids renormalisés sur les seuls capteurs d'humidité valides.
  const humiditySources=weighted.filter(r=>typeof r.source.humidity==='number'&&Number.isFinite(r.source.humidity)&&r.source.humidity>=0&&r.source.humidity<=100);
  const humidityTotal=humiditySources.reduce((sum,r)=>sum+r.finalWeight,0);
  const humidityWeights=new Map(humiditySources.length>=3&&humidityTotal>0?humiditySources.map(r=>[r.source.id,r.finalWeight/humidityTotal]):[]);
  const humidity=humidityWeights.size?Math.max(0,Math.min(100,humiditySources.reduce((sum,r)=>sum+r.source.humidity!*humidityWeights.get(r.source.id)!,0))):null;
  const first=Math.min(...weighted.map(r=>r.source.updatedAt.getTime())),last=Math.max(...weighted.map(r=>r.source.updatedAt.getTime()));
  const hasAuxiliary=includeAuxiliary&&Array.from(stations.values()).some(r=>r.auxiliary&&Object.keys(r.auxiliary).length>0);
  snapshots.push({...(hasAuxiliary?{auxiliaryReferences:buildAuxiliaryReferences(stations,weighted,slot)}:{}),locationKey:LOCATION,date:local.date,hour:local.hour,stationCount:weighted.length,temperature,precipitation:null,windSpeed:null,...(hasHumidity?{humidity,humidityStationCount:humidityWeights.size}:{}),collectedAt:Math.max(...Array.from(stations.values()).map(o=>o.received_at)),confidenceScore:null,stationsUsed:weighted.map(r=>({stationId:r.source.id,observedAt:r.source.updatedAt.toISOString(),...(hasHumidity?{humidity:typeof r.source.humidity==='number'&&Number.isFinite(r.source.humidity)&&r.source.humidity>=0&&r.source.humidity<=100?r.source.humidity:null}:{}),fieldWeights:{temperature:r.finalWeight,...(humidityWeights.has(r.source.id)?{humidity:humidityWeights.get(r.source.id)}:{})},measurementTimes:{temperature:r.source.updatedAt.toISOString(),...(humidityWeights.has(r.source.id)?{humidity:r.source.updatedAt.toISOString()}:{})}}))});
  references.push({validTime:slot,firstMeasuredAt:first,lastMeasuredAt:last,stations:weighted.length,temperature});
 }
 return {snapshots,references,pendingHours,excluded};
}

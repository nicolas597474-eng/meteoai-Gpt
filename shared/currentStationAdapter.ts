import type {StationData} from '../server/stationService';
import {haversineKm} from '../worker/station-kind';
import {NETATMO_BRIDGE_DEFAULTS} from './currentStationPolicy';

/** Aucune variable absente du pont Netatmo n'est déduite de la température. */
export function mapBridgeStations(rows:any[],lat:number,lon:number,radiusKm=20):StationData[]{
 return rows.flatMap(s=>{
  if(typeof s.id!=='string'||!s.id.startsWith('netatmo-')||typeof s.name!=='string'||![s.lat,s.lon,s.temp,s.time].every(Number.isFinite)||Math.abs(s.lat)>90||Math.abs(s.lon)>180||s.temp< -45||s.temp>55)return [];
  const distanceKm=haversineKm(lat,lon,s.lat,s.lon);if(distanceKm>radiusKm)return [];
  const date=new Date(s.time);if(!Number.isFinite(date.getTime()))return [];
  const at=date.toISOString();
  const humidity=typeof s.humidity==='number'&&Number.isFinite(s.humidity)&&s.humidity>=0&&s.humidity<=100?s.humidity:null;
  const measurementTimes:NonNullable<StationData['measurementTimes']>={temperature:at,...(humidity!==null?{humidity:at}:{})};
  const ranges={pressure:[300,1200],windSpeed:[0,300],windGust:[0,400],windDirection:[0,360],precipitation:[0,500]} as const;
  const auxiliary=Object.fromEntries(Object.entries(ranges).map(([key,[min,max]])=>{
   const field=key as keyof typeof ranges,v=s[field],time=s.measurementTimes?.[field];
   const valid=typeof v==='number'&&Number.isFinite(v)&&v>=min&&v<=max&&typeof time==='number'&&Number.isFinite(time)&&time>0&&time<=Date.now()&&Number.isFinite(new Date(time).getTime())&&(field!=='precipitation'||s.precipitationPeriodMinutes===60);
   if(valid)measurementTimes[field]=new Date(time).toISOString();
   return [field,valid?v:null];
  })) as Pick<StationData,keyof typeof ranges>;
  return [{stationId:s.id,source:'netatmo' as const,name:s.name,lat:s.lat,lon:s.lon,altitude:Number.isFinite(s.elevation)?s.elevation:null,distanceKm,temperature:s.temp,humidity,...auxiliary,updatedAt:at,measurementTimes,
   // Priorité technique fixe du mapper Netatmo original, pas un score MAE.
   ...NETATMO_BRIDGE_DEFAULTS,isActive:s.anomaly===false}];
 });
}

/** Horizon géométrique échantillonné dans un DEM, sans exagération verticale. */
export const TERRAIN_DISTANCES_KM=[.1,.25,.5,1,2,5,10,20,35,50] as const;
export const TERRAIN_AZIMUTH_STEP_DEG=10;
export const TERRAIN_OBSERVER_HEIGHT_M=1.7;
const EARTH_RADIUS_M=6371008.8;
export type TerrainSample={lat:number;lon:number;azimuthDeg:number;distanceKm:number};
export function terrainSamples(coords:{lat:number;lon:number}):TerrainSample[]{
 if(!Number.isFinite(coords.lat)||Math.abs(coords.lat)>90||!Number.isFinite(coords.lon)||Math.abs(coords.lon)>180)throw new Error('Coordonnées de relief invalides.');
 const lat=coords.lat*Math.PI/180,lon=coords.lon*Math.PI/180,points:TerrainSample[]=[];
 for(let azimuthDeg=0;azimuthDeg<360;azimuthDeg+=TERRAIN_AZIMUTH_STEP_DEG){
  const bearing=azimuthDeg*Math.PI/180;
  for(const distanceKm of TERRAIN_DISTANCES_KM){
   const angle=distanceKm*1000/EARTH_RADIUS_M;
   const targetLat=Math.asin(Math.sin(lat)*Math.cos(angle)+Math.cos(lat)*Math.sin(angle)*Math.cos(bearing));
   const targetLon=lon+Math.atan2(Math.sin(bearing)*Math.sin(angle)*Math.cos(lat),Math.cos(angle)-Math.sin(lat)*Math.sin(targetLat));
   points.push({lat:targetLat*180/Math.PI,lon:((targetLon*180/Math.PI+540)%360)-180,azimuthDeg,distanceKm});
  }
 }
 return points;
}
export function terrainHorizon(samples:readonly TerrainSample[],elevations:readonly number[],observerElevationM:number){
 if(samples.length!==elevations.length||!Number.isFinite(observerElevationM)||!elevations.every(Number.isFinite))throw new Error('Profil de relief incomplet.');
 const horizon=new Map<number,{azimuthDeg:number;elevationDeg:number;distanceKm:number}>();
 samples.forEach((sample,index)=>{
  const distanceM=sample.distanceKm*1000;
  const curvatureDrop=distanceM*distanceM/(2*EARTH_RADIUS_M);
  const elevationDeg=Math.atan2(elevations[index]-observerElevationM-TERRAIN_OBSERVER_HEIGHT_M-curvatureDrop,distanceM)*180/Math.PI;
  const previous=horizon.get(sample.azimuthDeg);
  if(!previous||elevationDeg>previous.elevationDeg)horizon.set(sample.azimuthDeg,{azimuthDeg:sample.azimuthDeg,elevationDeg,distanceKm:sample.distanceKm});
 });
 return [...horizon.values()].sort((a,b)=>a.azimuthDeg-b.azimuthDeg);
}

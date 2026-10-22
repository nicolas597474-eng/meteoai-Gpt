/** Physical stations actually retained by the synthesis, within its 30 km maximum. */
export function usedLocalStations(stations:readonly any[]){
 return stations.filter(s=>s.isUsed&&s.sourceKind==='physical'&&typeof s.distanceKm==='number'&&Number.isFinite(s.distanceKm)&&s.distanceKm>=0&&s.distanceKm<=30);
}
/** Même liste et mêmes contributions pour le compteur et la carte.
 * La fraîcheur vient du relevé, jamais de l'heure du rafraîchissement. */
export function currentStationPresentation(data:any,now=Date.now(),overview?:any){
 const used=new Set<string>((data?.groundTruth?.stationsUsed??[]).map((r:any)=>r.stationId));
 const ignored=new Map<string,string>((data?.groundTruth?.stationsIgnored??[]).map((r:any)=>[r.stationId,r.reason]));
 // Les compteurs d'archives ne viennent jamais de la liste de relevés directs.
 const compatible=overview?.archiveStatus?.status==='verified'&&!overview.archiveStatus.boundedRead&&!overview.archiveStatus.rejectedArchives
  &&overview.center?.lat===data?.lat&&overview.center?.lon===data?.lon&&overview.radiusKm===data?.radiusKm;
 const archiveCounts=new Map<string,number>(compatible?(overview.stations??[]).filter((s:any)=>Array.isArray(s.readings)).map((s:any)=>[s.stationId,s.readings.length]):[]);
 const stations=(data?.stations??[]).map((s:any)=>{
  const measuredAt=Date.parse(s.updatedAt??'');
  const validTime=Number.isFinite(measuredAt)&&measuredAt<=now;
  return {...s,isUsed:!!(s.isActive&&used.has(s.stationId)&&validTime),exclusionReason:s.exclusionReason??ignored.get(s.stationId)??null,ageMinutes:validTime?Math.round((now-measuredAt)/60000):null,archivedReadingCount:archiveCounts.get(s.stationId)??null,latest:{temperature:s.temperature,humidity:s.humidity,pressure:s.pressure,windSpeed:s.windSpeed,windGust:s.windGust,precipitation:s.precipitation}};
 });
 const times=stations.filter((s:any)=>s.isUsed).map((s:any)=>Date.parse(s.updatedAt)).filter((t:number)=>Number.isFinite(t)&&t<=now);
 return {stations,usedCount:stations.filter((s:any)=>s.isUsed).length,lastMeasurementAt:times.length?Math.max(...times):null};
}

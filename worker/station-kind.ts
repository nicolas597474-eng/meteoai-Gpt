// Fonction pure extraite à l'identique de stationService.ts pour éviter
// d'embarquer les collecteurs de stations non encore migrés.
import type {StationData} from '../server/stationService';
export const PHYSICAL_STATION_SOURCES: ReadonlySet<string> = new Set(["meteofrance", "netatmo"]);
export function getStationSourceKind(source: string, stationId?: string): "physical" | "reference" {
 if (source === "netatmo" && stationId && !stationId.startsWith("netatmo-")) return "reference";
 return PHYSICAL_STATION_SOURCES.has(source) ? "physical" : "reference";
}
export function getPhysicalActiveStations(stations:StationData[]):StationData[]{
 return stations.filter(station=>station.isActive&&getStationSourceKind(station.source,station.stationId)==='physical');
}
export function haversineKm(lat1:number,lon1:number,lat2:number,lon2:number):number{
 const R=6371,dLat=((lat2-lat1)*Math.PI)/180,dLon=((lon2-lon1)*Math.PI)/180;
 const a=Math.sin(dLat/2)**2+Math.cos((lat1*Math.PI)/180)*Math.cos((lat2*Math.PI)/180)*Math.sin(dLon/2)**2;
 return R*2*Math.atan2(Math.sqrt(a),Math.sqrt(1-a));
}

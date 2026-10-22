import {mapBridgeStations} from './currentStationAdapter';
import {calculateUltraLocal} from '../server/ultraLocalService';
import {getStationMeasurementAgeStates} from '../server/stationMeasurementFreshness';
import {getStationRankingScore} from '../server/stationRankingScore';
import {STATION_DIRECTORY_MAX_AGE_MINUTES} from './currentStationPolicy';

export function stationSearchInput(input:any){
 const lat=input?.lat??50.7567,lon=input?.lon??2.5204,radiusKm=input?.radiusKm??50;
 if(!Number.isFinite(lat)||!Number.isFinite(lon)||Math.abs(lat)>85||Math.abs(lon)>180)throw Error('Coordonnées invalides.');
 if(!Number.isFinite(radiusKm)||radiusKm<1||radiusKm>50)throw Error('Rayon de recherche invalide.');
 return {lat,lon,radiusKm};
}
export type StationSearchCollection={rows:unknown[];fetchedAt?:string|null;fromCache?:boolean;errorCode?:string|null};
/** Projection des seules stations physiques Netatmo. Ni modèle de remplacement,
 * ni écriture d’historique, ni nouvelle preuve de calibration. */
export function buildStationSearchReadModel(coords:ReturnType<typeof stationSearchInput>,collection:StationSearchCollection){
 const now=Date.now(),{lat,lon,radiusKm}=coords;
 const error=collection.errorCode??null;
 const notConnected=!!error&&['NETATMO_SIGN_IN','NETATMO_NOT_CONFIGURED','NETATMO_NOT_CONNECTED','NETATMO_RECONNECT_REQUIRED'].includes(error);
 const unique=new Map<string,ReturnType<typeof mapBridgeStations>[number]>();
 for(const station of mapBridgeStations(error?[]:collection.rows,lat,lon,radiusKm)){
  if(!unique.has(station.stationId)||Date.parse(station.updatedAt!)>Date.parse(unique.get(station.stationId)!.updatedAt!))unique.set(station.stationId,station);
 }
 const ranked=Array.from(unique.values()).map(station=>{
  const age=now-Date.parse(station.updatedAt!);
  const reason=!station.isActive?'Mesure signalée par les contrôles Netatmo':age<0?'Horodatage futur':age>STATION_DIRECTORY_MAX_AGE_MINUTES*60000?`Mesure de plus de ${STATION_DIRECTORY_MAX_AGE_MINUTES} minutes`:null;
  return {...station,isActive:reason===null,...(reason?{exclusionReason:reason}:{})};
 }).sort((a,b)=>Number(b.isActive)-Number(a.isActive)||getStationRankingScore(b,now)-getStationRankingScore(a,now));
 const physical=ranked.filter(station=>station.isActive);
 // Même noyau local que le Dashboard ; altitude de référence inconnue, aucun modèle injecté.
 const local=calculateUltraLocal(physical,'local',lat,lon,null,null,{recordStationReadings:false,inferReferenceAltitude:false});
 const exclusions=[...ranked.filter(station=>!station.isActive).map(station=>station.exclusionReason!),...local.stationsIgnored.map(station=>station.reason)];
 return {lat,lon,radiusKm,providerRadiusKm:50,localRadiusKm:30,
  stations:ranked.map(station=>({...station,sourceKind:'physical' as const,measurementAgeByField:getStationMeasurementAgeStates(station.measurementTimes,now)})),
  modelReferences:[],groundTruth:{temperature:local.temperature,humidity:local.humidity,pressure:local.pressure,windSpeed:local.windSpeed,windGust:local.windGust,precipitation:local.precipitation,altitudeCorrection:local.altitudeCorrection,stationsUsed:local.stationsUsed,stationsIgnored:local.stationsIgnored,stationCount:local.stationCount,confidenceScore:local.confidenceScore},
  totalFound:ranked.length,activeCount:physical.length,ignoredCount:ranked.length-physical.length,physicalStationCount:physical.length,
  physicalStationDiagnostics:{netatmoStatus:notConnected?'not_connected':error?'temporarily_unavailable':collection.fromCache?'fresh_cache':ranked.length?'live':'connected_empty',discoveredCount:ranked.length,activeCount:physical.length,exclusionReasons:Array.from(new Set(exclusions)).slice(0,3)},
  sourceDiagnostics:[{source:'netatmo' as const,status:notConnected?'not_configured' as const:error?'error' as const:ranked.length?'success_with_data' as const:'success_empty' as const,stationCount:ranked.length,...(error&&!notConnected?{reason:error==='OFFLINE'?'network_error' as const:error==='NETATMO_INVALID_RESPONSE'?'invalid_response' as const:['NETATMO_RATE_LIMIT','NETATMO_SCOPE'].includes(error)?'provider_http_error' as const:'source_unavailable' as const}:{})}],
  sourceDiagnosticsFromCache:collection.fromCache===true,referenceSourceCount:0,fetchedAt:error?null:collection.fetchedAt??null,
 };
}

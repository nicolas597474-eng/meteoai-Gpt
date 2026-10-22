import {buildStationSearchReadModel,stationSearchInput} from '../../../shared/stationSearchReadModel';
import {getNetatmoStationCollection,NetatmoStationsError} from './netatmoStations';

/** Réutilise la collecte 50 km et son cache mémoire, jamais le cache public hors ligne. */
export async function collectStationSearch(input:unknown){
 const coords=stationSearchInput(input);
 try{
  if(!navigator.onLine)return buildStationSearchReadModel(coords,{rows:[],errorCode:'OFFLINE'});
  const collection=await getNetatmoStationCollection(coords.lat,coords.lon);
  return buildStationSearchReadModel(coords,{rows:collection.stations,fetchedAt:collection.fetchedAt,fromCache:collection.fromCache});
 }catch(error){return buildStationSearchReadModel(coords,{rows:[],errorCode:error instanceof NetatmoStationsError?error.code:'NETATMO_UNAVAILABLE'});}
}

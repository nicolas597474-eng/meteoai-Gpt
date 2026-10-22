import {handleNetatmo} from './netatmo-api.mjs';
import {buildStationSearchReadModel,stationSearchInput} from '../shared/stationSearchReadModel';

/** Même coffre OAuth et cache de zones : aucun appel HTTP vers le Site lui-même. */
export async function searchStations(input:unknown,request:Request,env:any){
 const coords=stationSearchInput(input),url=new URL('/api/netatmo/stations',request.url);
 url.search=new URLSearchParams({lat:String(coords.lat),lon:String(coords.lon),radiusKm:'50'}).toString();
 const response=await handleNetatmo(new Request(url,{headers:request.headers}),env);
 const data=await response.json() as any;
 if(!response.ok)return buildStationSearchReadModel(coords,{rows:[],errorCode:typeof data.code==='string'?data.code:'NETATMO_UNAVAILABLE'});
 if(data.radiusKm!==50||!Array.isArray(data.stations))return buildStationSearchReadModel(coords,{rows:[],errorCode:'NETATMO_INVALID_RESPONSE'});
 return buildStationSearchReadModel(coords,{rows:data.stations,fetchedAt:Number.isFinite(data.at)?new Date(data.at).toISOString():null,fromCache:data.cacheHit===true});
}

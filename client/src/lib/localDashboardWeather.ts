import type {CurrentWeatherSnapshot} from '../../../server/weatherServices';
import {buildLocalDashboardWeather} from '../../../shared/localDashboardWeather';
import type {LocalMode} from '../../../server/ultraLocalService';
import {getNetatmoStations} from './netatmoStations';
import {getReferenceElevation} from './referenceElevation';

/** Le cache Netatmo partagé évite une nouvelle collecte à chaque changement de mode. */
export async function collectLocalDashboardWeather(coords:{lat:number;lon:number},localMode:LocalMode,snapshotPromise:Promise<CurrentWeatherSnapshot|null>){
 let stationError:string|null=null;
 const [snapshot,rows]=await Promise.all([snapshotPromise.catch(()=>null),getNetatmoStations(coords.lat,coords.lon).catch(error=>{stationError=error instanceof Error?error.message:'Stations momentanément indisponibles.';return [];} )]);
 const elevation=typeof snapshot?.elevationM==='number'&&Number.isFinite(snapshot.elevationM)?snapshot.elevationM:rows.length?(await getReferenceElevation(coords.lat,coords.lon))?.value??null:null;
 return buildLocalDashboardWeather({...coords,localMode,rows,snapshot,referenceElevation:elevation,stationError});
}

import {buildCurrentDashboardWeatherState} from '../../../server/currentDashboardWeather';
import type {CurrentWeatherSnapshot} from '../../../server/weatherServices';
import {mapBridgeStations} from '../../../shared/currentStationAdapter';
import {getNetatmoStations} from './netatmoStations';
import {getReferenceElevation} from './referenceElevation';

/** Réactive le read-model d'origine depuis les sources accessibles au visiteur.
 * Les sept modèles de prévision ne sont ni recalculés ni utilisés comme mesures. */
export async function collectCurrentDashboardWeather(coords:{lat:number;lon:number},snapshotPromise:Promise<CurrentWeatherSnapshot|null>){
 const [snapshot,raw]=await Promise.all([snapshotPromise.catch(()=>null),getNetatmoStations(coords.lat,coords.lon).catch(()=>[])]);
 const stations=mapBridgeStations(raw,coords.lat,coords.lon);
 const referenceElevation=stations.length&&!(typeof snapshot?.elevationM==='number'&&Number.isFinite(snapshot.elevationM))?await getReferenceElevation(coords.lat,coords.lon):null;
 const state=buildCurrentDashboardWeatherState({...coords,snapshot,stations,referenceElevation});
 if(state.fields.temperature.provenance.kind==='physical_stations')state.fields.temperature.provenance.reason=[state.fields.temperature.provenance.reason,'Contrôles physiques du moteur original ; priorité technique Netatmo 72/100, distincte d’une fiabilité historique et de la calibration des modèles.'].filter(Boolean).join(' ');
 for(const field of Object.values(state.fields))delete field.observations;
 return state;
}

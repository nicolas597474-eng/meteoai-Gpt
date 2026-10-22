import {calculateUltraLocal,type LocalMode} from '../server/ultraLocalService';
import type {CurrentWeatherSnapshot} from '../server/weatherServices';
import {mapBridgeStations} from './currentStationAdapter';

/** Read-model du contexte local : moteur d’origine, sources physiques explicites.
 * Ne modifie ni la série officielle, ni ses poids, ni la calibration historique. */
export function buildLocalDashboardWeather(input:{lat:number;lon:number;localMode:LocalMode;rows:unknown[];snapshot:CurrentWeatherSnapshot|null;referenceElevation:number|null;stationError?:string|null}){
 const {lat,lon,localMode}=input;
 const stations=mapBridgeStations(input.rows,lat,lon,50);
 const snapshotTime=Date.parse(input.snapshot?.capturedAt??'');
 const snapshot=input.snapshot&&Number.isFinite(snapshotTime)&&snapshotTime<=Date.now()+60000&&Date.now()-snapshotTime<=30*60000?input.snapshot:null;
 const officialTemperature=typeof snapshot?.temp==='number'&&Number.isFinite(snapshot.temp)?snapshot.temp:null;
 const result=calculateUltraLocal(stations,localMode,lat,lon,input.referenceElevation,officialTemperature,{recordStationReadings:false,inferReferenceAltitude:false});
 const hasStations=result.stationCount>0&&result.temperature!=null;
 const temperature=hasStations?result.temperature:officialTemperature;
 const latestAt=result.stationsUsed.filter(s=>(s.fieldWeights?.temperature??s.weight)>0).map(s=>s.observedAt).filter((at):at is string=>typeof at==='string'&&Number.isFinite(Date.parse(at))).sort((a,b)=>Date.parse(b)-Date.parse(a))[0]??null;
 const explanation=hasStations?result.explanation:officialTemperature!=null?'Aucune température physique admissible : repli explicite sur le snapshot Open-Meteo. Aucun ajustement local appliqué.':'Aucune température physique ni snapshot de modèle récent exploitable. Le calcul local reste indisponible.';
 return {location:{lat,lon},localMode,currentSnapshot:snapshot,
  netatmo:{status:input.stationError?'error':stations.length?'available':'no_stations',message:input.stationError??null},
  coverage:{providerRadiusKm:50,modeRadiusKm:localMode==='ultra-local'?10:localMode==='local'?30:20},
  today:null,hourly:[],forecast15d:[],
  ultraLocal:{...result,temperature,officialTemperature,usesOfficialFallback:!hasStations&&officialTemperature!=null,usesModelFallback:false,modelFallback:null,
   modelWeight:hasStations&&officialTemperature!=null?result.modelWeight:0,modelContribution:officialTemperature,
   microclimateAdjustment:hasStations?result.microclimateAdjustment:0,microclimateFactors:hasStations?result.microclimateFactors:[],explanation,
  },
  currentObservation:hasStations?{temperature:result.temperature!,stationCount:result.stationCount,confidenceScore:result.confidenceScore,source:'local_validated' as const,observedAt:latestAt,deltaFromOfficialC:officialTemperature==null?null:Math.round((result.temperature!-officialTemperature)*10)/10}:null,
 };
}

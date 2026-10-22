import {evaluateProviderRunForecasts,structurallyValidProviderRunValue,type ProviderRunForecastValue} from '../server/providerRunHorizon';
import {parisLocalHourToUniqueEpochMs} from '../server/parisHourlyTime';
import type {AuxiliaryReference,AuxiliaryReferenceField} from '../shared/physicalAuxiliaryReference';
const HOUR=3600000;
const mapping={pressure:{variable:'pressure_msl',providerVariable:'pressure_msl',basis:'mean_sea_level',unit:'hPa'},precipitation:{variable:'rain_liquid_1h',providerVariable:'precipitation',basis:'liquid_rain_60min',unit:'mm'},windSpeed:{variable:'wind_speed',providerVariable:'wind_speed',basis:'wind_10m_instantaneous',unit:'km/h'},windGust:{variable:'wind_gust',providerVariable:'wind_gust',basis:'wind_10m_hour_max',unit:'km/h'}} as const;
const groupKey=(r:ProviderRunForecastValue)=>[r.captureRunId,r.modelId,r.providerRunAt,r.availableAt,r.validTime].join('/');
function finite(value:unknown):value is number{return typeof value==='number'&&Number.isFinite(value);}

/** Ajoute seulement des paires dont la définition et la fenêtre physique sont comparables. */
export function buildAuxiliaryLearningComparisons(snapshots:any[],values:ProviderRunForecastValue[]){
 const components=new Map<string,Map<string,ProviderRunForecastValue|null>>();
 for(const value of values){if(!structurallyValidProviderRunValue(value))continue;const key=groupKey(value),group=components.get(key)??new Map(),old=group.get(value.variable);group.set(value.variable,old===null||old&&(old.value!==value.value||old.unit!==value.unit)?null:value);components.set(key,group);}
 const comparisons:any[]=[];
 for(const snapshot of snapshots){
  const validAt=parisLocalHourToUniqueEpochMs(snapshot.date,snapshot.hour);if(validAt==null)continue;
  for(const [field,definition] of Object.entries(mapping) as Array<[AuxiliaryReferenceField,(typeof mapping)[AuxiliaryReferenceField]]>){
   const reference:AuxiliaryReference|undefined=snapshot.auxiliaryReferences?.[field];
   if(!reference?.scoreEligible||reference.validAt!==validAt||reference.basis!==definition.basis||reference.unit!==definition.unit||!finite(reference.scoreValue)||reference.contributors.length<3)continue;
   const oldestAt=Math.min(...reference.contributors.map(r=>r.measuredAt)),newestAt=Math.max(...reference.contributors.map(r=>r.measuredAt));
   const cutoff=field==='precipitation'||field==='windGust'?reference.windowStartAt:oldestAt;
   if(!Number.isSafeInteger(cutoff))continue;
   const candidates:ProviderRunForecastValue[]=[];const proofs=new Map<string,any>();
   for(const group of components.values()){
    const value=group.get(definition.providerVariable);if(!value||value.validTime!==validAt||!finite(value.value)||value.unit!==definition.unit||value.availableAt>=cutoff!)continue;
    let rainComponents:any=null;
    if(field==='precipitation'){
     const rain=group.get('rain'),showers=group.get('showers'),snow=group.get('snowfall');
     if(!rain||!showers||!snow||!finite(rain.value)||!finite(showers.value)||rain.value<0||showers.value<0||rain.unit!=='mm'||showers.unit!=='mm'||snow.unit!=='cm'||snow.value!==0||Math.abs(value.value-rain.value-showers.value)>.05)continue;
     rainComponents={rain:rain.value,showers:showers.value,snowfall:0};
    }
    candidates.push({...value,variable:field==='pressure'?'pressure':field==='precipitation'?'precipitation':definition.variable});
    proofs.set(groupKey(value),{version:1,field,basis:reference.basis,providerVariable:definition.providerVariable,unit:reference.unit,validAt,oldestAt,newestAt,windowStartAt:reference.windowStartAt,windowEndAt:reference.windowEndAt,stationCount:reference.contributors.length,value:reference.scoreValue,...(rainComponents?{rainComponents}:{})});
   }
   if(!candidates.length)continue;
   // Ne pas greffer ces grandeurs aux agrégats quotidiens température/humidité.
   const physical={...snapshot,temperature:null,humidity:null,pressure:null,windSpeed:null,windGust:null,precipitation:null,[field]:reference.scoreValue,stationCount:reference.contributors.length};
   for(const {stationsUsed:_stations,...row} of evaluateProviderRunForecasts([physical],candidates).comparisons){
    const proof=proofs.get([row.captureRunId,row.modelId,row.providerRunAt,row.availableAt,row.validTime].join('/'));
    const comparison={...row,variable:definition.variable,physicalReference:proof};if(isAdmissibleAuxiliaryComparison(comparison))comparisons.push(comparison);
   }
  }
 }
 return comparisons;
}

/** Métadonnées compactes couvertes par la signature de la journée serveur. */
export function isAdmissibleAuxiliaryComparison(row:any){
 const p=row.physicalReference,definition=p&&mapping[p.field as AuxiliaryReferenceField];
 if(!definition||p.version!==1||p.basis!==definition.basis||p.providerVariable!==definition.providerVariable||p.unit!==definition.unit||row.variable!==definition.variable||row.forecastUnit!==definition.unit||row.observedUnit!==definition.unit||p.validAt!==row.validTime||!finite(p.value)||p.value!==row.observedValue||!Number.isSafeInteger(p.stationCount)||p.stationCount<3||p.stationCount>1000||p.stationCount!==row.stationCount||!Number.isSafeInteger(p.oldestAt)||!Number.isSafeInteger(p.newestAt)||p.oldestAt>p.newestAt)return false;
 const bounds=p.field==='pressure'?[300,1200]:[0,p.field==='windGust'?400:p.field==='windSpeed'?300:500];
 if(!finite(row.forecastValue)||p.value<bounds[0]||p.value>bounds[1]||row.forecastValue<bounds[0]||row.forecastValue>bounds[1])return false;
 if(p.field==='pressure'||p.field==='windSpeed')return Math.abs(p.oldestAt-p.validAt)<=300000&&Math.abs(p.newestAt-p.validAt)<=300000&&row.availableAt<p.oldestAt;
 if(p.windowStartAt!==p.validAt-HOUR||p.windowEndAt!==p.validAt||row.availableAt>=p.windowStartAt||p.oldestAt!==p.validAt||p.newestAt!==p.validAt)return false;
 if(p.field==='windGust')return true;
 const r=p.rainComponents;return !!r&&finite(r.rain)&&finite(r.showers)&&r.rain>=0&&r.showers>=0&&r.snowfall===0&&Math.abs(row.forecastValue-r.rain-r.showers)<=.05;
}

export const AUXILIARY_FIELDS=['pressure','windSpeed','windGust','precipitation'] as const;
export type PhysicalAuxiliary=Partial<Record<(typeof AUXILIARY_FIELDS)[number],{value:number;measuredAt:number;basis:string;periodMinutes:number|null}>>;
const specification={pressure:{min:300,max:1200,basis:'mean_sea_level',periodMinutes:null},windSpeed:{min:0,max:300,basis:'sensor_height_and_averaging_unspecified',periodMinutes:null},windGust:{min:0,max:400,basis:'maximum_window_and_height_unspecified',periodMinutes:null},precipitation:{min:0,max:500,basis:'rolling_liquid_rain',periodMinutes:60}} as const;
/** Conservation des grandeurs et de leur vrai instant, sans les qualifier comme références de score. */
export function auxiliaryFromStation(station:any,receivedAt:number):PhysicalAuxiliary{
 const result:PhysicalAuxiliary={};
 for(const field of AUXILIARY_FIELDS){const value=station[field],measuredAt=station.measurementTimes?.[field],spec=specification[field];
  if(typeof value!=='number'||!Number.isFinite(value)||value<spec.min||value>spec.max||!Number.isSafeInteger(measuredAt)||measuredAt>receivedAt||receivedAt-measuredAt>90*60000||field==='precipitation'&&station.precipitationPeriodMinutes!==60)continue;
  result[field]={value,measuredAt,basis:spec.basis,periodMinutes:spec.periodMinutes};
 }
 return result;
}
export function normalizePhysicalAuxiliary(raw:any,receivedAt:number):PhysicalAuxiliary{
 if(!raw||Array.isArray(raw)||typeof raw!=='object'||Object.keys(raw).some(k=>!AUXILIARY_FIELDS.includes(k as any)))throw Error('Champs physiques non conformes');
 const station:any={measurementTimes:{},precipitationPeriodMinutes:60};for(const field of AUXILIARY_FIELDS)if(raw[field]){station[field]=raw[field].value;station.measurementTimes[field]=raw[field].measuredAt;}
 const normalized=auxiliaryFromStation(station,receivedAt);
 if(JSON.stringify(normalized)!==JSON.stringify(raw))throw Error('Champs physiques non conformes');
 return normalized;
}

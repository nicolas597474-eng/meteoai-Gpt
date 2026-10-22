export type AuxiliaryReferenceField='pressure'|'windSpeed'|'windGust'|'precipitation';
export type AuxiliaryReference={
 value:number|null;scoreValue:number|null;unit:'hPa'|'km/h'|'mm';basis:string;
 stationCount:number;scoreEligible:boolean;reason:string;validAt:number;
 windowStartAt:number|null;windowEndAt:number|null;
 contributors:Array<{stationId:string;measuredAt:number;value:number;weight:number}>;
};
export type AuxiliaryReferences=Record<AuxiliaryReferenceField,AuxiliaryReference>;

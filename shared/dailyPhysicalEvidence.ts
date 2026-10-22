export type PhysicalCoverageDay={date:string;measuredHours:number;usableHours:number;hours:number[];pendingHours:number;ambiguousHours:number;closedDay:boolean;thresholdMet:boolean};
export type PhysicalReferenceEvidence={auxiliaryReferenceCounts?:Record<string,number>;status:'verified'|'partial'|'none'|'unavailable';referenceCount:number;filesChecked:number;filesRejected:number;filesLimit:48;boundedRead:boolean;lastCreatedAt:number|null;days:{date:string;hours:number[];coverageHours:number;closedDay:boolean;thresholdMet:boolean}[];temperatureOnly:boolean;humidityReferenceCount?:number;calibration:'not_active'};
/** La couverture candidate ne remplace pas un enregistrement de preuve officiellement qualifié. */
export type DailyPhysicalEvidence={
 scope:'hondeghem'|'not_covered';windowDays:7;timeZone:'Europe/Paris';requiredCoverageHours:number;
 filesChecked:number;filesRejected:number;filesLimit:number;boundedRead:boolean;measurementsVerified:number;
 days:PhysicalCoverageDay[];officialEvidence:'not_migrated'|'configured'|'qualified';calibration:'not_active'|'collecting'|'ready';
 learning?:LearningSummary;
 serverReferences?:PhysicalReferenceEvidence;
 serverMeasurements?:{auxiliaryCoverage?:Record<string,number>;status:'verified'|'none'|'partial'|'unavailable';source:'netatmo_server';filesChecked:number;filesRejected:number;filesLimit:48;boundedRead:boolean;conflictingMeasurements:number;measurementsVerified:number;lastReceivedAt:number|null;days:PhysicalCoverageDay[]};
};
import type {LearningSummary} from './qualifiedLearning';

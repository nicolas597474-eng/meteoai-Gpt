import type {HourlyComparisonDiagnostic} from '../server/hourlyComparisonDiagnostics';
/** Diagnostic de consultation : jamais un cycle planifié, une preuve quotidienne ou un score officiel. */
export type ExploratoryComparisonDiagnostics={
 kind:'exploratory_archive_read';scope:'hondeghem'|'not_covered';capturedAt:string;cycleDate:string;
 diagnostics:HourlyComparisonDiagnostic[];
 summary:null|{measurements:number;physicalFiles:number;rejectedPhysicalFiles:number;forecastFiles:number;rejectedForecastFiles:number;searchedHours:number;observedHours:number;unmatchedHours:number;referenceHours:number;comparisons:number;boundedRead:boolean};
};

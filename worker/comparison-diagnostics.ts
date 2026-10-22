import {ApiError} from './api-error';
import {coordinates} from './weather';
import {readProvisionalComparisons} from './provisional-comparisons';
import type {ExploratoryComparisonDiagnostics} from '../shared/exploratoryComparisonDiagnostics';

export async function readComparisonDiagnostics(input:any,request:Request,env:any,now=Date.now()):Promise<ExploratoryComparisonDiagnostics>{
 const coords=coordinates(input);
 if(!request.headers.get('oai-authenticated-user-id'))throw new ApiError('Connexion ChatGPT requise pour consulter les comparaisons.',401);
 const base={kind:'exploratory_archive_read' as const,capturedAt:new Date(now).toISOString(),cycleDate:'7 jours'};
 if(coords.lat!==50.7567||coords.lon!==2.5204)return {...base,scope:'not_covered',diagnostics:[],summary:null};
 const result=await readProvisionalComparisons(env,now,7);
 return {...base,scope:'hondeghem',diagnostics:result.diagnostics,summary:{measurements:result.measurementsRead,physicalFiles:result.integrity.physicalFiles,rejectedPhysicalFiles:result.integrity.rejectedPhysicalFiles,forecastFiles:result.capturesRead,rejectedForecastFiles:result.rejectedArchives,searchedHours:result.integrity.searchedHours,observedHours:result.integrity.observedHours,unmatchedHours:result.integrity.unmatchedHours,referenceHours:result.completedReferenceHours,comparisons:result.comparisonCount,boundedRead:result.boundedRead}};
}

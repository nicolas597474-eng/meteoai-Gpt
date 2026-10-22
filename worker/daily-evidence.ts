import {ApiError} from './api-error';
import {coordinates} from './weather';
import {readVerifiedObservations} from './observation-integrity';
import {buildDailyPhysicalCoverage} from './daily-coverage';
import {MINIMUM_COVERAGE_HOURS} from '../server/physicalObservationAggregation';
import type {DailyPhysicalEvidence} from '../shared/dailyPhysicalEvidence';
import {readServerObservations} from './server-observations';
import {readPhysicalReferenceEvidence} from './physical-reference-store';
import {readLearningHistory} from './learning-store';
import {summarizeLearning} from '../shared/qualifiedLearning';


export async function readDailyEvidence(input:any,request:Request,env:any,now=Date.now()){
 const coords=coordinates(input);
 if(!request.headers.get('oai-authenticated-user-id'))throw new ApiError('Connexion ChatGPT requise pour consulter les preuves physiques.',401);
 const scope=coords.lat===50.7567&&coords.lon===2.5204?'hondeghem':'not_covered';
 const diagnostics:DailyPhysicalEvidence={scope,windowDays:7,timeZone:'Europe/Paris',requiredCoverageHours:MINIMUM_COVERAGE_HOURS,filesChecked:0,filesRejected:0,filesLimit:24,boundedRead:false,measurementsVerified:0,days:[],officialEvidence:'not_migrated',calibration:'not_active'};
 if(scope==='hondeghem'){
  const read=await readVerifiedObservations(env,now,7*24,diagnostics.filesLimit);
  diagnostics.filesChecked=read.checkedArchives;diagnostics.filesRejected=read.rejectedArchives;diagnostics.boundedRead=read.boundedRead;diagnostics.measurementsVerified=read.rows.length;diagnostics.days=buildDailyPhysicalCoverage(read.rows,now);
  // Le contrôle des nouvelles réceptions serveur reste indépendant des archives navigateur récupérées.
  try{
   const server=await readServerObservations(env,now);
   diagnostics.serverMeasurements={status:server.status,source:'netatmo_server',auxiliaryCoverage:server.auxiliaryCoverage,filesChecked:server.checkedArchives,filesRejected:server.rejectedArchives,filesLimit:48,boundedRead:server.boundedRead,conflictingMeasurements:server.conflictingMeasurements,measurementsVerified:server.rows.length,lastReceivedAt:server.lastReceivedAt,days:buildDailyPhysicalCoverage(server.rows,now,'netatmo_server')};
  }catch{diagnostics.serverMeasurements={status:'unavailable',source:'netatmo_server',filesChecked:0,filesRejected:0,filesLimit:48,boundedRead:false,conflictingMeasurements:0,measurementsVerified:0,lastReceivedAt:null,days:[]};}
  try{diagnostics.serverReferences=await readPhysicalReferenceEvidence(env,now);}
  catch{diagnostics.serverReferences={status:'unavailable',referenceCount:0,filesChecked:0,filesRejected:0,filesLimit:48,boundedRead:false,lastCreatedAt:null,days:[],temperatureOnly:true,calibration:'not_active'};}
  try{
   const learning=summarizeLearning(await readLearningHistory(env,now),now);diagnostics.learning=learning;
   diagnostics.officialEvidence=learning.qualifiedDays?'qualified':'configured';
   diagnostics.calibration=learning.qualifiedGroups?'ready':'collecting';
  }catch{ /* Échec explicite : ne pas transformer une lecture indisponible en zéro de succès. */ }
 }
 const learning=diagnostics.learning;
 return {date:learning?.lastDay??null,coverageHours:learning?.lastCoverageHours??null,lastCollectedAt:learning?.lastDayCreatedAt??null,qualifiedScoreCount:learning?.scoreCount??null,lastQualifiedScoreAt:learning?.lastScoreAt??null,requiredCoverageHours:MINIMUM_COVERAGE_HOURS,isEligible:(learning?.qualifiedGroups??0)>0,evidenceTimeZone:'Europe/Paris',snapshotCadence:null,dailyScoringSchedule:learning?'Après la collecte de service ou à la consultation, après fin de journée et délai de 90 minutes':null,dailyCoverage:diagnostics};
}

import type {ModelPerformanceEvidence} from '../server/fusionPerformance';
import {DAILY_FUSION_LOOKBACK_DAYS,getEvidenceIneligibilityReason} from '../server/fusionPerformance';
import {summarizeHourlyHistoricalEvidence,type HourlyHistoricalScoreRow} from '../server/hourlyHistoricalEvidence';
import {getForecastHorizonWindow} from './forecastHorizon';
import {getParisDateAndHour} from '../server/parisHourlyTime';

export type LearningUnit=ModelPerformanceEvidence&{date:string};
export type ProviderLearningScore=HourlyHistoricalScoreRow&{leadBasis:'provider_run';scoringValidationVersion:2};
export type LearningProviderLimit={provider:'forecast'|'single_runs';retryAt:number;period:'minute'|'hour'|'day'|'unknown'};
export type LearningHistory={providerRateLimitsAvailable?:boolean;providerRateLimits?:LearningProviderLimit[];qualification?:{attemptedAt:number;rejectedDays:number;pendingDays:number};version:1;scope:'hondeghem'|'not_covered';available:boolean;revision:string;units:LearningUnit[];hourlyScores:ProviderLearningScore[];exactHourlyScores:ProviderLearningScore[];providerModels:any[];providerRunCount:number;qualifiedDays:number;hourlyEvidenceDays?:number;scoreCount:number;lastScoreAt:number|null;lastDay:string|null;lastCoverageHours:number|null;lastDayCreatedAt:number|null;filesRejected:number;boundedRead:boolean;forecastCount:number;collection:{status:string;attemptedAt:number|null;mode?:'forecast_api'|'verified_hourly_cycles'|'mixed';models?:string[];dates?:string[];forecastApiStatus?:number|null};qualifiedGroups:number;dailyQualifiedGroups:number;hourlyQualifiedGroups:number};
export type LearningMetric={mode:'daily'|'hourly';model:string;variable:string;horizon:string;mae:number;rmse:number;bias:number;comparisons:number;days:number;eligible:boolean};
export type LearningSummary=Omit<LearningHistory,'units'|'hourlyScores'|'exactHourlyScores'|'providerModels'>&{modelScores?:LearningMetric[]};
export function summarizeLearning(history:LearningHistory,now=Date.now()):LearningSummary{
 const {units,hourlyScores,exactHourlyScores:_e,providerModels:_p,...summary}=history;
 const today=getParisDateAndHour(now)!.date,eligible=new Set(learningPerformance(units,today,now).map(r=>[r.serviceName,r.variable,r.horizonBucket].join('|'))),modelScores:LearningMetric[]=[];
 const dailyGroups=new Map<string,LearningUnit[]>();for(const row of units){const key=[row.serviceName,row.variable,row.horizonBucket].join('|');dailyGroups.set(key,[...(dailyGroups.get(key)??[]),row]);}
 for(const [key,rows] of Array.from(dailyGroups)){modelScores.push({mode:'daily',model:rows[0].serviceName,variable:rows[0].variable,horizon:rows[0].horizonBucket,mae:rows.reduce((s,r)=>s+r.mae,0)/rows.length,rmse:Math.sqrt(rows.reduce((s,r)=>s+r.rmse**2,0)/rows.length),bias:rows.reduce((s,r)=>s+(r.signedBias??0),0)/rows.length,comparisons:rows.reduce((s,r)=>s+r.comparisonCount,0),days:new Set(rows.map(r=>r.date)).size,eligible:eligible.has(key)});}
 const hourlyGroups=new Map<string,ProviderLearningScore>();for(const row of hourlyScores)hourlyGroups.set([row.modelName,row.variable,row.horizonBucket].join('|'),row);
 for(const row of Array.from(hourlyGroups.values())){const evidence=summarizeHourlyHistoricalEvidence(hourlyScores,{modelName:row.modelName,modelId:row.modelId!,variable:row.variable,horizonBucket:row.horizonBucket,beforeDate:today,historyAvailable:true});if(evidence.metrics)modelScores.push({mode:'hourly',model:row.modelName,variable:row.variable,horizon:row.horizonBucket,mae:evidence.metrics.mae,rmse:evidence.metrics.rmse,bias:evidence.metrics.bias,comparisons:evidence.metrics.comparisonCount,days:evidence.metrics.evaluatedDays,eligible:evidence.status==='qualified'});}
 return {...summary,modelScores};
}
/** Les références MSL et pluie liquide ne calibrent pas les variables surface et précipitations toutes phases. */
export function countQualifiedHourlyGroups(scores:ProviderLearningScore[],beforeDate:string){
 const groups=new Map<string,ProviderLearningScore>();for(const score of scores.filter(row=>!['pressure_msl','rain_liquid_1h'].includes(row.variable)))groups.set([score.modelName,score.modelId,score.variable,score.horizonBucket].join('|'),score);
 return Array.from(groups.values()).filter(row=>summarizeHourlyHistoricalEvidence(scores,{modelName:row.modelName,modelId:row.modelId!,variable:row.variable,horizonBucket:row.horizonBucket,beforeDate,historyAvailable:true}).status==='qualified').length;
}

/** Les cycles datés ne remplacent une variable qu'après qualification de sa propre preuve. */
export function selectLearnedProviderForecasts(forecasts:any[],history:LearningHistory|null,now:number){
 if(!history?.available)return forecasts;
 const beforeDate=getParisDateAndHour(now)?.date??null,additions:any[]=[],replaced=new Map<string,Set<string>>();
 const buckets=new Map<string,ProviderLearningScore[]>(),exactLeads=new Map<string,ProviderLearningScore[]>();
 for(const row of history.hourlyScores){const key=[row.modelName,row.variable,row.horizonBucket].join('|');buckets.set(key,[...(buckets.get(key)??[]),row]);}
 for(const row of history.exactHourlyScores){const key=[row.modelName,row.variable,row.horizonMilliseconds].join('|');exactLeads.set(key,[...(exactLeads.get(key)??[]),row]);}
 const bucketStatus=new Map<string,boolean>();
 for(const model of history.providerModels){const hours=[];
  for(const hour of model.hours){
   const lead=hour.validAt-model.providerRunAt,horizon=getForecastHorizonWindow(lead/60000);if(!horizon||lead<=0)continue;
   const selected:any={date:hour.date,hour:hour.hour,validAt:hour.validAt};let count=0;
   for(const [variable,field] of [['temperature','temperature'],['precipitation','precipitation'],['wind_speed','windSpeed'],['wind_gust','windGusts'],['humidity','humidity'],['pressure','pressure']]){
    if(!Number.isFinite(hour[field]))continue;
    const base={modelName:model.modelName,modelId:model.modelId,variable,horizonBucket:horizon.key,beforeDate,historyAvailable:true};
    const bucketKey=[model.modelName,variable,horizon.key].join('|'),exactKey=[model.modelName,variable,lead].join('|');
    const exact=summarizeHourlyHistoricalEvidence(exactLeads.get(exactKey)??[],{...base,horizonMilliseconds:lead});
    if(!bucketStatus.has(bucketKey))bucketStatus.set(bucketKey,summarizeHourlyHistoricalEvidence(buckets.get(bucketKey)??[],base).status==='qualified');
    if(exact.status!=='qualified'&&!bucketStatus.get(bucketKey))continue;
    selected[field]=hour[field];count++;
    const key=model.modelName+'/'+hour.validAt;const fields=replaced.get(key)??new Set<string>();fields.add(field);replaced.set(key,fields);
   }
   if(count)hours.push(selected);
  }
  if(hours.length)additions.push({...model,hours});
 }
 if(!additions.length)return forecasts;
 const original=forecasts.map(model=>({...model,hours:model.hours.map((hour:any)=>{
  const fields=replaced.get(model.modelName+'/'+hour.validAt);return fields?{...hour,...Object.fromEntries(Array.from(fields).map(field=>[field,null]))}:hour;
 })}));
 return [...original,...additions];
}

/** Une date = une unité indépendante. Aucun horizon, modèle ou lieu voisin ne sert de repli. */
export function learningPerformance(units:LearningUnit[],targetDate:string,referenceAt:number):ModelPerformanceEvidence[]{
 const since=new Date(Date.parse(targetDate+'T12:00:00Z')-DAILY_FUSION_LOOKBACK_DAYS*86400000).toISOString().slice(0,10);
 const groups=new Map<string,LearningUnit[]>();
 for(const unit of units){
  if(unit.date>=targetDate||unit.date<since)continue;
  const key=[unit.locationKey,unit.serviceName,unit.modelId,unit.variable,unit.horizonBucket].join('|');
  groups.set(key,[...(groups.get(key)??[]),unit]);
 }
 return Array.from(groups.values()).flatMap(rows=>{
  if(new Set(rows.map(r=>r.date)).size!==rows.length)return [];
  const n=rows.length,mae=rows.reduce((s,r)=>s+r.mae,0)/n;
  const evidence={...rows[0],comparisonCount:rows.reduce((s,r)=>s+r.comparisonCount,0),sampleSize:n,evaluatedDays:n,mae,rmse:Math.sqrt(rows.reduce((s,r)=>s+r.rmse**2,0)/n),signedBias:rows.reduce((s,r)=>s+(r.signedBias??0),0)/n,standardError:n>1?Math.sqrt(rows.reduce((s,r)=>s+(r.mae-mae)**2,0)/(n-1)/n):0,latestScoreDate:rows.map(r=>r.date).sort().at(-1)!};
  return getEvidenceIneligibilityReason(evidence,evidence,new Date(referenceAt))==null?[evidence]:[];
 });
}

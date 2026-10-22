import {scanVerifiedLearningDays} from './learning-store';
import {coordinates} from './weather';
import {OFFICIAL_HOURLY_MODELS} from '../server/officialModels';
import {summarizeHourlyHistoricalEvidence,type HourlyHistoricalScoreRow} from '../server/hourlyHistoricalEvidence';
import {PUBLIC_RANKING_EVIDENCE_THRESHOLDS} from '../server/weatherReliabilityConfig';
import {getDailyForecastValidTime} from '../server/dailyForecastVerification';
import {getParisDateAndHour} from '../server/parisHourlyTime';
import {ApiError} from './api-error';
import {RELIABILITY_HORIZONS} from '../shared/reliabilityHorizons';
import {readFusionVerificationStatus} from './fusion-verification';
export {RELIABILITY_HORIZONS} from '../shared/reliabilityHorizons';

const HOUR=3600000,DAY=24*HOUR,LOCATION='50.757_2.520';
const models=new Map<string,string>(OFFICIAL_HOURLY_MODELS.map(m=>[m.name,m.modelId]));
const variables=[['temperature','Température','°C'],['rain_liquid_1h','Pluie liquide · 1 h','mm'],['wind_speed','Vent à 10 m','km/h'],['wind_gust','Rafales à 10 m · max 1 h','km/h'],['humidity','Humidité','%'],['pressure_msl','Pression au niveau de la mer','hPa']];
const periods:Record<string,number>={'24h':1,'7d':7,'30d':30,'90d':90,'365d':365};
const shift=(date:string,days:number)=>new Date(Date.parse(date+'T12:00:00Z')+days*DAY).toISOString().slice(0,10);
type Horizon=(typeof RELIABILITY_HORIZONS)[number];
type CompactDay={date:string;scores:HourlyHistoricalScoreRow[];dailyScores:HourlyHistoricalScoreRow[];hourly:Record<string,any[]>;daily:Record<string,any>;yesterday:any|null};
type Archive={available:boolean;days:CompactDay[];filesRejected:number;boundedRead:boolean;filesChecked:number;today:string};
const cache=new WeakMap<object,Map<number,{until:number;today:string;value:Promise<Archive>}>>();
export const matchesReliabilityHorizon=(milliseconds:number,h:Horizon)=>Number.isFinite(milliseconds)&&milliseconds>=h.min*HOUR&&(h.max===360?milliseconds<=h.max*HOUR:milliseconds<h.max*HOUR);

/** Une prévision par modèle, variable et validité : dernière réception admissible,
 * jamais sélectionnée selon son erreur. Un doublon contradictoire est écarté. */
function latest(rows:any[],key:(r:any)=>string){
 const grouped=new Map<string,any[]>();for(const row of rows){const k=key(row);grouped.set(k,[...(grouped.get(k)??[]),row]);}
 return Array.from(grouped.values()).flatMap(group=>{group.sort((a,b)=>b.availableAt-a.availableAt);const p=group[0];return group.some(r=>r.availableAt===p.availableAt&&(r.forecastValue!==p.forecastValue||r.observedValue!==p.observedValue))?[]:[p];});
}
function score(rows:any[],date:string,horizon:string,computedAt:number):HourlyHistoricalScoreRow[]{
 const groups=new Map<string,any[]>();
 for(const row of rows){const k=row.modelName+'|'+row.variable;groups.set(k,[...(groups.get(k)??[]),row]);}
 return Array.from(groups.values()).map(values=>{const errors=values.map(r=>r.forecastValue-r.observedValue),n=errors.length,first=values[0];return {date,sourceName:'open-meteo',modelName:first.modelName,modelId:first.modelId,variable:first.variable,horizonBucket:horizon,sampleSize:n,mae:errors.reduce((s,e)=>s+Math.abs(e),0)/n,rmse:Math.sqrt(errors.reduce((s,e)=>s+e*e,0)/n),bias:errors.reduce((s,e)=>s+e,0)/n,computedAt};});
}
const mean=(values:number[])=>values.length?values.reduce((s,v)=>s+v,0)/values.length:null;
function compactDay(p:any,today:string):CompactDay{
 const scores:HourlyHistoricalScoreRow[]=[],dailyScores:HourlyHistoricalScoreRow[]=[],hourly:Record<string,any[]>={},daily:Record<string,any>={};
 const valid=(r:any)=>models.get(r.modelName)===r.modelId&&Number.isFinite(r.forecastValue)&&Number.isFinite(r.observedValue);
 for(const horizon of RELIABILITY_HORIZONS){
  const selected=latest(p.hourly.comparisons.filter((r:any)=>valid(r)&&r.observationDate===p.date&&['temperature','humidity','pressure_msl','rain_liquid_1h','wind_speed','wind_gust'].includes(r.variable)&&matchesReliabilityHorizon(r.forecastLeadTimeMilliseconds,horizon)),r=>[r.modelId,r.variable,r.validTime].join('|'));
  scores.push(...score(selected,p.date,horizon.id,p.createdAt));
  const byTime=new Map<number,any[]>();for(const row of selected.filter(r=>r.variable==='temperature'))byTime.set(row.validTime,[...(byTime.get(row.validTime)??[]),row]);
  const points=Array.from(byTime,([validAt,rows])=>({validAt,hour:getParisDateAndHour(validAt)!.hour,label:new Date(validAt).toLocaleString('fr-FR',{timeZone:'Europe/Paris',day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'}),stationTemperature:mean(rows.map(r=>r.observedValue)),officialTemperature:mean(rows.map(r=>r.forecastValue)),stationPrecipitation:null,officialPrecipitation:null,stationSampleCount:rows.length})).sort((a,b)=>a.validAt-b.validAt);
  // Le graphique horaire conserve au plus les deux dernières journées ; le quotidien couvre toute la période.
  hourly[horizon.id]=p.date>=shift(today,-2)?points:[];
  if(points.length)daily[horizon.id]={date:p.date,label:p.date.slice(8)+'/'+p.date.slice(5,7),stationTemperature:mean(points.map(r=>r.stationTemperature!)),officialTemperature:mean(points.map(r=>r.officialTemperature!)),stationSampleCount:points.length};
  const dailyPairs=latest(p.pairs.map((r:any)=>({...r,modelName:r.serviceName,availableAt:r.forecastAvailableAt})).filter((r:any)=>valid(r)&&['temperature_max','temperature_min'].includes(r.variable)&&matchesReliabilityHorizon((getDailyForecastValidTime(p.date)??NaN)-r.forecastAvailableAt,horizon)),r=>[r.modelId,r.variable].join('|'));
  dailyScores.push(...score(dailyPairs,p.date,horizon.id,p.createdAt));
 }
 const yesterday=p.date===shift(today,-1)?{
  ...emptyYesterday(p.date),status:p.pairs.length?'available':'unavailable',reason:p.pairs.length?null:p.kind==='hourly_learning_day'?'Comparaisons horaires disponibles ; couverture insuffisante pour qualifier les extrema quotidiens.':'Journée physique qualifiée, mais aucune prévision quotidienne antérieure aux mesures n’est comparable.',
  qualifiedSnapshotHours:p.observation.coverageHours,forecastRunCount:p.forecastSources.length,
  pairs:p.pairs.map((r:any)=>({...r,stationEvidence:p.stationEvidence[r.variable]??[]})),groups:dailyGroups(p.pairs),
 }:null;
 return {date:p.date,scores,dailyScores,hourly,daily,yesterday};
}
function dailyGroups(pairs:any[]){
 const groups=new Map<string,any[]>();for(const p of pairs){const k=[p.serviceName,p.modelId,p.variable,p.horizonBucket].join('|');groups.set(k,[...(groups.get(k)??[]),p]);}
 return Array.from(groups.values()).map(rows=>{const p=rows[0],errors=rows.map(r=>r.forecastValue-r.observedValue);return {serviceName:p.serviceName,modelId:p.modelId,variable:p.variable,horizonBucket:p.horizonBucket,unit:p.variable.startsWith('temperature')?'°C':p.variable==='precipitation_sum'?'mm':'km/h',mae:mean(errors.map(Math.abs)),rmse:Math.sqrt(mean(errors.map(v=>v*v))!),bias:mean(errors),pairCount:rows.length,evaluatedDays:1,validDates:[p.validDate]};});
}
function emptyYesterday(date:string){return {status:'unavailable',reason:'Aucune journée physique qualifiée et vérifiée n’est disponible pour hier.',locationKey:LOCATION,validDate:date,validFromAt:getDailyForecastValidTime(shift(date,-1)),validToAt:getDailyForecastValidTime(date),timezone:'Europe/Paris',forecastRunCount:0,qualifiedSnapshotHours:0,pairs:[] as any[],groups:[] as any[],meteoai:{status:'unavailable',reason:'La comparaison de la fusion n’a pas pu être évaluée pour cette date.',pairCount:null,groups:[]},issues:[]};}
async function archive(env:any,now:number,daysBack:number):Promise<Archive>{
 const today=getParisDateAndHour(now)!.date;
 let windows=cache.get(env.DB);if(!windows){windows=new Map();cache.set(env.DB,windows);}
 const existing=windows.get(daysBack);
 if(existing&&existing.until>now&&existing.today===today)return existing.value;
 // Chaque lecteur reçoit la même promesse protégée, y compris pendant une panne.
 // Une ancienne lecture ne doit pas invalider une entrée de cache plus récente.
 const discard=()=>{if(windows.get(daysBack)?.value===value)windows.delete(daysBack);};
 const value:Promise<Archive>=(async()=>{const days:CompactDay[]=[];const read=await scanVerifiedLearningDays(env,now,p=>days.push(compactDay(p,today)),{startDate:shift(today,-daysBack),endDate:shift(today,-1)});return {...read,available:true,days};})().then(
  result=>{if(result.filesRejected||result.boundedRead)discard();return result;},
  ()=>{discard();return {available:false,days:[],filesRejected:0,filesChecked:0,boundedRead:false,today};}
 );
 windows.set(daysBack,{until:now+5*60000,today,value});
 return value;
}
export function buildReliabilityReadModel(input:any,a:Archive,now:number,trendArchive:Archive=a){
 const period=input?.period??'7d',horizon=RELIABILITY_HORIZONS.find(h=>h.id===(input?.horizon??'6-24h'));
 if(!Object.hasOwn(periods,period)||!horizon)throw new ApiError('Période ou horizon de fiabilité invalide.');
 const startDate=shift(a.today,-periods[period]),endDate=shift(a.today,-1),scoped=a.days.filter(d=>d.date>=startDate&&d.date<=endDate);
 const complete=a.available&&!a.filesRejected&&!a.boundedRead;
 const trendComplete=trendArchive.available&&!trendArchive.filesRejected&&!trendArchive.boundedRead;
 const trendRows=trendArchive.days.flatMap(d=>d.scores);
 const rows=a.days.flatMap(d=>d.scores),dailyRows=a.days.flatMap(d=>d.dailyScores);
 const summarize=(model:any,variable:string,h:string,source=rows)=>summarizeHourlyHistoricalEvidence(source,{modelName:model.name,modelId:model.modelId,variable,horizonBucket:h,beforeDate:a.today,periodStartDate:startDate,historyAvailable:a.available});
 const metrics=OFFICIAL_HOURLY_MODELS.flatMap(model=>variables.map(([variable,variableLabel,unit])=>{
  const s=summarize(model,variable,horizon.id),qualified=s.status==='qualified'&&complete;
  const trend=summarizeHourlyHistoricalEvidence(trendRows,{modelName:model.name,modelId:model.modelId,variable,horizonBucket:horizon.id,beforeDate:a.today,historyAvailable:trendArchive.available}).trend;
  return {...s,modelId:model.modelId,variableLabel,unit,horizonId:horizon.id,horizonLabel:horizon.label,status:!a.available?'history_unavailable':!complete&&s.metrics?'incomplete_metrics':s.status,reason:!a.available?'Les archives vérifiées ne peuvent pas être lues.':!complete?'Lecture partielle ou fichier rejeté dans la période sélectionnée : aucune qualification n’est publiée.':s.status==='no_evidence'?(variable==='wind_speed'||variable==='wind_gust'?'La hauteur et la période de mesure des capteurs publics ne sont pas documentées : aucune comparaison à 10 m n’est qualifiée.':variable==='rain_liquid_1h'?'Aucune comparaison vérifiée sur une même fenêtre de pluie liquide de 60 minutes, avec prévision reçue avant son début.':variable==='pressure_msl'?'Aucune comparaison vérifiée avec au moins trois pressions au niveau de la mer mesurées à moins de cinq minutes de la même échéance.':'Aucune comparaison vérifiée pour ce modèle, cette variable et cette échéance.'):s.status==='insufficient_evidence'?`Seuil non atteint : ${s.metrics!.comparisonCount}/30 comparaisons, ${s.metrics!.evaluatedDays}/7 dates distinctes.`:null,metrics:qualified?s.metrics:null,rawMetrics:s.metrics,rawValidated:true,legacyUnversionedRowCount:0,trend:trendComplete?trend:{...trend,status:'history_unavailable',delta:null,reason:'Évolution indisponible : lecture partielle ou indisponible des fenêtres de tendance, distinctes de la période sélectionnée.'}};
 }));
 const note=(source:HourlyHistoricalScoreRow[],keys:string[])=>{
  const qualified=complete?OFFICIAL_HOURLY_MODELS.flatMap(m=>keys.map(v=>summarize(m,v,horizon.id,source))).filter(s=>s.status==='qualified'&&s.metrics):[];
  const dates=new Set(source.filter(r=>r.date>=startDate&&r.date<=endDate&&r.horizonBucket===horizon.id&&qualified.some(s=>s.modelName===r.modelName&&s.variable===r.variable)).map(r=>r.date));
  return {mae:complete&&qualified.length?mean(qualified.map(s=>s.metrics!.mae)):null,comparisonCount:qualified.reduce((n,s)=>n+s.metrics!.comparisonCount,0),evaluatedDays:dates.size,qualifiedCells:qualified.length};
 };
 const provisional=(source:HourlyHistoricalScoreRow[],keys:string[])=>{
  const cells=OFFICIAL_HOURLY_MODELS.flatMap(m=>keys.map(v=>summarize(m,v,horizon.id,source))).filter(s=>s.metrics);
  const dates=new Set(source.filter(r=>r.date>=startDate&&r.date<=endDate&&r.horizonBucket===horizon.id&&keys.includes(r.variable)).map(r=>r.date));
  return {mae:cells.length?mean(cells.map(s=>s.metrics!.mae)):null,comparisonCount:cells.reduce((n,s)=>n+s.metrics!.comparisonCount,0),evaluatedDays:dates.size,modelCount:new Set(cells.map(s=>s.modelName)).size,partialArchive:!complete};
 };
 const hourlyByTime=new Map(scoped.flatMap(d=>d.hourly[horizon.id]).map(p=>[p.validAt,p]));
 const dailyByDate=new Map(scoped.flatMap(d=>d.daily[horizon.id]?[d.daily[horizon.id]]:[]).map(p=>[p.date,p]));
 const hourlyStart=getDailyForecastValidTime(shift(periods[period]===1?startDate:shift(a.today,-2),-1))!,hourlyEnd=getDailyForecastValidTime(endDate)!;
 // Les heures et dates manquantes sont explicites : les courbes ne doivent pas relier deux relevés à travers une lacune.
 const hourlyPoints=Array.from({length:Math.round((hourlyEnd-hourlyStart)/HOUR)},(_,i)=>{const validAt=hourlyStart+i*HOUR;return hourlyByTime.get(validAt)??{validAt,hour:getParisDateAndHour(validAt)!.hour,label:new Date(validAt).toLocaleString('fr-FR',{timeZone:'Europe/Paris',day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'}),stationTemperature:null,officialTemperature:null,stationPrecipitation:null,officialPrecipitation:null,stationSampleCount:0};});
 const dailyPoints=Array.from({length:periods[period]},(_,i)=>{const date=shift(startDate,i);return dailyByDate.get(date)??{date,label:date.slice(8)+'/'+date.slice(5,7),stationTemperature:null,officialTemperature:null,stationSampleCount:0};});
 return {locationKey:LOCATION,period:{id:period,startDate,endDate},selectedHorizon:{...horizon,exactWindow:true},
  evidence:{status:a.available?'available':'history_unavailable',source:'signed_learning_days',expectedModelCount:models.size,includedModels:Array.from(models.keys()),bestMatchIncluded:false,variables:variables.map(([key,label,unit])=>({key,label,unit})),...PUBLIC_RANKING_EVIDENCE_THRESHOLDS,recomputedScoreRows:scoped.reduce((n,d)=>n+d.scores.length,0),note:'Archives serveur signées, journées closes Europe/Paris. Les métriques brutes restent visibles avant qualification. Notes indicatives limitées aux températures, calculées seulement sur des cellules qualifiées ; les modèles ont le même poids dans cette synthèse. Les échéances horaires partent du cycle fournisseur ; les échéances quotidiennes vont de la disponibilité à la fin du jour local. Les historiques récupérés non qualifiés restent conservés séparément.',filesChecked:a.filesChecked,filesRejected:a.filesRejected,boundedRead:a.boundedRead},
  metrics,horizonEvidence:RELIABILITY_HORIZONS.map(h=>{const cells=OFFICIAL_HOURLY_MODELS.flatMap(m=>variables.map(([v])=>summarize(m,v,h.id)));return {id:h.id,label:h.label,status:a.available?'available':'history_unavailable',expectedCellCount:models.size*variables.length,qualifiedCellCount:complete?cells.filter(s=>s.status==='qualified').length:0,rawEvidenceCellCount:cells.filter(s=>s.metrics).length};}),
  notes:{hourly:note(rows,['temperature']),daily:note(dailyRows,['temperature_max','temperature_min']),provisionalHourly:provisional(rows,['temperature']),complete},
  trendEvidence:{complete:trendComplete,filesChecked:trendArchive.filesChecked,filesRejected:trendArchive.filesRejected,boundedRead:trendArchive.boundedRead},
  comparisons:{hourly:hourlyPoints,daily:dailyPoints,basis:'Moyenne des modèles archivés appariés, sans recalcul de la fusion officielle',hourlyWindow:periods[period]===1?'Dernière journée close':'Deux dernières journées closes, dans la période choisie',periodLabel:`${startDate} → ${endDate} · ${horizon.label}`},
  availability:{history:!a.available?'Historique indisponible':!complete?'Historique partiel : qualification suspendue':'Historique vérifié lisible',dailyHorizon:'Minima et maxima quotidiens : disponibilité de la prévision vers la fin du jour local.',selectedHorizon:'Fenêtre exacte recalculée depuis les comparaisons vérifiées, sans bucket voisin.',trend:'Évolution par modèle : 30 dernières journées closes contre les 30 précédentes, explicitement séparées de la période principale.',recompute:'Recalcul en lecture seule : aucune collecte, aucun doublon et aucune écriture.'}};
}
export async function readReliability(input:any,env:any,now=Date.now()){
 if(!Object.hasOwn(periods,input?.period??'7d')||!RELIABILITY_HORIZONS.some(h=>h.id===(input?.horizon??'6-24h')))throw new ApiError('Période ou horizon de fiabilité invalide.');
 const coords=coordinates(input),covered=coords.lat===50.7567&&coords.lon===2.5204;
 const empty={available:false,days:[],filesRejected:0,filesChecked:0,boundedRead:false,today:getParisDateAndHour(now)!.date};
 const [a,trend]=covered?await Promise.all([archive(env,now,periods[input?.period??'7d']),archive(env,now,60)]):[empty,empty];
 const result=buildReliabilityReadModel(input,a,now,trend);
 if(!covered){result.locationKey=coords.lat.toFixed(3)+'_'+coords.lon.toFixed(3);result.availability.history='Aucune archive vérifiée pour ce lieu ; Hondeghem n’est jamais utilisé en remplacement.';}
 return result;
}
export async function readReliabilityYesterday(input:any,env:any,now=Date.now()){
 const coords=coordinates(input),date=shift(getParisDateAndHour(now)!.date,-1),empty=emptyYesterday(date);
 if(coords.lat!==50.7567||coords.lon!==2.5204)return {...empty,locationKey:coords.lat.toFixed(3)+'_'+coords.lon.toFixed(3),reason:'Aucune archive vérifiée pour ce lieu.'};
 const a=await archive(env,now,1);if(!a.available)return {...empty,reason:'Les archives de comparaison ne peuvent pas être lues.'};
 const result=a.days.find(d=>d.date===date)?.yesterday??empty;
 return {...result,meteoai:await readFusionVerificationStatus(date,env,now)};
}

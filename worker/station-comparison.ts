import {buildPhysicalReferences} from './physical-references';
import {OFFICIAL_HOURLY_MODELS} from '../server/officialModels';
import {getParisDateAndHour} from '../server/parisHourlyTime';
import {getDailyForecastValidTime} from '../server/dailyForecastVerification';

const HOUR=3600000,DAY=24*HOUR;
const models=new Map<string,string>(OFFICIAL_HOURLY_MODELS.map(m=>[m.name,m.modelId]));
const mean=(v:number[])=>v.length?v.reduce((sum,n)=>sum+n,0)/v.length:null;
const shift=(date:string,days:number)=>new Date(Date.parse(date+'T12:00:00Z')+days*DAY).toISOString().slice(0,10);
const label=(at:number)=>new Intl.DateTimeFormat('fr-FR',{timeZone:'Europe/Paris',day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit',timeZoneName:'shortOffset'}).format(new Date(at));
export function stationComparisonWindow(now:number){
 const end=Math.floor(now/HOUR)*HOUR,today=getParisDateAndHour(now)!.date;
 return {start:getDailyForecastValidTime(shift(today,-7))!,end,today};
}

/** Comparaison descriptive : un créneau UTC, une observation spatiale et une
 * valeur par modèle reçu avant le début du créneau. Aucune fusion reconstituée. */
export function buildStationComparison(history:any,forecast:any,radiusKm:number,now=Date.now()){
 const {start,end,today}=stationComparisonWindow(now);
 const rows=(history?.rows??[]).filter((r:any)=>r.distance<=Math.min(radiusKm,20)&&r.measuredAt>=start&&r.measuredAt<end);
 const physical=buildPhysicalReferences(rows.map((r:any)=>({station_key:r.stationKey,measured_at:r.measuredAt,received_at:r.receivedAt,temperature:r.temperature,distance:r.distance,elevation:r.elevation,quality_flags:JSON.stringify(r.flags),source:'netatmo_server'})),now,'netatmo_server');
 const observed=new Map(physical.references.map(r=>[r.validTime,r]));
 const forecasts=new Map<number,Map<string,any[]>>();
 for(const v of forecast?.values??[]){
  if(models.get(v.modelName)!==v.modelId||v.variable!=='temperature'||!Number.isFinite(v.value)||!Number.isSafeInteger(v.validTime)||v.validTime%HOUR!==0||v.validTime<start||v.validTime>=end||!Number.isSafeInteger(v.availableAt)||v.availableAt>=v.validTime||v.availableAt>now)continue;
  const byModel=forecasts.get(v.validTime)??new Map<string,any[]>(),group=byModel.get(v.modelId)??[];
  group.push(v);byModel.set(v.modelId,group);forecasts.set(v.validTime,byModel);
 }
 const hourly=Array.from({length:Math.round((end-start)/HOUR)},(_,i)=>{
  const validAt=start+i*HOUR,reference=observed.get(validAt),values:number[]=[];
  for(const group of forecasts.get(validAt)?.values()??[]){
   group.sort((a,b)=>b.availableAt-a.availableAt||b.providerRunAt-a.providerRunAt);
   const latest=group[0];
   if(group.some(v=>v.availableAt===latest.availableAt&&v.value!==latest.value))continue;
   values.push(latest.value);
  }
  return {validAt,hour:getParisDateAndHour(validAt)!.hour,label:label(validAt),stationTemperature:reference?.temperature??null,stationSampleCount:reference?.stations??0,officialTemperature:mean(values),modelCount:values.length};
 });
 const daily=Array.from({length:7},(_,i)=>{
  const date=shift(today,i-6),points=hourly.filter(p=>getParisDateAndHour(p.validAt)?.date===date&&p.stationTemperature!==null&&p.officialTemperature!==null);
  return {date,label:date.slice(8)+'/'+date.slice(5,7),stationTemperature:mean(points.map(p=>p.stationTemperature!)),officialTemperature:mean(points.map(p=>p.officialTemperature!)),stationSampleCount:points.reduce((sum,p)=>sum+p.stationSampleCount,0),pairedHours:points.length};
 });
 const lastDay=hourly.filter(p=>p.validAt>=end-24*HOUR),pairs=lastDay.filter(p=>p.stationTemperature!==null&&p.officialTemperature!==null),latest=pairs.at(-1);
 const weekStart=getDailyForecastValidTime(shift(today,-6))!;
 const summary=(points:typeof hourly)=>{
  const pair=points.filter(p=>p.stationTemperature!==null&&p.officialTemperature!==null).at(-1);
  return {deltaC:pair?pair.stationTemperature!-pair.officialTemperature!:null,validAt:pair?.validAt??null};
 };
 const unavailable=!history||!forecast,partial=!!(history?.boundedRead||history?.rejectedArchives||history?.conflictingMeasurements||forecast?.boundedRead||forecast?.filesRejected);
 return {comparison24h:lastDay,comparison7d:daily,instantDeltaC:latest?latest.stationTemperature!-latest.officialTemperature!:null,latestPairAt:latest?.validAt??null,
  comparisonSummary24h:summary(lastDay),comparisonSummary7d:summary(hourly.filter(p=>p.validAt>=weekStart)),
  comparisonStatus:unavailable?'unavailable':partial?'partial':pairs.length||daily.some(d=>d.pairedHours)?'available':'no_pairs',
  comparisonEvidence:{basis:'Moyenne des modèles archivés reçus avant le créneau ; pas une sortie fusionnée officielle',referenceRadiusKm:Math.min(radiusKm,20),minimumStations:3,closedHoursOnly:true,forecastFilesChecked:forecast?.filesChecked??0,forecastFilesRejected:forecast?.filesRejected??0,boundedRead:!!(history?.boundedRead||forecast?.boundedRead),pairedHours24h:pairs.length,pairedHours7d:daily.reduce((sum,p)=>sum+p.pairedHours,0)},
 };
}

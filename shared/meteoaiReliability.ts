/** Notes descriptives de température, distinctes des probabilités et de la calibration. */
export type MeteoAIPair = {kind:'hourly'|'daily';date:string;variable:'temperature'|'temperature_min'|'temperature_max';validAt:number;availableAt:number;observedAt:number;forecast:number;observed:number;forecastOrigin?:'server'|'application'};
export type MeteoAIDay = {date:string;pairs:MeteoAIPair[]};
export function summarizeMeteoAIReliability(days:MeteoAIDay[],complete=true){
 const pairs=days.flatMap(d=>d.pairs),measure=(kind:'hourly'|'daily')=>{
  const rows=pairs.filter(p=>p.kind===kind),n=rows.length,dates=new Set(rows.map(p=>p.date));
  const mae=n?rows.reduce((sum,p)=>sum+Math.abs(p.forecast-p.observed),0)/n:null;
  const qualified=complete&&n>=30&&dates.size>=7;
  return {note:complete&&mae!==null?Math.max(0,Math.min(10,10-2*mae)):null,mae,comparisonCount:n,evaluatedDays:dates.size,qualified};
 };
 const hourly=measure('hourly'),daily=measure('daily'),dates=days.filter(d=>d.pairs.length).map(d=>d.date).sort();
 const known=[hourly.note,daily.note].filter((n):n is number=>n!==null);
 return {version:1 as const,basis:'archived_meteoai_vs_physical_observations' as const,scope:'all_archived_history' as const,complete,available:true,status:dates.length?'available':'collecting',hourly,daily,applicationComparisonCount:pairs.filter(p=>p.forecastOrigin==='application').length,
  global:{note:known.length?known.reduce((sum,n)=>sum+n,0)/known.length:null,qualified:hourly.qualified&&daily.qualified,partial:known.length===1},
  startDate:dates[0]??null,endDate:dates.at(-1)??null,minimumComparisons:30,minimumComparableDays:7,unit:'°C',
  method:'Températures : 10 − 2 × MAE (°C), entre 0 et 10. Globale : moyenne à parts égales des notes horaire et quotidienne disponibles. Une seule composante donne une globale partielle. Note provisoire avant 30 comparaisons et 7 dates distinctes par composante. Ce n’est pas une probabilité.',
  reason:!complete?'Lecture historique partielle : les notes sont suspendues.':dates.length?'Seules les prévisions MeteoAI archivées avant le début de leur échéance sont comparées aux observations physiques vérifiées.':'Les anciennes archives des modèles ne permettent pas de noter MeteoAI. Les prévisions MeteoAI sont désormais conservées pour être comparées après leur échéance.'};
}

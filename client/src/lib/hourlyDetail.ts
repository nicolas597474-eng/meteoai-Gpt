import type {DashboardFusionTrace} from '@shared/dashboardFusionTrace';

type Target={date?:string|null;hour:string;validAt?:number};
export function formatHourlyDetailNumber(value:number|null|undefined,digits=1):string {
  return typeof value==='number'&&Number.isFinite(value)?new Intl.NumberFormat('fr-FR',{maximumFractionDigits:digits}).format(value):'—';
}
/** L’instant absolu distingue notamment les deux heures du passage à l’heure d’hiver. */
export function hourlyDetailKey(hour:Target):string {
  return Number.isFinite(hour.validAt)?`instant:${hour.validAt}`:`local:${hour.date??'unknown'}/${hour.hour}`;
}
export function selectedHourlyDetailIndex(hours:readonly Target[],target:string|null):number|null {
  if(target===null)return null;
  const index=hours.findIndex(hour=>hourlyDetailKey(hour)===target);
  return index<0?null:index;
}
export function findHourlyDetailTrace(points:DashboardFusionTrace,validAt:number|undefined) {
  return Number.isFinite(validAt)?points.find(point=>point.validAt===validAt)??null:null;
}
export function hourlyDetailTemperature(hour:{temp:number|null;multiModelMetrics?:{temperature:{weightedMean:number|null}}|null},trace:DashboardFusionTrace[number]|null,hasStationMeasurement:boolean):number|null {
  const temperature=trace?.variables.find(row=>row.key==='temperature');
  // Une absence attestée reste une absence ; la mesure Netatmo du point actuel
  // n’est jamais présentée comme la prévision du modèle.
  if(temperature)return temperature.value;
  if(hour.multiModelMetrics)return hour.multiModelMetrics.temperature.weightedMean;
  return hasStationMeasurement?null:hour.temp;
}
export function formatHourlyDetailDate(hour:Target):string {
  if(!Number.isFinite(hour.validAt))return `${hour.date??'Date indisponible'} · ${hour.hour} (Paris)`;
  return new Intl.DateTimeFormat('fr-FR',{timeZone:'Europe/Paris',weekday:'short',day:'numeric',month:'short',hour:'2-digit',minute:'2-digit',timeZoneName:'short'}).format(hour.validAt);
}

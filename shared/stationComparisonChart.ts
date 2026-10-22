export type StationComparisonPoint={hour?:number;label?:string;validAt?:number|null;stationTemperature:number|null;officialTemperature:number|null;stationSampleCount:number};
const WIDTH=560,HEIGHT=168,PADDING=16,BASELINE=HEIGHT-24;
/** L'axe conserve toutes les positions temporelles. Une valeur absente coupe
 * la série ; un zéro mesuré reste un point, jamais une lacune. */
export function stationChartGeometry(points:StationComparisonPoint[],periodDays:1|7){
 const values=points.flatMap(p=>[p.stationTemperature,p.officialTemperature]).filter((v):v is number=>typeof v==='number'&&Number.isFinite(v));
 const min=values.length?Math.floor(Math.min(...values)-1):0,max=values.length?Math.ceil(Math.max(...values)+1):1;
 const x=(i:number)=>PADDING+i*(WIDTH-2*PADDING)/Math.max(points.length-1,1);
 const y=(v:number)=>PADDING+(1-(v-min)/Math.max(1,max-min))*(BASELINE-PADDING);
 const segments=(field:'stationTemperature'|'officialTemperature')=>{
  const groups:string[][]=[];let group:string[]=[];
  points.forEach((p,i)=>{const v=p[field];if(typeof v!=='number'||!Number.isFinite(v)){if(group.length)groups.push(group);group=[];}else group.push(`${x(i).toFixed(1)},${y(v).toFixed(1)}`);});
  if(group.length)groups.push(group);return groups.map(g=>g.join(' '));
 };
 const count=Math.min(points.length,periodDays===1?4:7);
 const labels=Array.from(new Set(Array.from({length:count},(_,i)=>Math.round(i*(points.length-1)/Math.max(1,count-1))))).map(i=>{
  const p=points[i],title=p.label??`${String(p.hour??0).padStart(2,'0')}h`;
  const parts=p.validAt==null?null:new Intl.DateTimeFormat('fr-FR',{timeZone:'Europe/Paris',day:'2-digit',month:'2-digit',hour:'2-digit',hourCycle:'h23'}).formatToParts(new Date(p.validAt));
  const part=(type:string)=>parts?.find(p=>p.type===type)?.value;
  return {index:i,x:x(i),title,text:parts?`${part('day')}/${part('month')} ${part('hour')}h`:title,anchor:i===0?'start' as const:i===points.length-1?'end' as const:'middle' as const};
 });
 return {width:WIDTH,height:HEIGHT,temperature:segments('stationTemperature'),forecast:segments('officialTemperature'),labels,
  isolated:(field:'stationTemperature'|'officialTemperature')=>points.flatMap((p,i)=>{const v=p[field];return typeof v==='number'&&Number.isFinite(v)&&!Number.isFinite(points[i-1]?.[field])&&!Number.isFinite(points[i+1]?.[field])?[{x:x(i),y:y(v)}]:[];}),
  hasPairs:points.some(p=>typeof p.stationTemperature==='number'&&Number.isFinite(p.stationTemperature)&&typeof p.officialTemperature==='number'&&Number.isFinite(p.officialTemperature)),
 };
}

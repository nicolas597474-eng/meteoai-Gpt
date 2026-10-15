import { useId } from 'react';
import { ArrowUpRight, Droplets, Navigation, Wind } from 'lucide-react';
import type { FusedHour, DayForecast } from '../types';
import { dayLabel, number, shortHour } from '../lib/format';
import { WeatherIcon } from './WeatherIcon';

export function Sparkline({values,color='currentColor'}:{values:(number|null)[];color?:string}) {
  const v=values.filter((n):n is number=>n!=null&&Number.isFinite(n));if(v.length<2)return <span className="sparkline-empty">Tendance indisponible</span>;
  const min=Math.min(...v),range=Math.max(...v)-min||1;
  return <svg className="sparkline" viewBox="0 0 130 34" aria-hidden="true"><path d={v.map((n,i)=>`${i?'L':'M'}${i/(v.length-1)*128+1},${30-(n-min)/range*25}`).join(' ')} fill="none" stroke={color} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"/></svg>;
}

export function HourlyChart({hours,onSelect}:{hours:FusedHour[];onSelect:(h:FusedHour)=>void}) {
  const id=useId().replace(/:/g,'');
  if(!hours.length)return <div className="chart-placeholder"><div className="skeleton-line"/><span>Les modèles dessinent les prochaines heures…</span></div>;
  const values=hours.flatMap(h=>[h.temp,h.feels]).filter((n):n is number=>n!=null), min=(values.length?Math.min(...values):0)-2,max=(values.length?Math.max(...values):20)+2;
  const width=1000,height=210,pad=30,x=(i:number)=>pad+i/(hours.length-1||1)*(width-pad*2),y=(v:number)=>155-(v-min)/(max-min)*120;
  const line=(field:'temp'|'feels')=>{let start=true;return hours.map((h,i)=>{if(h[field]==null){start=true;return '';}const command=`${start?'M':'L'}${x(i)} ${y(h[field]!)}`;start=false;return command;}).join(' ');};
  const tempPath=line('temp'),validTemps=hours.filter(h=>h.temp!=null),maxRain=Math.max(2,...hours.map(h=>h.rain??0));
  const area=hours.every(h=>h.temp!=null)?`${tempPath} L${x(hours.length-1)} 188 L${x(0)} 188Z`:'';
  return <div className="hourly-scroll"><div className="hourly-chart"><svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Température, ressenti et précipitations sur les prochaines 24 heures"><defs><linearGradient id={`area-${id}`} x1="0" y1="0" x2="0" y2="1"><stop stopColor="#efc6a1" stopOpacity=".17"/><stop offset="1" stopColor="#efc6a1" stopOpacity="0"/></linearGradient></defs>
    {[0,1,2].map(i=><g key={i}><line x1={pad} y1={40+i*53} x2={width-pad} y2={40+i*53} stroke="rgba(210,226,231,.09)" strokeDasharray="3 5"/><text x={width-5} y={44+i*53} textAnchor="end" fill="#acbdc7" fontSize="10">{number(max-(max-min)*(i*53+5)/120)}°</text></g>)}
    {hours.map((h,i)=>h.rain!=null&&h.rain>.01?<rect key={i} x={x(i)-5} y={189-h.rain/maxRain*55} width="10" height={h.rain/maxRain*55} rx="3" fill="#8bb7cf" opacity=".55"/>:null)}
    {area&&<path d={area} fill={`url(#area-${id})`}/>}<path d={line('feels')} fill="none" stroke="#a1bfc0" strokeWidth="1.5" strokeDasharray="4 5"/><path d={tempPath} fill="none" stroke="#f0c6a2" strokeWidth="2.7" strokeLinecap="round" strokeLinejoin="round"/>
    {hours.map((h,i)=><g key={h.time}>{i%3===0&&h.temp!=null&&<><circle cx={x(i)} cy={y(h.temp)} r="3.5" fill="#efc6a1" stroke="#354b5c" strokeWidth="2"/><text x={x(i)} y={y(h.temp)-13} textAnchor="middle" fill="#f3ece2" fontSize="13">{number(h.temp)}°</text></>}<rect x={x(i)-22} y="0" width="44" height="210" fill="transparent" className="chart-hit" onClick={()=>onSelect(h)}/></g>)}
  </svg><div className="hourly-labels">{hours.map((h,i)=><button key={h.time} onClick={()=>onSelect(h)} aria-label={`Détails météo à ${shortHour(h.time)}`}><span>{i===0?'Maintenant':shortHour(h.time)}</span><WeatherIcon code={h.code} size={23}/><span className="hour-wind"><Navigation size={10} style={{transform:`rotate(${(h.direction??0)+180}deg)`}}/>{number(h.wind)} <small>km/h</small></span></button>)}</div></div><span className="sr-only">{validTemps.length} températures disponibles. Les boutons horaires ouvrent toutes les données.</span></div>;
}

export function DailyList({days,onSelect}:{days:DayForecast[];onSelect:(d:DayForecast)=>void}) {
  const temps=days.flatMap(d=>[d.min,d.max]).filter((v):v is number=>v!=null), low=temps.length?Math.min(...temps):0,high=temps.length?Math.max(...temps):20,range=high-low||1;
  return <div className="daily-list">{days.map((day,i)=><button key={day.date} className="daily-row" onClick={()=>onSelect(day)}><span className="daily-day">{i===0?'Aujourd’hui':i===1?'Demain':dayLabel(day.date)}</span><WeatherIcon code={day.code} size={24}/><span className="daily-rain"><Droplets size={12}/>{number(day.rain,1)}<small>mm</small></span><span className="daily-min">{number(day.min)}°</span><span className="daily-range"><i style={{left:`${((day.min??low)-low)/range*70}%`,width:`${Math.max(7,((day.max??high)-(day.min??low))/range*70)}%`}}/></span><span className="daily-max">{number(day.max)}°</span><span className="daily-wind"><Wind size={13}/>{number(day.wind)}</span><ArrowUpRight size={13} className="daily-open"/></button>)}</div>;
}

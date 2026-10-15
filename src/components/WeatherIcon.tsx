import { Cloud, CloudDrizzle, CloudFog, CloudLightning, CloudRain, CloudSnow, CloudSun, Moon, Sun } from 'lucide-react';
import { weatherKind } from '../lib/format';
export function WeatherIcon({code, night, size=24, className=''}:{code:number|null;night?:boolean;size?:number;className?:string}) {
  const nowHour=Number(new Intl.DateTimeFormat('en-GB',{hour:'2-digit',hourCycle:'h23',timeZone:'Europe/Paris'}).format(Date.now()));
  night=night??(nowHour<7||nowHour>=20);
  const kind=weatherKind(code), Icon=kind==='sun'?(night?Moon:Sun):kind==='partly'?CloudSun:kind==='rain'?(code!=null&&code<60?CloudDrizzle:CloudRain):kind==='snow'?CloudSnow:kind==='storm'?CloudLightning:kind==='fog'?CloudFog:Cloud;
  return <Icon size={size} strokeWidth={1.35} className={`weather-icon weather-icon--${kind} ${className}`} aria-hidden="true"/>;
}
export function CloudArt({code}:{code:number|null}) {
  const kind=weatherKind(code);
  const currentHour=Number(new Intl.DateTimeFormat('en-GB',{hour:'2-digit',hourCycle:'h23',timeZone:'Europe/Paris'}).format(Date.now())),night=currentHour<7||currentHour>=20;
  return <svg className={`cloud-art cloud-art--${kind}`} viewBox="0 0 400 240" aria-hidden="true">
    <defs><radialGradient id="sun-art"><stop stopColor="#ffe6b5"/><stop offset=".8" stopColor="#f4c08e"/><stop offset="1" stopColor="#dba77b"/></radialGradient><linearGradient id="cloud-art" x1="0" y1="0" x2=".25" y2="1"><stop stopColor="#ecede7"/><stop offset=".45" stopColor="#bdc8ca"/><stop offset="1" stopColor="#657d8c"/></linearGradient><filter id="cloud-shadow" x="-50%" y="-50%" width="200%" height="200%"><feDropShadow dx="0" dy="15" stdDeviation="17" floodColor="#0b1b2e" floodOpacity=".25"/></filter><filter id="sun-glow"><feGaussianBlur stdDeviation="16"/></filter></defs>
    <circle cx="246" cy="89" r="67" fill={night?'#b5ccd8':'#f9ce98'} opacity=".2" filter="url(#sun-glow)"/><circle cx="246" cy="89" r="46" fill={night?'#c4d2d7':'url(#sun-art)'}/>
    <g className="cloud-art-main" filter="url(#cloud-shadow)"><path d="M76 155c-1-25 18-45 43-46 4-35 30-59 64-57 29 0 52 18 61 43 26-7 58 11 61 40 20-1 36 14 36 33 0 21-16 37-38 37H113c-28 0-48-17-48-40 0-4 5-9 11-10Z" fill="url(#cloud-art)"/><path d="M100 142c8-14 24-18 39-13 1-29 23-51 51-50" fill="none" stroke="#fff" strokeWidth="2" opacity=".28" strokeLinecap="round"/></g>
    {(kind==='rain'||kind==='storm')&&<g stroke="#94c5d9" strokeWidth="3" strokeLinecap="round" opacity=".8"><path d="m133 217-6 12m50-12-6 12m50-12-6 12m50-12-6 12"/></g>}
  </svg>;
}

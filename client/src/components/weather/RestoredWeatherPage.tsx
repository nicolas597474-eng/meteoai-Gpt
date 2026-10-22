import type {ReactNode} from 'react';
import type {LucideIcon} from 'lucide-react';
import {usePageWeatherSky} from '@/hooks/usePageWeatherSky';

/** Les pages restaurées reprennent le ciel et les composants de Prévisions. */
export function RestoredWeatherPage({children,className}:{children:ReactNode;className?:string}){
 const {style}=usePageWeatherSky();
 return <div className="weather-page-sky restoration-weather-page min-h-dvh w-full overflow-x-clip" style={style}><main className={className}>{children}</main></div>;
}

/** Même en-tête que « Heure par heure » : pastille bleue et texte blanc. */
export function RestoredCardTitle({icon:Icon,title,description,level=2}:{icon:LucideIcon;title:string;description?:string;level?:1|2}){
 const Heading=level===1?'h1':'h2';
 return <div className="mb-3 flex items-center gap-2.5"><span aria-hidden="true" className="weather-icon-bare flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-blue-300/55 bg-blue-500/25"><Icon className="h-4 w-4 text-blue-200"/></span><div><Heading className="text-base font-bold text-white">{title}</Heading>{description&&<p className="text-[11px] font-normal text-slate-400">{description}</p>}</div></div>;
}

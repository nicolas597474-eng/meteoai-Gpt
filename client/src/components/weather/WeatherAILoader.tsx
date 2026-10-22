import {cn} from '@/lib/utils';

export interface WeatherAILoaderProps {
 loading:boolean;
 message?:string;
 variant?:'full'|'light'|'compact';
 className?:string;
}

/** Attente transparente : la navigation reste disponible, sans scène ni minuterie. */
export function WeatherAILoader({loading,message='Chargement de la météo',className}:WeatherAILoaderProps){
 if(!loading)return null;
 return <div role="status" aria-live="polite" aria-busy="true" className={cn('weather-page-pending min-h-[60vh]',className)}>
  <span className="sr-only">{message}</span>
 </div>;
}

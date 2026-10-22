import superjson from 'superjson';
import type {LiveComparison} from '@shared/liveModelComparison';

/** Même transport et cache que le comparatif AI Lab et le Dashboard. */
export async function collectLiveModelComparison(lat:number,lon:number):Promise<LiveComparison>{
 const {collectControlWeather}=await import('./controlWeather');
 const response=await collectControlWeather('/api/trpc/weather.getModelComparison?input='+encodeURIComponent(JSON.stringify({json:{lat,lon}})));
 const body=await response?.json();
 if(!body?.result?.data)throw new Error(body?.error?.json?.message??'Collecte des modèles indisponible');
 return superjson.deserialize<LiveComparison>(body.result.data);
}

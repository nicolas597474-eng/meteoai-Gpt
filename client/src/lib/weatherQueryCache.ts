import type {QueryClient} from '@tanstack/react-query';

/** Même clé que le transport météo : le comparatif participe aux mises à jour du cache. */
export const liveComparisonQueryKey=(lat:number,lon:number)=>[['weather','getModelComparison'],{input:{lat,lon},type:'query'}] as const;
export const MODEL_COMPARISON_REFRESH_MS=5*60_000;
export function invalidateWeatherQueries(client:QueryClient,name?:string){
 return client.invalidateQueries({predicate:query=>{
  const path=Array.isArray(query.queryKey[0])?query.queryKey[0].join('.'):'';
  return name?path===name:path.startsWith('weather.');
 }});
}
/** Au retour d’onglet, ne relance que les lectures météo actives âgées de cinq minutes. */
export function refreshVisibleWeatherQueries(client:QueryClient,now=Date.now()){
 return client.invalidateQueries({refetchType:'active',predicate:query=>{
  const path=Array.isArray(query.queryKey[0])?query.queryKey[0].join('.'):'';
  return (path.startsWith('weather.')||['favorites.getLocationWeather','favorites.getCurrentDashboardWeather'].includes(path))&&query.getObserversCount()>0&&query.state.fetchStatus!=='fetching'&&now-query.state.dataUpdatedAt>=300000;
 }});
}

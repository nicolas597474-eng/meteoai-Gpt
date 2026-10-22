import type {ProviderRateLimit} from '../server/providerRateLimit';
import type {WeatherQuotaStore} from '../server/openMeteoQuota';
export function serverWeatherQuota(env:any):WeatherQuotaStore{
 const reads=new Map<LearningProvider,Promise<ProviderRateLimit|null>>();
 return {read(provider){if(!reads.has(provider))reads.set(provider,readLearningProviderLimit(env,provider));return reads.get(provider)!;},async write(provider,limit){await recordLearningProviderLimit(env,provider,limit);reads.set(provider,Promise.resolve(await readLearningProviderLimit(env,provider)));}};
}
export type LearningProvider = 'forecast'|'single_runs';
const channel = (provider: LearningProvider) => 'learning_open_meteo_limit_v1/' + provider;

/** Partagé entre appareils et isolats du Site ; aucune clé ou réponse brute. */
export async function readLearningProviderLimit(env: any, provider: LearningProvider, now = Date.now()): Promise<ProviderRateLimit|null> {
  const row = await env.DB.prepare('SELECT message FROM weather_collection_status WHERE channel=?').bind(channel(provider)).first();
  if (!row) return null;
  const value = JSON.parse(row.message);
  if (value.version !== 1 || !['minute','hour','day','unknown'].includes(value.period)
    || !Number.isSafeInteger(value.retryAt) || value.retryAt > now + 7 * 86400000) throw Error('Délai fournisseur invalide');
  return value.retryAt > now ? {period: value.period, retryAt: value.retryAt} : null;
}

/** Diagnostic seulement : un journal illisible n'invalide pas les archives météo.
 * Les collecteurs gardent la lecture stricte ci-dessus avant tout appel réseau. */
export async function readLearningProviderLimitStatus(env:any,now=Date.now()) {
  const limits:Array<ProviderRateLimit&{provider:LearningProvider}>=[];
  let available=true;
  for(const provider of ['forecast','single_runs'] as const){
    try{const limit=await readLearningProviderLimit(env,provider,now);if(limit)limits.push({provider,...limit});}
    catch{available=false;}
  }
  return {limits,available};
}
export async function recordLearningProviderLimit(env: any, provider: LearningProvider, limit: ProviderRateLimit, now = Date.now()) {
  if (!Number.isSafeInteger(limit.retryAt) || limit.retryAt <= now || limit.retryAt > now + 7 * 86400000
    || !['minute','hour','day','unknown'].includes(limit.period)) throw Error('Délai fournisseur invalide');
  await env.DB.prepare("INSERT INTO weather_collection_status(channel,attempted_at,status,message) VALUES (?,?,?,?) ON CONFLICT(channel) DO UPDATE SET attempted_at=excluded.attempted_at,status=excluded.status,message=excluded.message WHERE COALESCE(json_extract(weather_collection_status.message,'$.retryAt'),0)<?")
    .bind(channel(provider), new Date(now).toISOString(), 'rate_limited', JSON.stringify({version: 1, ...limit}), limit.retryAt).run();
}

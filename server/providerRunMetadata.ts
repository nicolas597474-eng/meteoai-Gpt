import {COMPOSITE_METADATA_IDS} from './providerRunCapabilities';
import {fetchWeather} from './weatherFetch';
import type {ProviderModelMetadata} from './providerRunHorizon';

const metadataUrl = (id: string) => `https://api.open-meteo.com/data/${encodeURIComponent(id)}/static/meta.json`;

/** Sources : contrôleur et registres GfsDomain/GemDomain du dépôt officiel Open-Meteo.
 * Les alias seamless sont conservés dans la requête Single Runs. À Hondeghem,
 * HRRR et les grilles régionales canadiennes ne couvrent pas le lieu.
 * https://github.com/open-meteo/open-meteo/blob/main/Sources/App/Controllers/ForecastapiController.swift
 * Aucun cycle n'est extrapolé depuis l'heure actuelle ou la fréquence des sorties.
 */
export function resolveCompositeRunMetadata(id: string, input: ProviderModelMetadata | null, now: number): {
  metadata: ProviderModelMetadata | null; reasonCode: string | null;
} {
  const expected = COMPOSITE_METADATA_IDS[id], rows = input?.components;
  const invalid = (reasonCode: string) => ({metadata: null, reasonCode});
  if (!expected || !Array.isArray(rows) || rows.length !== expected.length
    || new Set(rows.map(row => row.modelId)).size !== expected.length
    || expected.some(component => !rows.some(row => row.modelId === component))) return invalid('component_metadata_missing');
  const second = now / 1000;
  let active = rows;
  if (id === 'gem_seamless') {
    const current = rows.find(row => row.modelId === 'cmc_gem_gdps_15km')!.metadata;
    // La génération GDPS retirée reste publiée dans /data. Son horizon révolu
    // prouve qu'elle ne peut fournir aucune échéance future de cette capture.
    active = rows.filter(row => row.modelId !== 'cmc_gem_gdps'
      || !(Number.isSafeInteger(row.metadata.data_end_time) && Number(row.metadata.data_end_time) < second
        && Number(row.metadata.last_run_initialisation_time) < Number(current.last_run_initialisation_time)
        && Number.isSafeInteger(row.metadata.last_run_availability_time)
        && Number(row.metadata.last_run_availability_time) <= second));
  }
  for (const {metadata: m} of active) {
    const run = m.last_run_initialisation_time, available = m.last_run_availability_time, interval = m.update_interval_seconds;
    if (!Number.isSafeInteger(run) || !Number.isSafeInteger(available) || !Number.isSafeInteger(interval)
      || Number(run) <= 0 || Number(interval) <= 0 || Number(run) > Number(available) || Number(available) > second
      || second - Number(available) > 2 * Number(interval)
      || !Number.isSafeInteger(m.data_end_time) || Number(m.data_end_time) <= second) return invalid('component_metadata_missing_or_stale');
  }
  let run = active[0].metadata.last_run_initialisation_time;
  const differentCycles = active.some(row => row.metadata.last_run_initialisation_time !== run);
  if (differentCycles && id !== 'ukmo_seamless') return invalid('component_cycles_not_aligned');
  // UKV est horaire, UKMO global toutes les six heures. Single Runs applique
  // options.run à chaque composante (contrôleur officiel, lignes 327-330).
  // Le run le plus ancien est réellement annoncé par une composante ; il est
  // explicitement demandé à toutes. Une réponse ne peut donc pas mélanger
  // leurs derniers cycles. Leur dernière publication sert seulement de borne
  // prudente, jamais de date de publication exacte de cet ancien run.
  if (differentCycles) run = Math.min(...active.map(row => Number(row.metadata.last_run_initialisation_time)));
  return {metadata: {
    last_run_initialisation_time: run,
    last_run_availability_time: Math.max(...active.map(row => Number(row.metadata.last_run_availability_time))),
    update_interval_seconds: Math.min(...active.map(row => Number(row.metadata.update_interval_seconds))),
    ...(differentCycles ? {metadataPublicationBasis: 'component_upper_bound' as const} : {}),
  }, reasonCode: null};
}

/** Un fichier par grille, avec déduplication/cache réseau existants. Une erreur
 * de composante invalide le composite, sans empêcher les autres modèles.
 */
export async function collectProviderModelMetadata(modelId: string) {
  const ids = COMPOSITE_METADATA_IDS[modelId] ?? [modelId];
  const results = await Promise.all(ids.map(async id => {
    const url = metadataUrl(id);
    try {
      const response = await fetchWeather(url, {}, {timeoutMs: 6000, attempts: 1, cacheTtlMs: 5*60000});
      if (!response.ok) return {url, httpStatus: response.status, metadata: null, reasonCode: 'official_metadata_http_error'};
      const json: unknown = await response.json();
      if (!json || typeof json !== 'object' || Array.isArray(json)) return {url, httpStatus: response.status, metadata: null, reasonCode: 'official_metadata_invalid_json'};
      return {url, httpStatus: response.status, metadata: json as ProviderModelMetadata, reasonCode: null};
    } catch { return {url, httpStatus: null, metadata: null, reasonCode: 'official_metadata_request_failed'}; }
  }));
  const failed = results.find(result => !result.metadata);
  if (failed) return {...failed, metadata: null};
  const metadata: ProviderModelMetadata = COMPOSITE_METADATA_IDS[modelId]
    ? {components: results.map((result, index) => ({modelId: ids[index], metadata: result.metadata!}))}
    : results[0].metadata!;
  return {metadata, url: results[0].url, httpStatus: 200, reasonCode: null};
}

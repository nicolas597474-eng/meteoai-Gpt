import {afterEach, describe, expect, it, vi} from 'vitest';
import {COMPOSITE_METADATA_IDS} from './providerRunCapabilities';
import {resolveCompositeRunMetadata, collectProviderModelMetadata} from './providerRunMetadata';
import {buildSingleRunRequestUrl, resolveProviderRunSelection, structurallyValidProviderRunValue} from './providerRunHorizon';
import {collectProviderRunBatch} from './providerRunCollection';
import {resetWeatherFetchCache} from './weatherFetch';

const now = Date.parse('2026-10-19T13:30:00Z'), run = Date.parse('2026-10-19T06:00:00Z') / 1000;
const available = Date.parse('2026-10-19T12:30:00Z') / 1000;
const end = Date.parse('2026-10-21T06:00:00Z') / 1000;
const raw = () => ({last_run_initialisation_time: run, last_run_availability_time: available, update_interval_seconds: 21600, data_end_time: end});
const metadata = (id: string) => ({components: COMPOSITE_METADATA_IDS[id].map(modelId => ({modelId, metadata: raw()}))});
afterEach(() => {vi.restoreAllMocks(); vi.unstubAllGlobals(); resetWeatherFetchCache();});

describe('métadonnées des composites à Hondeghem', () => {
  it('conserve les alias et exige un cycle commun, avec la disponibilité de la composante la plus tardive', () => {
    for (const [modelName, modelId] of [['GFS', 'gfs_seamless'], ['GEM', 'gem_seamless'], ['UKMET', 'ukmo_seamless']]) {
      const m = metadata(modelId); m.components[0].metadata.last_run_availability_time -= 900;
      const selection = resolveProviderRunSelection({modelName, modelId, metadata: m, locationKey: '50.757_2.520', now});
      expect(selection.status).toBe('selected'); expect(selection.providerRunAt).toBe(run * 1000);
      expect(selection.metadataAvailableAt).toBe(available * 1000);
      const url = new URL(buildSingleRunRequestUrl({modelName, modelId, latitude: 50.7567, longitude: 2.5204, providerRunAt: selection.providerRunAt!}));
      expect(url.searchParams.get('models')).toBe(modelId); expect(url.searchParams.get('run')).toBe('2026-10-19T06:00');
    }
  });
  it('rejette des cycles différents, une grille manquante, dupliquée, périmée ou un horizon déjà passé', () => {
    const cases = [metadata('gfs_seamless'), metadata('gfs_seamless'), metadata('gfs_seamless'), metadata('gfs_seamless'), metadata('gfs_seamless')];
    cases[0].components[1].metadata.last_run_initialisation_time -= 21600;
    cases[1].components.pop(); cases[2].components[1].modelId = cases[2].components[0].modelId;
    cases[3].components[1].metadata.last_run_availability_time = available - 86400;
    cases[4].components[1].metadata.data_end_time = now / 1000 - 1;
    for (const m of cases) expect(resolveCompositeRunMetadata('gfs_seamless', m, now).metadata).toBeNull();
  });
  it('attend dix minutes après la disponibilité la plus tardive et refuse un autre lieu', () => {
    const m = metadata('gfs_seamless'); m.components[1].metadata.last_run_availability_time = now / 1000 - 599;
    expect(resolveProviderRunSelection({modelName: 'GFS', modelId: 'gfs_seamless', metadata: m, locationKey: '50.757_2.520', now}).status).toBe('availability_wait');
    expect(resolveProviderRunSelection({modelName: 'GFS', modelId: 'gfs_seamless', metadata: m, locationKey: '48.857_2.352', now}).status).toBe('unmapped_model_id');
  });
  it('ignore une ancienne génération GEM seulement lorsque son horizon est entièrement révolu', () => {
    const m = metadata('gem_seamless'), legacy = m.components[1].metadata;
    legacy.last_run_initialisation_time -= 86400 * 90; legacy.last_run_availability_time -= 86400 * 89;
    legacy.data_end_time = now / 1000 - 86400;
    expect(resolveCompositeRunMetadata('gem_seamless', m, now).metadata?.last_run_initialisation_time).toBe(run);
    legacy.data_end_time = end;
    expect(resolveCompositeRunMetadata('gem_seamless', m, now).metadata).toBeNull();
  });
  it('ne remplace jamais une erreur HTTP de composante par une autre grille', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => String(input).includes('ncep_gfs025')
      ? new Response('{}', {status: 503}) : Response.json(raw())));
    const result = await collectProviderModelMetadata('gfs_seamless');
    expect(result.metadata).toBeNull(); expect(result.httpStatus).toBe(503);
  });
  it('UKMET fixe le run réellement annoncé le plus ancien et conserve une borne de publication explicite',()=>{
    const m=metadata('ukmo_seamless');m.components[1].metadata.last_run_initialisation_time+=3600;
    const selected=resolveProviderRunSelection({modelName:'UKMET',modelId:'ukmo_seamless',metadata:m,locationKey:'50.757_2.520',now});
    expect(selected.providerRunAt).toBe(run*1000);expect(selected.metadataPublicationBasis).toBe('component_upper_bound');
    m.components[1].metadata.last_run_availability_time=now/1000-599;
    expect(resolveProviderRunSelection({modelName:'UKMET',modelId:'ukmo_seamless',metadata:m,locationKey:'50.757_2.520',now}).status).toBe('availability_wait');
  });
  it('collecte GFS et GEM via Single Runs, conserve les IDs historiques et fixe explicitement un ancien cycle UKMET annonce', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(now);
    const requested: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input)); requested.push(url.toString());
      if (url.hostname === 'api.open-meteo.com') {
        const id = url.pathname.split('/')[2];
        if (!Object.values(COMPOSITE_METADATA_IDS).flat().includes(id)) return new Response('{}', {status: 404});
        const m = raw();
        if (id === 'ukmo_uk_deterministic_2km') m.last_run_initialisation_time += 3600;
        if (id === 'cmc_gem_gdps') {m.last_run_initialisation_time -= 86400 * 90; m.last_run_availability_time -= 86400 * 89; m.data_end_time = now / 1000 - 86400;}
        return Response.json(m);
      }
      expect(url.searchParams.get('run')).toBe('2026-10-19T06:00');
      const ids=url.searchParams.get('models')!.split(',');
      return Response.json({hourly_units: Object.fromEntries(ids.flatMap(id=>[['temperature_2m_'+id,'°C'],['pressure_msl_'+id,'hPa'],['rain_'+id,'mm'],['showers_'+id,'mm'],['snowfall_'+id,'cm']])), hourly: {
        time: [now / 1000 - 3600, now / 1000 + 3600],
        ...Object.fromEntries(ids.flatMap((id,i)=>[['temperature_2m_'+id,[11+i,13+i]],['pressure_msl_'+id,[1000+i,1010+i]],['rain_'+id,[.1,.2+i]],['snowfall_'+id,[0,0]],...(id==='ukmo_seamless'?[]:[['showers_'+id,[0,.1+i]]])])),
      }});
    }));
    const result = await collectProviderRunBatch({targetDate: '2026-10-19', locationKey: '50.757_2.520', latitude: 50.7567, longitude: 2.5204});
    expect(result.captures.filter(c => c.status === 'succeeded').map(c => c.modelName).sort()).toEqual(['GEM', 'GFS', 'UKMET']);
    expect(result.captures.find(c => c.modelName === 'UKMET')?.metadataPublicationBasis).toBe('component_upper_bound');
    expect(result.captures.find(c => c.modelName === 'UKMET')?.providerRunAt).toBe(run * 1000);
    expect(result.values.every(v => v.validTime > now && structurallyValidProviderRunValue(v))).toBe(true);
    expect(new Set(result.values.map(v => v.modelId))).toEqual(new Set(['gfs_seamless', 'gem_seamless', 'ukmo_seamless']));
    expect(requested.some(url => /data\/.*seamless\//.test(url))).toBe(false);
    expect(requested.filter(url => url.includes('single-runs-api')).length).toBe(1);
    expect(result.values.find(v=>v.modelName==='GFS'&&v.variable==='temperature')?.value).toBe(13);
    expect(result.values.find(v=>v.modelName==='GEM'&&v.variable==='temperature')?.value).toBe(14);
    expect(result.values.find(v=>v.modelName==='GFS'&&v.variable==='pressure_msl')).toMatchObject({value:1010,unit:'hPa'});
    expect(result.values.find(v=>v.modelName==='GEM'&&v.variable==='pressure_msl')).toMatchObject({value:1011,unit:'hPa'});
    expect(result.values.find(v=>v.modelName==='GEM'&&v.variable==='rain')).toMatchObject({value:1.2,unit:'mm'});
    expect(result.values.find(v=>v.modelName==='GFS'&&v.variable==='snowfall')).toMatchObject({value:0,unit:'cm'});
    expect(result.values.find(v=>v.modelName==='UKMET'&&v.variable==='showers')?.value).toBeNull();
    expect(new URL(requested.find(url=>url.includes('single-runs-api'))!).searchParams.get('hourly')?.split(',')).toEqual(expect.arrayContaining(['pressure_msl','rain','showers','snowfall']));

  });
});

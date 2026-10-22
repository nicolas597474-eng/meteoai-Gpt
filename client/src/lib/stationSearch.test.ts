import {afterEach,describe,expect,it,vi} from 'vitest';
afterEach(()=>{vi.unstubAllGlobals();vi.resetModules();});
describe('collecte Netatmo partagée',()=>{
 it('partage un appel 50 km entre AI Lab et le Dashboard et conserve l’instant du cache',async()=>{
  const at=Date.now(),rows=[{id:'netatmo-test',name:'Station',lat:50.76,lon:2.52,temp:0,time:at-300000,distance:1,reliability:95,elevation:null,anomaly:false}];
  const fetcher=vi.fn(async(_input:RequestInfo|URL,_init?:RequestInit)=>Response.json({radiusKm:50,stations:rows,at,expiresAt:at+600000,cacheHit:true}));
  vi.stubGlobal('fetch',fetcher);vi.stubGlobal('navigator',{onLine:true});
  const {getNetatmoStations}=await import('./netatmoStations');const {collectStationSearch}=await import('./stationSearch');
  const [stations,data]=await Promise.all([getNetatmoStations(50.7567,2.5204),collectStationSearch({lat:50.7567,lon:2.5204,radiusKm:50})]);
  expect(stations).toHaveLength(1);expect(data.groundTruth.temperature).toBe(0);
  const cached=await collectStationSearch({lat:50.7567,lon:2.5204,radiusKm:50});
  expect(fetcher).toHaveBeenCalledTimes(1);expect(String(fetcher.mock.calls[0][0])).toContain('radiusKm=50');
  expect(cached.fetchedAt).toBe(new Date(at).toISOString());expect(cached.sourceDiagnosticsFromCache).toBe(true);
 });
 it('ne relit aucune mesure locale hors ligne et ne touche pas au cache public',async()=>{
  const fetcher=vi.fn(),open=vi.fn();vi.stubGlobal('fetch',fetcher);vi.stubGlobal('caches',{open});vi.stubGlobal('navigator',{onLine:false});
  const {collectStationSearch}=await import('./stationSearch');const data=await collectStationSearch({radiusKm:50});
  expect(data.sourceDiagnostics[0].status).toBe('error');expect(data.stations).toEqual([]);
  expect(fetcher).not.toHaveBeenCalled();expect(open).not.toHaveBeenCalled();
 });
 it('signale la connexion absente sans fausse réponse vide ni réessai fournisseur',async()=>{
  const fetcher=vi.fn(async()=>Response.json({code:'NETATMO_NOT_CONNECTED'},{status:409}));
  vi.stubGlobal('fetch',fetcher);vi.stubGlobal('navigator',{onLine:true});
  const {collectStationSearch}=await import('./stationSearch');const data=await collectStationSearch({radiusKm:50});
  expect(data.sourceDiagnostics[0].status).toBe('not_configured');expect(data.fetchedAt).toBeNull();expect(fetcher).toHaveBeenCalledTimes(1);
 });
});

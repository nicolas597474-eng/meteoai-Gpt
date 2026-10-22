import {afterEach,describe,expect,it,vi} from 'vitest';
import {getEnvironmentalSnapshot,getAstronomyDayBounds,getTerrainHorizonProfile,getApparentAstronomyPosition} from './environmentalData';
afterEach(()=>{vi.unstubAllGlobals();vi.useRealTimers();});
describe('raccordement des cartes environnementales',()=>{
 it('les bornes suivent le jour de Paris et les changements d’heure',()=>{
  const march=getAstronomyDayBounds(new Date('2026-03-29T12:00:00Z'));expect(march.end.getTime()-march.start.getTime()).toBe(23*3600000);
  const october=getAstronomyDayBounds(new Date('2026-10-25T12:00:00Z'));expect(october.end.getTime()-october.start.getTime()).toBe(25*3600000);
  const late=getAstronomyDayBounds(new Date('2026-10-18T22:30:00Z'));expect(late.start.toISOString()).toBe('2026-10-18T22:00:00.000Z');
 });
 it('deux montages partagent les appels et les valeurs nulles ne deviennent pas zéro',async()=>{
  const fetcher=vi.fn(async(input:any)=>{const url=new URL(String(input));expect(url.searchParams.get('timezone')).toBe('Europe/Paris');
   if(url.hostname.startsWith('air-quality'))return Response.json({timezone:'Europe/Paris',current:{time:'2026-10-18T08:00',european_aqi:0,pm2_5:null,pm10:12,ozone:-1},hourly:{time:['2026-10-18T08:00','invalide','2026-10-18T10:00'],european_aqi:[0,5,-1]}});
   expect(url.searchParams.get('daily')).not.toMatch(/moon/);return Response.json({timezone:'Europe/Paris',daily:{time:['2026-10-18','2026-10-19'],daylight_duration:[38000,37800],cloud_cover_mean:[40,50]},current:{cloud_cover:40}});
  });vi.stubGlobal('fetch',fetcher);
  const point={lat:50.75671,lon:2.52041};const [a,b]=await Promise.all([getEnvironmentalSnapshot(point),getEnvironmentalSnapshot(point)]);
  expect(fetcher).toHaveBeenCalledTimes(2);expect(a).toBe(b);expect(a.air?.aqi).toBe(0);expect(a.air?.pm25).toBeNull();expect(a.air?.ozone).toBeNull();expect(a.air?.hourly).toHaveLength(1);expect(a.astronomy?.moon.label).not.toBe('Phase indisponible');
  await getEnvironmentalSnapshot(point);expect(fetcher).toHaveBeenCalledTimes(2);
 });
 it('hors ligne, les éphémérides sont calculées sans inventer de qualité de l’air',async()=>{
  const fetcher=vi.fn(()=>{throw Error('Réseau interdit');});vi.stubGlobal('fetch',fetcher);
  const data=await getEnvironmentalSnapshot({lat:50.75672,lon:2.52042},{online:false});expect(fetcher).not.toHaveBeenCalled();expect(data.air).toBeNull();expect(data.astronomy?.sunrise).toMatch(/Z$/);expect(data.astronomy?.lunar.illuminationPct).toBeGreaterThanOrEqual(0);expect(data.astronomy?.outlook.upcomingEclipses.every(event=>event.skyOutlook===null)).toBe(true);
 });
 it('une réponse de relief incomplète reste une erreur, sans relief fictif à zéro',async()=>{
  vi.stubGlobal('fetch',vi.fn(async()=>Response.json({elevation:[44,null]})));
  await expect(getTerrainHorizonProfile({lat:50.75673,lon:2.52043})).rejects.toThrow('incomplet');
 });
 it('les coordonnées invalides sont refusées avant tout appel',async()=>{const fetcher=vi.fn();vi.stubGlobal('fetch',fetcher);await expect(getEnvironmentalSnapshot({lat:91,lon:2})).rejects.toThrow();expect(fetcher).not.toHaveBeenCalled();});
 it('charge les altitudes par lots de 100 et partage le profil entre consultations',async()=>{
  const fetcher=vi.fn(async(input:any)=>{const url=new URL(String(input)),count=url.searchParams.get('latitude')!.split(',').length;expect(count).toBeLessThanOrEqual(100);return Response.json({elevation:Array(count).fill(100)});});vi.stubGlobal('fetch',fetcher);
  const coords={lat:48.123456,lon:3.654321};const [a,b]=await Promise.all([getTerrainHorizonProfile(coords),getTerrainHorizonProfile(coords)]);
  expect(fetcher).toHaveBeenCalledTimes(4);expect(a).toBe(b);expect(a.points).toHaveLength(36);expect(a.maxDistanceKm).toBe(50);
  await getTerrainHorizonProfile(coords);expect(fetcher).toHaveBeenCalledTimes(4);
 });
 it('réutilise les événements du jour sans figer les positions et protège les trajectoires des mutations',()=>{
  const point={lat:50.77731,lon:2.53121},a=getApparentAstronomyPosition(point,new Date('2026-10-21T06:00Z'));
  const expected=structuredClone(a.trajectory);a.trajectory.sun[0].altitudeDeg=999;
  const b=getApparentAstronomyPosition(point,new Date('2026-10-21T12:00Z'));
  expect(b.trajectory).toEqual(expected);expect(b.events).toEqual(a.events);expect(b.sun.altitudeDeg).not.toBe(a.sun.altitudeDeg);expect(b.calculatedAt).toBe('2026-10-21T12:00:00.000Z');
  const next=getApparentAstronomyPosition(point,new Date('2026-10-22T06:00Z'));expect(next.events.sun.rise).not.toBe(b.events.sun.rise);
 });
 it('rafraîchit la météo environnementale à dix minutes et la qualité de l’air à vingt minutes, sans rajeunir sa mesure',async()=>{
  vi.useFakeTimers({toFake:['Date']});const start=Date.parse('2026-10-21T08:00Z');vi.setSystemTime(start);
  let airCalls=0,weatherCalls=0;
  vi.stubGlobal('fetch',vi.fn(async(input:any)=>{
   if(new URL(String(input)).hostname.startsWith('air-quality')){airCalls++;return Response.json({timezone:'Europe/Paris',current:{time:'2026-10-21T08:00',european_aqi:31},hourly:{time:[],european_aqi:[]}});}
   weatherCalls++;return Response.json({timezone:'Europe/Paris',daily:{time:['2026-10-21','2026-10-22'],daylight_duration:[38000,37800],cloud_cover_mean:[40,50]},current:{cloud_cover:40}});
  }));
  const point={lat:50.75477,lon:2.52277};await getEnvironmentalSnapshot(point);expect([weatherCalls,airCalls]).toEqual([1,1]);
  vi.setSystemTime(start+11*60000);const cachedAir=await getEnvironmentalSnapshot(point);expect([weatherCalls,airCalls]).toEqual([2,1]);expect(cachedAir.air?.observedAt).toBe('2026-10-21T08:00');
  vi.setSystemTime(start+21*60000);await getEnvironmentalSnapshot(point);expect([weatherCalls,airCalls]).toEqual([3,2]);
 });
});

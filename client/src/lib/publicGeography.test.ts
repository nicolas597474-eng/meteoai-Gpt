import {afterEach,describe,expect,it,vi} from 'vitest';
import {PublicGeography,GEOGRAPHY_STORAGE_KEY,GEOGRAPHY_TTL_MS,EMPTY_SEARCH_TTL_MS} from './publicGeography';
function storage(){const rows=new Map<string,string>();return {rows,getItem:(key:string)=>rows.get(key)??null,setItem:(key:string,value:string)=>{rows.set(key,value);}};}
const lille={name:'Lille',latitude:50.63,longitude:3.057,admin1:'Hauts-de-France',country:'France',population:232787};
afterEach(()=>{vi.restoreAllMocks();vi.useRealTimers();});
describe('métadonnées géographiques publiques',()=>{
 it('réutilise une recherche après réouverture, conserve les résultats et expire sans prolongation',async()=>{
  let now=Date.parse('2026-10-21T08:00Z');const disk=storage(),fetcher=vi.fn(async(_input:RequestInfo|URL,_init?:RequestInit)=>Response.json({results:[lille]}));
  const before=new PublicGeography({storage:()=>disk,now:()=>now,fetcher});
  const first=await before.search(' Lille ');first[0].name='Modifié';
  now+=GEOGRAPHY_TTL_MS-1;
  const reopened=new PublicGeography({storage:()=>disk,now:()=>now,fetcher});
  expect(await reopened.search('LILLE')).toEqual([lille]);expect(fetcher).toHaveBeenCalledTimes(1);
  now++;await reopened.search('lille');expect(fetcher).toHaveBeenCalledTimes(2);
  const [url,options]=fetcher.mock.calls[0];expect(url.hostname).toBe('geocoding-api.open-meteo.com');expect(url.searchParams.get('count')).toBe('6');expect(options.credentials).toBe('omit');
 });
 it('sépare recherches et limites, garde les homonymes et ne remplace pas les coordonnées',async()=>{
  const second={...lille,latitude:48.7,longitude:2.1,population:0};const fetcher=vi.fn(async()=>Response.json({results:[lille,second]})),cache=new PublicGeography({fetcher});
  expect(await cache.search('Lille')).toEqual([lille,second]);await cache.search('Lille',10);await cache.search('Lens');
  expect(fetcher).toHaveBeenCalledTimes(3);await cache.search('lille');expect(fetcher).toHaveBeenCalledTimes(3);
 });
 it('regroupe deux demandes sans que l’annulation d’un lecteur annule l’autre',async()=>{
  let done!:(value:Response)=>void;const fetcher=vi.fn(()=>new Promise<Response>(resolve=>{done=resolve;})),cache=new PublicGeography({fetcher});
  const controller=new AbortController(),cancelled=cache.search('Lille',6,controller.signal),other=cache.search('Lille');
  controller.abort();await expect(cancelled).rejects.toMatchObject({name:'AbortError'});done(Response.json({results:[lille]}));
  expect(await other).toEqual([lille]);expect(await cache.search('Lille')).toEqual([lille]);expect(fetcher).toHaveBeenCalledTimes(1);
 });
 it('ne conserve pas un refus de quota, une erreur réseau ou une réponse invalide',async()=>{
  const fetcher=vi.fn().mockResolvedValueOnce(new Response('{}',{status:429})).mockRejectedValueOnce(Error('Réseau'))
   .mockResolvedValueOnce(Response.json({results:[{...lille,latitude:999}]})).mockResolvedValueOnce(Response.json({results:[lille]}));
  const cache=new PublicGeography({fetcher});
  for(let i=0;i<3;i++)await expect(cache.search('Lille')).rejects.toThrow();
  expect(await cache.search('Lille')).toEqual([lille]);expect(fetcher).toHaveBeenCalledTimes(4);
 });
 it('conserve une recherche vide seulement quinze minutes et ignore les recherches trop courtes',async()=>{
  let now=Date.now();const fetcher=vi.fn(async()=>Response.json({generationtime_ms:0.1})),cache=new PublicGeography({fetcher,now:()=>now});
  expect(await cache.search('x')).toEqual([]);expect(fetcher).not.toHaveBeenCalled();
  await cache.search('inconnu');now+=EMPTY_SEARCH_TTL_MS-1;await cache.search('inconnu');expect(fetcher).toHaveBeenCalledTimes(1);
  now++;await cache.search('inconnu');expect(fetcher).toHaveBeenCalledTimes(2);
 });
 it('conserve l’altitude exacte et sa date pendant sept jours sans confondre deux lieux',async()=>{
  let now=Date.parse('2026-10-21T08:00Z');const disk=storage(),fetcher=vi.fn(async()=>Response.json({elevation:[0]}));
  const cache=new PublicGeography({fetcher,storage:()=>disk,now:()=>now});
  const value=await cache.elevation(50.630001,3.057001);expect(value?.value).toBe(0);const at=value?.retrievedAt;
  now+=1234;const reopened=new PublicGeography({fetcher,storage:()=>disk,now:()=>now});
  expect((await reopened.elevation(50.630001,3.057001))?.retrievedAt).toBe(at);expect(fetcher).toHaveBeenCalledTimes(1);
  await reopened.elevation(50.630002,3.057001);expect(fetcher).toHaveBeenCalledTimes(2);
  expect(await reopened.elevation(91,3)).toBeNull();expect(fetcher).toHaveBeenCalledTimes(2);
  now=Date.parse(at!)+GEOGRAPHY_TTL_MS;await reopened.elevation(50.630001,3.057001);expect(fetcher).toHaveBeenCalledTimes(3);
 });
 it('garde un repli mémoire lorsque le stockage est refusé et ignore un disque corrompu ou futur',async()=>{
  const fetcher=vi.fn(async()=>Response.json({results:[lille]}));
  const cache=new PublicGeography({fetcher,storage:()=>{throw Error('Refusé');}});
  await cache.search('Lille');await cache.search('Lille');expect(fetcher).toHaveBeenCalledTimes(1);
  const disk=storage();disk.setItem(GEOGRAPHY_STORAGE_KEY,'{cassé');await new PublicGeography({fetcher,storage:()=>disk}).search('Lille');
  disk.setItem(GEOGRAPHY_STORAGE_KEY,JSON.stringify([{key:'search:6:lille',at:Date.now()+60000,value:{kind:'search',places:[lille]}}]));
  await new PublicGeography({fetcher,storage:()=>disk}).search('Lille');expect(fetcher).toHaveBeenCalledTimes(3);
 });
 it('borne le stockage et laisse les autres caches et favoris intacts',async()=>{
  const disk=storage();disk.rows.set('favoris','ne pas toucher');
  const fetcher=vi.fn(async()=>Response.json({results:[lille]})),cache=new PublicGeography({fetcher,storage:()=>disk});
  for(let i=0;i<55;i++)await cache.search('lieu '+i);
  expect(JSON.parse(disk.getItem(GEOGRAPHY_STORAGE_KEY)!).length).toBe(48);expect(disk.getItem('favoris')).toBe('ne pas toucher');
  expect(disk.rows.size).toBe(2);
 });
});

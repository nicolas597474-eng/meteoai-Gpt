import { describe, expect, it } from 'vitest';
import worker from '../../public/sw.js?raw';
import manifest from '../../public/manifest.webmanifest?raw';

describe('contrat PWA',()=>{
  it('déclare un manifeste installable avec icône maskable',()=>{const m=JSON.parse(manifest);expect(m.display).toBe('standalone');expect(m.lang).toBe('fr');expect(m.icons.some((i:any)=>i.sizes==='192x192')).toBe(true);expect(m.icons.some((i:any)=>i.sizes==='512x512'&&i.purpose==='maskable')).toBe(true);});
  it('enregistre les événements nécessaires sans erreur de syntaxe',()=>{const events:string[]=[];new Function('self',worker)({addEventListener:(name:string)=>events.push(name)});expect(events).toEqual(['install','activate','message','fetch']);});
  it('sert une réponse météo en cache tout en revalidant le réseau',async()=>{
    const events:Record<string,(e:any)=>void>={},cached=new Response('{"temperature":15}',{headers:{'X-MeteoAI-Fetched-At':'100'}}),stored:any[]=[];
    const self={location:{origin:'https://test.local'},addEventListener:(n:string,fn:(e:any)=>void)=>{events[n]=fn;},clients:{claim:async()=>{}},skipWaiting:()=>{}};
    const cache={match:async()=>cached,put:async(...args:any[])=>{stored.push(args);},keys:async()=>[]};
    new Function('self','caches','fetch',worker)(self,{open:async()=>cache},async()=>new Response('{"temperature":16}'));
    let response:Promise<Response>|undefined;const waits:Promise<any>[]=[];
    events.fetch({request:new Request('https://api.open-meteo.com/v1/forecast'),respondWith:(p:Promise<Response>)=>{response=p;},waitUntil:(p:Promise<any>)=>waits.push(p)});
    expect(await (await response!).json()).toEqual({temperature:15});await Promise.all(waits);expect(stored.length).toBe(1);expect(stored[0][1].headers.get('X-MeteoAI-Fetched-At')).toBeTruthy();
  });
  it('garde une réponse en cache lorsque le réseau est hors ligne',async()=>{
    const events:Record<string,(e:any)=>void>={},cached=new Response('{"temperature":15}');
    new Function('self','caches','fetch',worker)({location:{origin:'https://test.local'},addEventListener:(n:string,fn:any)=>{events[n]=fn;}},{open:async()=>({match:async()=>cached})},async()=>{throw new Error('offline');});
    let response:Promise<Response>|undefined;const waits:Promise<any>[]=[];events.fetch({request:new Request('https://api.open-meteo.com/v1/forecast'),respondWith:(p:Promise<Response>)=>{response=p;},waitUntil:(p:Promise<any>)=>waits.push(p)});expect(await (await response!).json()).toEqual({temperature:15});await Promise.all(waits);
  });
  it('répond explicitement hors ligne si aucune donnée n’existe',async()=>{
    const events:Record<string,(e:any)=>void>={};new Function('self','caches','fetch',worker)({location:{origin:'https://test.local'},addEventListener:(n:string,fn:any)=>{events[n]=fn;}},{open:async()=>({match:async()=>undefined})},async()=>{throw new Error('offline');});let response:Promise<Response>|undefined;events.fetch({request:new Request('https://api.open-meteo.com/v1/forecast'),respondWith:(p:Promise<Response>)=>{response=p;}});expect((await response!).status).toBe(503);
  });
});

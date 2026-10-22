import {describe,expect,it,vi} from 'vitest';
import {makeSkyScene,skySunPosition,skyQuality,bindSkyAnimation} from './atmosphericSky';
const now=Date.parse('2026-10-20T12:00:00Z');
const weather=(extra={})=>({capturedAt:new Date(now-600000).toISOString(),cloudCover:80,windSpeed:20,weatherCode:3,precipitation:0,...extra});
describe('ciel relié aux seules données existantes',()=>{
 it('préserve ciel clair, vent nul et couverture nulle malgré un code nuageux',()=>{
  const clear=makeSkyScene(weather({cloudCover:0,windSpeed:0}),50.76,2.52,now);expect(clear.coverage).toBe(0);expect(clear.drift).toBe(0);expect(clear.rain).toBe(0);
 });
 it('fait varier la densité et la dérive avec les mesures, sans multiplier les sources',()=>{
  const low=makeSkyScene(weather({cloudCover:20,windSpeed:10}),50.76,2.52,now),high=makeSkyScene(weather({cloudCover:90,windSpeed:40}),50.76,2.52,now);
  expect(high.coverage).toBeGreaterThan(low.coverage);expect(high.drift).toBe(low.drift*4);
 });
 it('ne représente pas une ancienne mesure, un horodatage futur ou une donnée absente comme actuelle',()=>{
  for(const capturedAt of [undefined,'bad',new Date(now-31*60000).toISOString(),new Date(now+120000).toISOString()]){
   const scene=makeSkyScene(weather({capturedAt}),50.76,2.52,now);expect(scene.fresh).toBe(false);expect(scene.coverage).toBe(0);expect(scene.drift).toBe(0);expect(scene.rain).toBe(0);
  }
 });
 it('garde un effet de pluie discret pour les codes pluvieux et ne transforme pas la neige en pluie',()=>{
  expect(makeSkyScene(weather({weatherCode:61}),50.76,2.52,now).rain).toBeGreaterThan(0);
  expect(makeSkyScene(weather({weatherCode:73,precipitation:2}),50.76,2.52,now).rain).toBe(0);
 });
 it('éclaire selon le lieu et l’heure, avec transitions à l’aube et au crépuscule',()=>{
  expect(skySunPosition(now,50.76,2.52).elevation).toBeGreaterThan(20);
  expect(skySunPosition(now+12*3600000,50.76,2.52).elevation).toBeLessThan(0);
  const dawn=skySunPosition(Date.parse('2026-03-20T06:00:00Z'),0,0),dusk=skySunPosition(Date.parse('2026-03-20T18:00:00Z'),0,0);
  expect(Math.abs(dawn.elevation)).toBeLessThan(5);expect(dawn.morning).toBe(true);expect(dusk.morning).toBe(false);
  expect(skySunPosition(Date.parse('2026-12-21T12:00:00Z'),89,0).elevation).toBeLessThan(0);
 });
 it('borne les ressources sur petit écran et en mode réduit',()=>{
  expect(skyQuality(390).maxClouds).toBeLessThan(skyQuality(1200).maxClouds);expect(skyQuality(390).dpr).toBeLessThanOrEqual(1.25);expect(skyQuality(390).fps).toBeLessThanOrEqual(24);expect(skyQuality(390,true).maxClouds).toBeLessThan(skyQuality(390).maxClouds);
 });
});
function harness(animate=true){
 const frames=new Map<number,(t:number)=>void>(),listeners=new Set<()=>void>();let id=0;
 const doc={hidden:false,addEventListener:(_:string,fn:()=>void)=>listeners.add(fn),removeEventListener:(_:string,fn:()=>void)=>listeners.delete(fn)},draw=vi.fn();
 const loop=bindSkyAnimation({document:doc,request:fn=>{frames.set(++id,fn);return id;},cancel:n=>{frames.delete(n);},draw,fps:24,animate});
 return {loop,doc,draw,frames,listeners,advance(t:number){const pending=[...frames.values()];frames.clear();pending.forEach(fn=>fn(t));},visibility(hidden:boolean){doc.hidden=hidden;listeners.forEach(fn=>fn());}};
}
describe('cycle mobile et accessibilité',()=>{
 it('arrête réellement le rAF en arrière-plan et reprend sans saut temporel',()=>{
  const h=harness();h.advance(100);h.advance(150);expect(h.draw).toHaveBeenLastCalledWith(.05);
  h.visibility(true);expect(h.frames.size).toBe(0);const count=h.draw.mock.calls.length;h.loop.invalidate();expect(h.draw).toHaveBeenCalledTimes(count);
  h.visibility(false);expect(h.draw).toHaveBeenLastCalledWith(0);expect(h.frames.size).toBe(1);h.advance(999999);expect(h.draw).toHaveBeenLastCalledWith(0);
  h.loop.dispose();expect(h.frames.size).toBe(0);expect(h.listeners.size).toBe(0);
 });
 it('dessine un ciel statique sans aucun rAF quand les animations sont réduites',()=>{
  const h=harness(false);expect(h.draw).toHaveBeenCalledTimes(1);expect(h.frames.size).toBe(0);h.visibility(true);h.visibility(false);expect(h.frames.size).toBe(0);h.loop.dispose();
 });
 it('peut arrêter le mouvement par vent calme puis reprendre quand le vent revient',()=>{
  const h=harness();h.loop.setAnimated(false);expect(h.frames.size).toBe(0);h.loop.setAnimated(true);expect(h.frames.size).toBe(1);h.loop.dispose();
 });
});

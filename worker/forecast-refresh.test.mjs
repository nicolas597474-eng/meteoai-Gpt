import {test} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
const built=await build({stdin:{contents:"export {cached} from './worker/weather';export {ForecastOfflineCache} from './client/src/lib/forecastOffline';",resolveDir:process.cwd()},bundle:true,platform:'node',format:'esm',write:false});
const {cached,ForecastOfflineCache}=await import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].text).toString('base64'));
function environment(extra={}){const records=new Map();return {...extra,records,BUCKET:{get:async key=>records.has(key)?{json:async()=>records.get(key)}:null,put:async(key,value)=>records.set(key,JSON.parse(value))}};}
test('le cache du navigateur attend la réponse fraîche du cache interne, jamais un second résultat périmé',async()=>{
 const env=environment({waitForFreshWeather:true}),key='browser-refresh',oldAt=Date.now()-3600000;
 env.records.set('controle/weather-v2/'+key,{at:oldAt,value:{hours:[{temp:8}],officialSnapshot:{snapshotStatus:'live'}}});
 let calls=0,release;const hold=new Promise(resolve=>release=resolve),ctx={waitUntil(){throw Error('Pas de deuxième rafraîchissement en arrière-plan');}};
 const loader=async()=>{calls++;await hold;return {hours:[{temp:12}],officialSnapshot:{snapshotStatus:'live'}};};
 const a=cached(key,env,ctx,loader),b=cached(key,env,ctx,loader);release();
 for(const result of await Promise.all([a,b])){assert.equal(result.hours[0].temp,12);assert.equal(result.officialSnapshot.snapshotStatus,'live');assert.equal(result.controlCache,undefined);}
 assert.equal(calls,1);assert.equal(env.records.get('controle/weather-v2/'+key).value.hours[0].temp,12);
});
test('le bouton manuel contourne le cache interne frais sans modifier les archives conservées en cas d’échec',async()=>{
 const env=environment({waitForFreshWeather:true,forceFreshWeather:true}),key='manual-refresh';
 env.records.set('controle/weather-v2/'+key,{at:Date.now(),value:{hours:[{temp:8}]}});
 await assert.rejects(cached(key,env,{},async()=>{throw Error('Fournisseur temporairement absent');}),/Fournisseur/);
 assert.equal(env.records.get('controle/weather-v2/'+key).value.hours[0].temp,8);
 const value=await cached(key,env,{},async()=>({hours:[{temp:12}]}));assert.equal(value.hours[0].temp,12);
});
test('le serveur conserve son comportement de réponse immédiate avec cache ancien',async()=>{
 const env=environment(),key='server-refresh';env.records.set('controle/weather-v2/'+key,{at:Date.now()-3600000,value:{hours:[{temp:8}],officialSnapshot:{snapshotStatus:'live'}}});
 const pending=[];const value=await cached(key,env,{waitUntil:p=>pending.push(p)},async()=>({hours:[{temp:12}]}));
 assert.equal(value.officialSnapshot.snapshotStatus,'stale');assert.equal(value.hours[0].temp,8);await Promise.all(pending);
});


test('chaîne complète des deux caches : une seule relève actualise durablement la prévision affichée',async t=>{
 let now=Date.parse('2026-10-20T11:00:00Z');t.mock.method(Date,'now',()=>now);
 const rows=new Map(),storage={open:async()=>({match:async r=>rows.get(r.url)?.clone(),put:async(r,v)=>rows.set(r.url,v.clone()),delete:async r=>rows.delete(r.url),keys:async()=>[...rows.keys()].map(url=>new Request(url))})};
 let done;const refreshed=new Promise(resolve=>done=resolve);
 const device=new ForecastOfflineCache({origin:'https://fixture.example',storage,online:()=>true,now:()=>now,onRefresh:()=>done()});
 await device.get('two-level-forecast',async()=>({savedAt:now,payload:{hours:[{temp:8}],officialSnapshot:{snapshotStatus:'live'}}}));
 const env=environment({waitForFreshWeather:true});env.records.set('controle/weather-v2/two-level-forecast',{at:now,value:{hours:[{temp:8}],officialSnapshot:{snapshotStatus:'live'}}});
 now+=6*60000;let calls=0;
 const loader=async()=>({savedAt:now,payload:await cached('two-level-forecast',env,{waitUntil(){throw Error('Rafraîchissement imbriqué interdit');}},async()=>{calls++;return {hours:[{temp:12}],officialSnapshot:{snapshotStatus:'live'}};})});
 const initial=await device.get('two-level-forecast',loader);assert.equal(initial.reason,'refreshing');assert.equal(initial.entry.payload.hours[0].temp,8);
 await refreshed;const received=await device.get('two-level-forecast',loader);assert.equal(calls,1);assert.equal(received.reason,'fresh');assert.equal(received.entry.payload.hours[0].temp,12);assert.equal(received.entry.payload.officialSnapshot.snapshotStatus,'live');
});

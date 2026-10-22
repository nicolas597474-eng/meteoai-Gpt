import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';
import {build} from 'esbuild';
const built=await build({entryPoints:['client/src/lib/forecastOffline.ts'],bundle:true,platform:'node',format:'esm',write:false});
const {ForecastOfflineCache,FORECAST_CACHE,MAX_FORECAST_AGE,markCachedForecast}=await import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].text).toString('base64'));
function storage(){const stores=new Map();return {async open(name){if(!stores.has(name))stores.set(name,new Map());const map=stores.get(name);const key=r=>typeof r==='string'?new URL(r,'https://meteo.example').href:r.url;return {match:async r=>map.get(key(r))?.clone(),put:async(r,v)=>map.set(key(r),v.clone()),delete:async r=>map.delete(key(r)),keys:async()=>[...map.keys()].map(u=>new Request(u))};},keys:async()=>[...stores.keys()],delete:async n=>stores.delete(n)};}
const origin='https://meteo.example',at=1792249200000;

test('Actualiser relit immédiatement un cache frais et garde le dernier résultat si le réseau échoue',async()=>{
 const store=storage(),cache=new ForecastOfflineCache({origin,storage:store,now:()=>at,online:()=>true});
 await cache.get('AI Lab',async()=>({savedAt:at,payload:{scores:0}}));
 const updated=await cache.get('AI Lab',async()=>({savedAt:at,payload:{scores:4}}),true);
 assert.equal(updated.reason,'network');assert.equal(updated.entry.payload.scores,4);
 const failed=await cache.get('AI Lab',async()=>{throw Error('Fournisseur indisponible');},true);
 assert.equal(failed.reason,'unavailable');assert.equal(failed.entry.payload.scores,4);
 const offline=new ForecastOfflineCache({origin,storage:store,now:()=>at,online:()=>false});
 assert.equal((await offline.get('AI Lab',async()=>{throw Error('Aucun réseau autorisé');},true)).entry.payload.scores,4);
});
test('prévision conservée entre deux instances, relue hors ligne sans aucun appel ni archivage',async()=>{
 const store=storage(),options={origin,storage:store,now:()=>at,online:()=>true};let calls=0;
 const one=new ForecastOfflineCache(options);await one.get('Hondeghem',async()=>({savedAt:at,payload:{temperature:0,rain:0}}));
 const two=new ForecastOfflineCache({...options,online:()=>false});const result=await two.get('Hondeghem',async()=>{calls++;throw Error('Interdit');});
 assert.equal(calls,0);assert.equal(result.reason,'offline');assert.equal(result.entry.savedAt,at);assert.deepEqual(result.entry.payload,{temperature:0,rain:0});
 await assert.rejects(()=>two.get('Lille',async()=>{calls++;}),/Aucune prévision/);assert.equal(calls,0);
});
test('stale-while-revalidate : réponse immédiate, requête unique et nouvelle valeur conservée',async()=>{
 const store=storage();await new ForecastOfflineCache({origin,storage:store,now:()=>at,online:()=>true}).get('ville',async()=>({savedAt:at,payload:{temp:10}}));
 let calls=0,release,refreshed;const done=new Promise(resolve=>{refreshed=resolve;});const hold=new Promise(resolve=>{release=resolve;});
 const cache=new ForecastOfflineCache({origin,storage:store,now:()=>at+120000,online:()=>true,onRefresh:()=>refreshed()});
 const loader=async()=>{calls++;await hold;return {savedAt:at+120000,payload:{temp:11}};};
 const values=await Promise.all([cache.get('ville',loader),cache.get('ville',loader)]);assert.equal(calls,1);assert(values.every(r=>r.reason==='refreshing'&&r.entry.payload.temp===10));
 release();await done;const next=await cache.get('ville',async()=>{throw Error('Cache frais attendu');});assert.equal(next.reason,'fresh');assert.equal(next.entry.payload.temp,11);
});
test('cache périmé ou daté dans le futur : aucune ancienne valeur inventée',async()=>{
 for(const now of [at+MAX_FORECAST_AGE+1,at-120000]){
  const store=storage();await new ForecastOfflineCache({origin,storage:store,now:()=>at,online:()=>true}).get('ville',async()=>({savedAt:at,payload:{temp:10}}));
  const other=new ForecastOfflineCache({origin,storage:store,now:()=>now,online:()=>false});await assert.rejects(()=>other.get('ville',async()=>null),/Aucune prévision/);
 }
});
test('panne de stockage : la réponse réseau reste utilisable ; cache limité à 24 entrées',async()=>{
 const bad=new ForecastOfflineCache({origin,storage:{open:async()=>{throw Error('Quota');}},now:()=>at,online:()=>true});assert.equal((await bad.get('ville',async()=>({savedAt:at,payload:{temp:10}}))).entry.payload.temp,10);
 const store=storage();let now=at;const cache=new ForecastOfflineCache({origin,storage:store,now:()=>now,online:()=>true});for(let i=0;i<26;i++){now++;await cache.get('ville'+i,async()=>({savedAt:now,payload:{temp:i}}));}assert.equal((await (await store.open(FORECAST_CACHE)).keys()).length,24);
});
test('trace AI Lab volumineuse conservée hors ligne sans élargir les autres entrées ni le budget total',async()=>{
 const store=storage();let now=at;const options={origin,storage:store,now:()=>now,online:()=>true};
 const payload={trace:'x'.repeat(4000000)};
 const cache=new ForecastOfflineCache(options);
 await cache.get('prévision ordinaire',async()=>({savedAt:now,payload}));
 assert.equal((await (await store.open(FORECAST_CACHE)).keys()).length,0);
 const key=JSON.stringify(['weather.getAILab',50.75,2.58,null]);
 await cache.get(key,async()=>({savedAt:now,payload}));
 const offline=new ForecastOfflineCache({...options,online:()=>false});
 assert.equal((await offline.get(key,async()=>{throw Error('Aucun réseau');})).entry.payload.trace.length,4000000);
 for(let i=0;i<4;i++){now++;await cache.get(JSON.stringify(['weather.getAILab',i,0,null]),async()=>({savedAt:now,payload}));}
 const bucket=await store.open(FORECAST_CACHE),keys=await bucket.keys();
 const bytes=await Promise.all(keys.map(async key=>Number((await bucket.match(key)).headers.get('X-MeteoAI-Bytes'))));
 assert(bytes.reduce((a,b)=>a+b,0)<=16000000);assert.equal(keys.length,3);
 await assert.rejects(()=>offline.get(key,async()=>null),/Aucune prévision/);
});

test('prévision ancienne explicitement signalée ; instantané courant retiré et valeurs nulles préservées',()=>{
 const source={currentSnapshot:{temp:12},hours:[{temp:0,humidity:null}],officialSnapshot:{computedAt:'date',snapshotStatus:'live'}};
 const result=markCachedForecast(source,at);assert.equal(result.currentSnapshot,null);assert.equal(result.officialSnapshot.snapshotStatus,'stale');assert.equal(result.officialSnapshot.computedAt,'date');assert.equal(result.controlCache.cachedAt,new Date(at).toISOString());assert.deepEqual(result.hours,source.hours);assert.equal(source.currentSnapshot.temp,12);
});
test('un repli mémoire inchangé ne crée pas de boucle de rafraîchissement',async()=>{
 const store=storage();await new ForecastOfflineCache({origin,storage:store,now:()=>at,online:()=>true}).get('ville',async()=>({savedAt:at,payload:{temp:10}}));
 let count=0,status;const finished=new Promise(resolve=>{status=resolve;});
 const cache=new ForecastOfflineCache({origin,storage:store,now:()=>at+120000,online:()=>true,onRefresh:()=>{count++;status();}});
 await cache.get('ville',async()=>({savedAt:at,payload:{temp:10}}));await finished;
 const next=await cache.get('ville',async()=>{throw Error('Pas de boucle');});assert.equal(count,1);assert.equal(next.reason,'fresh');assert.equal(next.entry.savedAt,at);
});
async function sw(){
 const callbacks={},store=storage();let fail=false,denied=false,skips=0;
 const self={location:{origin},clients:{claim:async()=>{}},skipWaiting:async()=>{skips++;},addEventListener:(name,fn)=>callbacks[name]=fn};
 runInNewContext(await readFile('client/public/sw.js','utf8'),{self,caches:store,Request,Response,URL,fetch:async request=>{if(fail)throw Error('Hors ligne');return new Response(request.url.endsWith('/')?'<html><div id="root"></div></html>':'asset',{status:denied?403:200,headers:{'Content-Type':request.url.endsWith('/')?'text/html':'text/javascript'}});}});
 const run=async(name,args={})=>{let response;const tasks=[];callbacks[name]({...args,waitUntil:p=>tasks.push(p),respondWith:p=>{response=p;}});const value=response?await response:null;await Promise.all(tasks);return value;};
 return {store,run,setOffline:()=>{fail=true;},deny:()=>{denied=true;},skips:()=>skips};
}
test('service worker : navigation hors ligne depuis la coquille ; refus connecté respecté',async()=>{
 const a=await sw();await a.run('install');a.setOffline();const r=await a.run('fetch',{request:{url:origin+'/details',method:'GET',mode:'navigate'}});assert.equal(r.status,200);assert.match(await r.text(),/root/);
 const b=await sw();await b.run('install');b.deny();assert.equal((await b.run('fetch',{request:{url:origin+'/',method:'GET',mode:'navigate'}})).status,403);
});
test('service worker : aucune API, identité, page historique ou origine externe en cache',async()=>{
 const a=await sw();await a.run('install');
 for(const path of ['/api/trpc/auth.me','/api/netatmo/stations','/api/history/comparisons','/controle-historique','/suivi-historique','/auth/login'])assert.equal(await a.run('fetch',{request:{url:origin+path,method:'GET',mode:'navigate'}}),null);
 assert.equal(await a.run('fetch',{request:{url:'https://autre.example/assets/x.js',method:'GET'}}),null);
 assert.equal(await a.run('fetch',{request:{url:origin+'/assets/x.js',method:'POST'}}),null);
});
test('service worker : mise à jour à la demande, sans effacer le cache météo ou les autres applications',async()=>{
 const a=await sw();await a.store.open('meteoai-shell-v1');await a.store.open(FORECAST_CACHE);await a.store.open('autre-application');
 await a.run('install');assert.equal(a.skips(),0);await a.run('message',{data:{type:'SKIP_WAITING'}});assert.equal(a.skips(),1);
 await a.run('activate');const keys=await a.store.keys();assert(!keys.includes('meteoai-shell-v1'));assert(keys.includes(FORECAST_CACHE));assert(keys.includes('autre-application'));
});


test('cache détaillé du 19 remplacé par les 5,5 Mo du 20 et relisible après réouverture du navigateur',async()=>{
 const store=storage(),key=JSON.stringify(['weather.getDetailedForecast',50.7567,2.5204,true]);
 let now=at;const options={origin,storage:store,now:()=>now,online:()=>true};
 await new ForecastOfflineCache(options).get(key,async()=>({savedAt:now,payload:{date:'19/10',hours:[{temp:10}]}}));
 now+=24*3600000;let calls=0,done;const refreshed=new Promise(resolve=>done=resolve);
 const cache=new ForecastOfflineCache({...options,onRefresh:()=>done()});
 const loader=async()=>{calls++;return {savedAt:now,payload:{date:'20/10',trace:'x'.repeat(5500000),hours:[{temp:12}]}};};
 assert.equal((await cache.get(key,loader)).reason,'refreshing');await refreshed;
 const next=await cache.get(key,loader);assert.equal(next.reason,'fresh');assert.equal(next.entry.payload.date,'20/10');assert.equal(calls,1);
 const reopened=new ForecastOfflineCache({...options,online:()=>false});const saved=await reopened.get(key,async()=>{throw Error('Aucun réseau hors ligne');});assert.equal(saved.entry.payload.date,'20/10');assert.equal(saved.entry.payload.trace.length,5500000);
});
test('quota du téléphone refusé : la nouvelle réponse reste affichable sans relire le vieux fichier ni boucler',async()=>{
 const store=storage(),key=JSON.stringify(['weather.getDetailedForecast',50.7567,2.5204,true]);
 let now=at;const options={origin,storage:store,now:()=>now,online:()=>true};
 await new ForecastOfflineCache(options).get(key,async()=>({savedAt:now,payload:{date:'19/10'}}));
 const bucket=await store.open(FORECAST_CACHE),blocked={open:async()=>({...bucket,put:async()=>{throw Error('QuotaExceededError');}})};
 now+=24*3600000;let calls=0,done;const refreshed=new Promise(resolve=>done=resolve);
 const cache=new ForecastOfflineCache({...options,storage:blocked,onRefresh:()=>done()});
 const loader=async()=>{calls++;return {savedAt:now,payload:{date:'20/10',trace:'x'.repeat(5500000)}};};
 await cache.get(key,loader);await refreshed;
 for(let i=0;i<3;i++){const current=await cache.get(key,loader);assert.equal(current.reason,'fresh');assert.equal(current.entry.payload.date,'20/10');}assert.equal(calls,1);
 const offline=new ForecastOfflineCache({...options,online:()=>false});assert.equal((await offline.get(key,async()=>null)).entry.payload.date,'19/10','Le dernier fichier hors ligne reste conservé si le stockage est refusé');
});
test('deux traces détaillées et AI Lab respectent ensemble le budget persistant de 16 Mo',async()=>{
 const store=storage();let now=at;const cache=new ForecastOfflineCache({origin,storage:store,now:()=>now,online:()=>true});
 for(const [name,extended,lon] of [['weather.getDetailedForecast',true,2.52],['weather.getDetailedForecast',true,3],['weather.getAILab',null,2.52]]){
  now++;await cache.get(JSON.stringify([name,50.75,lon,extended]),async()=>({savedAt:now,payload:{trace:'x'.repeat(5500000)}}));
 }
 const bucket=await store.open(FORECAST_CACHE),keys=await bucket.keys();const sizes=await Promise.all(keys.map(async key=>Number((await bucket.match(key)).headers.get('X-MeteoAI-Bytes'))));
 assert.equal(keys.length,2);assert(sizes.reduce((a,b)=>a+b,0)<=16000000);
});

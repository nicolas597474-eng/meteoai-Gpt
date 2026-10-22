import {test} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {QueryClient,QueryObserver} from '@tanstack/react-query';
const built=await build({entryPoints:['client/src/lib/weatherQueryCache.ts'],bundle:true,format:'esm',platform:'node',write:false});
const {liveComparisonQueryKey,invalidateWeatherQueries}=await import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].text).toString('base64'));
const createClient=()=>new QueryClient({defaultOptions:{queries:{retry:false,gcTime:Infinity,staleTime:Infinity,networkMode:'always'}}});
test('la notification météo actualise le comparatif affiché tout en conservant ses valeurs pendant le chargement',async()=>{
 const client=createClient(),key=liveComparisonQueryKey(50.7567,2.5204),other=liveComparisonQueryKey(50.63,3.06),auth=[['auth','me']];
 let value=12,calls=0,hold=false,release;const pending=new Promise(resolve=>{release=resolve;});
 const loader=async()=>{calls++;if(hold)await pending;return {temperature:value};};
 const observer=new QueryObserver(client,{queryKey:key,queryFn:loader});const unsubscribe=observer.subscribe(()=>{});
 try{
  await client.fetchQuery({queryKey:key,queryFn:loader});assert.equal(observer.getCurrentResult().data.temperature,12);
  client.setQueryData(other,{temperature:99});client.setQueryData(auth,{id:1});
  value=14;hold=true;const updating=invalidateWeatherQueries(client,'weather.getModelComparison');
  assert.equal(observer.getCurrentResult().data.temperature,12);assert.equal(observer.getCurrentResult().isFetching,true);
  release();await updating;
  assert.equal(observer.getCurrentResult().data.temperature,14);assert.equal(calls,2);
  assert.equal(client.getQueryData(other).temperature,99);assert.equal(client.getQueryState(auth).isInvalidated,false);
 }finally{unsubscribe();client.clear();}
});
test('une panne au rafraîchissement garde la dernière comparaison et expose l’erreur, sans remplir un autre lieu',async()=>{
 const client=createClient(),key=liveComparisonQueryKey(50.7567,2.5204);let fail=false;
 const loader=async()=>{if(fail)throw Error('Source indisponible');return {temperature:12};};
 const observer=new QueryObserver(client,{queryKey:key,queryFn:loader});const unsubscribe=observer.subscribe(()=>{});
 try{
  await client.fetchQuery({queryKey:key,queryFn:loader});fail=true;await invalidateWeatherQueries(client,'weather.getModelComparison');
  assert.equal(observer.getCurrentResult().data.temperature,12);assert.match(observer.getCurrentResult().error.message,/indisponible/);
  assert.equal(client.getQueryData(liveComparisonQueryKey(48.86,2.35)),undefined);
 }finally{unsubscribe();client.clear();}
});

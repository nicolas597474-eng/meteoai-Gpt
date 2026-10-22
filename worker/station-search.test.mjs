import {test} from 'node:test';
import assert from 'node:assert/strict';
import worker from '../dist/server/index.js';
import {seal,stationZone} from './netatmo-api.mjs';
const env={DB:{prepare(){throw Error('SQL inattendu');}},BUCKET:{get(){throw Error('Lecture privée inattendue');},put(){throw Error('Écriture inattendue');}},NETATMO_ENCRYPTION_KEY:'unused'};
async function query(input,environment=env,headers={}){const url=new URL('https://controle.example/api/trpc/weather.searchStations');url.searchParams.set('input',JSON.stringify({json:input}));return (await (await worker.fetch(new Request(url,{headers}),environment,{waitUntil(){}})).json());}
test('recherche de stations sans identité : aucun accès au coffre ni résultat physique',async()=>{
 const body=await query({lat:50.7567,lon:2.5204,radiusKm:50,stations:[{temp:99}]});
 assert.ok(body.result);const data=body.result.data.json;
 assert.equal(data.radiusKm,50);assert.equal(data.totalFound,0);assert.deepEqual(data.stations,[]);
 assert.equal(data.sourceDiagnostics[0].status,'not_configured');assert.equal(data.groundTruth.temperature,null);assert.equal(data.fetchedAt,null);
});
test('coordonnées et rayon invalides refusés avant lecture Netatmo',async()=>{
 for(const input of [{lat:91,lon:2,radiusKm:50},{lat:50,lon:2,radiusKm:51}]){const body=await query(input);assert.ok(body.error);assert.match(body.error.json.message,/invalid/i);}
});
test('la route raccordée réutilise le coffre et la zone privés sans appel fournisseur ni écriture',async t=>{
 const user='station-test-owner',now=Date.now(),lat=50.7567,lon=2.5204;
 const owner=Buffer.from(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(user))).toString('hex');
 const encryption=Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64'),objects=new Map();
 objects.set('netatmo/vault/'+owner,await seal({clientId:'fixture',revision:'fixture',tokens:{access:'test-only',refresh:'test-only',expiresAt:now+7200000}},encryption,owner));
 const cacheKey='netatmo/cache-zones-v2/'+owner+'/'+stationZone(lat,lon,50).key;
 objects.set(cacheKey,JSON.stringify({at:now,revision:'fixture',body:[{_id:'fixture',place:{city:'Station test',location:[lon,lat+0.01]},measures:{outside:{type:['temperature'],res:{[Math.floor((now-300000)/1000)]:[0]}}}}]}));
 const environment={...env,NETATMO_ENCRYPTION_KEY:encryption,BUCKET:{async get(key){const value=objects.get(key);return value?{text:async()=>value,json:async()=>JSON.parse(value)}:null;},put(){throw Error('Écriture inattendue');}}};
 t.mock.method(globalThis,'fetch',()=>{throw Error('Appel fournisseur inattendu');});
 const body=await query({lat,lon,radiusKm:50},environment,{'oai-authenticated-user-id':user});
 assert.ok(body.result,JSON.stringify(body.error));const data=body.result.data.json;
 assert.equal(data.totalFound,1);assert.equal(data.groundTruth.temperature,0);assert.equal(data.groundTruth.humidity,null);
 assert.equal(data.sourceDiagnosticsFromCache,true);assert.equal(data.fetchedAt,new Date(now).toISOString());
 assert.equal(data.stations[0].sourceKind,'physical');assert.equal(data.providerRadiusKm,50);
 const other=await query({lat,lon,radiusKm:50},environment,{'oai-authenticated-user-id':'other-station-test-owner'});
 assert.deepEqual(other.result.data.json.stations,[]);assert.equal(other.result.data.json.sourceDiagnostics[0].status,'not_configured');
 assert(!JSON.stringify(body).includes('test-only'));
});

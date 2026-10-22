import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {handleNetatmo,collectNetatmoBackground,seal,unseal,digest,publicStations,stationZone,STATION_CACHE_MS,SITE_ORIGIN} from './netatmo-api.mjs';

// Doubles locaux : aucun appel Netatmo ni identifiant réel pendant les tests.
class MemoryBucket {
 records=new Map();counter=0;
 async get(k){const r=this.records.get(k);return r?{etag:r.etag,text:async()=>r.value,json:async()=>JSON.parse(r.value)}:null;}
 async put(k,value,options={}){const current=this.records.get(k),cond=options.onlyIf;if(cond?.etagMatches&&cond.etagMatches!==current?.etag)return null;if(cond?.etagDoesNotMatch==='*'&&current)return null;const etag=String(++this.counter);this.records.set(k,{etag,value});return {etag};}
 async delete(k){this.records.delete(k);}
}
function context(){return {BUCKET:new MemoryBucket(),NETATMO_ENCRYPTION_KEY:randomBytes(32).toString('base64')};}
const clientId='fixture-client-id',clientSecret='fixture-client-secret';
function request(path,method='GET',data,user='owner',extra={}){return new Request(SITE_ORIGIN+'/api/netatmo/'+path,{method,headers:{...(user?{'oai-authenticated-user-id':user}:{}),...(method==='POST'?{'Origin':SITE_ORIGIN,'Content-Type':'application/json'}:{}),...extra},body:method==='POST'?JSON.stringify(data??{}):undefined});}
const configure=env=>handleNetatmo(request('configure','POST',{clientId,clientSecret}),env);
async function authorized(env,fetcher){await configure(env);const started=await handleNetatmo(request('connect','POST'),env),cookie=started.headers.get('Set-Cookie').split(';')[0],url=new URL((await started.json()).url),state=url.searchParams.get('state');const response=await handleNetatmo(request('callback?code=fixture-code&state='+state,'GET',undefined,'owner',{'Cookie':cookie}),env,fetcher);return {response,cookie,state};}
const tokenResponse=()=>Response.json({access_token:'fixture-access',refresh_token:'fixture-refresh',expires_in:10800,scope:['read_station']});
const stationBody=()=>[{_id:'outdoor',place:{city:'Hondeghem',location:[2.52,50.76],altitude:20},measures:{outside:{type:['temperature','humidity'],res:{[Math.floor(Date.now()/1000)]:[16.2,70]}}}}];

test('humidité : même module et même instant que la température, zéros conservés et aucun emprunt historique',()=>{
 const at=Math.floor(Date.now()/1000),body=stationBody(),station=body[0];
 station.measures.outside={type:['humidity','temperature'],res:{[at-300]:[80,14],[at]:[0,16]}};
 assert.equal(publicStations(body,50.76,2.52,50)[0].humidity,0);
 station.measures.outside.res[at]=[null,16];assert.equal(publicStations(body,50.76,2.52,50)[0].humidity,null);
 for(const bad of [-1,101,'70',NaN]){station.measures.outside.res[at]=[bad,16];assert.equal(publicStations(body,50.76,2.52,50)[0].humidity,null);}
 station.measures.outside={type:['temperature'],res:{[at]:[16]}};station.measures.other={type:['humidity'],res:{[at]:[70]}};
 assert.equal(publicStations(body,50.76,2.52,50)[0].humidity,null);
 station.measures.outside={type:['temperature','humidity'],res:{[at]:[16,70]}};station.measures.other={type:['temperature','humidity'],res:{[at]:[16,80]}};
 assert.equal(publicStations(body,50.76,2.52,50)[0].humidity,null);
});

test('collecte en arrière-plan : activation explicite, propriétaire serveur et même coffre sans fausse session',async()=>{
 const env=context();let calls=0;
 await assert.rejects(collectNetatmoBackground(env,async()=>{calls++;return tokenResponse();}),/NETATMO_FORBIDDEN/);
 assert.equal(calls,0);
 await authorized(env,async()=>tokenResponse());env.METEOAI_BACKGROUND_ENABLED='true';env.METEOAI_BACKGROUND_OWNER=await digest('owner');
 const result=await collectNetatmoBackground(env,async url=>{calls++;assert.match(url,/getpublicdata/);return Response.json({body:stationBody()});});
 assert.equal(result.radiusKm,50);assert.equal(result.lat,50.7567);assert.equal(result.stations.length,1);
 await collectNetatmoBackground(env,async()=>{calls++;throw Error('Cache attendu');});assert.equal(calls,1);
 env.METEOAI_BACKGROUND_OWNER=await digest('other');await assert.rejects(collectNetatmoBackground(env),/NETATMO_NOT_CONFIGURED/);
 assert.equal((await handleNetatmo(request('status','GET',null,null),env)).status,401);
});

test('changement d’heure : cache navigateur conservé, nouvelle réception serveur partagée',async t=>{
 let now=Date.parse('2026-10-21T08:59:00Z');t.mock.method(Date,'now',()=>now);
 const env=context();await authorized(env,async()=>tokenResponse());env.METEOAI_BACKGROUND_ENABLED='true';env.METEOAI_BACKGROUND_OWNER=await digest('owner');
 let calls=0;const fetcher=async()=>{calls++;await new Promise(r=>setTimeout(r,20));return Response.json({body:stationBody()});};
 const path='stations?lat=50.7567&lon=2.5204&radiusKm=50';
 const before=await (await handleNetatmo(request(path),env,fetcher)).json();
 now+=8*60000;
 const uiCached=await (await handleNetatmo(request(path),env,fetcher)).json();assert.equal(uiCached.at,before.at);assert.equal(calls,1);
 const [first,second]=await Promise.all([collectNetatmoBackground(env,fetcher),collectNetatmoBackground(env,fetcher)]);
 assert.equal(calls,2);assert.equal(first.providerReceivedAt,now);assert.equal(second.providerReceivedAt,now);assert.notEqual(first.providerReceivedAt,before.at);
 const reused=await collectNetatmoBackground(env,fetcher);assert.equal(reused.providerReceivedAt,now);
 const uiFresh=await (await handleNetatmo(request(path),env,fetcher)).json();assert.equal(uiFresh.at,now);assert.equal(calls,2);
});

test('nouvelle heure en quota Netatmo : aucun ancien cache présenté comme une réception récente',async t=>{
 let now=Date.parse('2026-10-21T08:59:00Z');t.mock.method(Date,'now',()=>now);
 const env=context();await authorized(env,async()=>tokenResponse());env.METEOAI_BACKGROUND_ENABLED='true';env.METEOAI_BACKGROUND_OWNER=await digest('owner');
 const path='stations?lat=50.7567&lon=2.5204&radiusKm=50';
 const before=await (await handleNetatmo(request(path),env,async()=>Response.json({body:stationBody()}))).json();now+=8*60000;
 await assert.rejects(collectNetatmoBackground(env,async()=>new Response('',{status:429})),/NETATMO_RATE_LIMIT/);
 const cached=await (await handleNetatmo(request(path),env,async()=>{throw Error('Le cache utilisateur reste valide');})).json();
 assert.equal(cached.at,before.at);assert.equal(cached.stations[0].time,before.stations[0].time);
});

test('diagnostic Netatmo privé : refus réel compté une seule fois, Retry-After respecté et aucun secret ou station exposé',async t=>{
 let now=Date.parse('2026-10-22T08:00Z');t.mock.method(Date,'now',()=>now);
 const env=context();await authorized(env,async()=>tokenResponse());let calls=0;
 const fetcher=async()=>{calls++;return calls===1?new Response('',{status:429,headers:{'Retry-After':'120'}}):Response.json({body:stationBody()});};
 const get=()=>handleNetatmo(request('stations?lat=50.76&lon=2.52'),env,fetcher);
 assert.equal((await get()).status,429);assert.equal((await get()).status,429);assert.equal(calls,1);
 assert.equal((await handleNetatmo(request('diagnostic','GET',null,null),env)).status,401);
 let diagnostic=await (await handleNetatmo(request('diagnostic'),env)).json();assert.equal(diagnostic.totals.requests,1);assert.equal(diagnostic.totals.rateLimited,1);assert.equal(diagnostic.last.retryAt,now+120000);assert.equal(diagnostic.quotaRemaining,null);assert.equal(calls,1);
 const text=JSON.stringify(diagnostic);for(const secret of [clientId,clientSecret,'fixture-access','fixture-refresh','50.76','outdoor'])assert(!text.includes(secret));
 const other=await (await handleNetatmo(request('diagnostic','GET',null,'other'),env)).json();assert.equal(other.totals.requests,0);assert.equal(other.last,null);
 now+=120000;assert.equal((await get()).status,200);diagnostic=await (await handleNetatmo(request('diagnostic'),env)).json();assert.equal(diagnostic.totals.requests,2);assert.equal(diagnostic.last.code,'ok');
});

test('une panne Netatmo 503 reste distincte du quota et un délai dépassé reste distinct d’une panne HTTP',async()=>{
 for(const failure of ['http','timeout']){const env=context();await authorized(env,async()=>tokenResponse());const r=await handleNetatmo(request('stations?lat=50.76&lon=2.52'),env,async()=>{if(failure==='timeout')throw new DOMException('secret fixture','TimeoutError');return new Response('',{status:503});});assert.equal(r.status,503);
  const d=await (await handleNetatmo(request('diagnostic'),env)).json();assert.equal(d.totals.rateLimited,0);assert.equal(d.last.code,failure==='http'?'NETATMO_PROVIDER_ERROR':'NETATMO_TIMEOUT');assert.equal(d.totals.timeouts,failure==='timeout'?1:0);
 }
});
test('une panne 503 pendant le renouvellement Netatmo ne révoque pas une autorisation encore enregistrée',async()=>{
 const env=context();await authorized(env,async()=>tokenResponse());const owner=await digest('owner'),key='netatmo/vault/'+owner,vault=await unseal(await (await env.BUCKET.get(key)).text(),env.NETATMO_ENCRYPTION_KEY,owner);vault.tokens.expiresAt=0;await env.BUCKET.put(key,await seal(vault,env.NETATMO_ENCRYPTION_KEY,owner));
 const response=await handleNetatmo(request('stations?lat=50.76&lon=2.52'),env,async()=>new Response('',{status:503}));assert.equal(response.status,503);assert.equal((await response.json()).code,'NETATMO_PROVIDER_ERROR');
 const after=await unseal(await (await env.BUCKET.get(key)).text(),env.NETATMO_ENCRYPTION_KEY,owner);assert(!after.needsReconnect);assert.equal(after.tokens.refresh,'fixture-refresh');
});

test('AES-GCM authentifié : chiffré et isolé par propriétaire',async()=>{const env=context(),s=await seal({clientSecret},env.NETATMO_ENCRYPTION_KEY,'owner');assert(!s.includes(clientSecret));assert.deepEqual(await unseal(s,env.NETATMO_ENCRYPTION_KEY,'owner'),{clientSecret});await assert.rejects(unseal(s,env.NETATMO_ENCRYPTION_KEY,'other'));});
test('refuse absence d’identité, mauvaise origine et faux content-type',async()=>{const env=context();assert.equal((await handleNetatmo(request('status','GET',null,null),env)).status,401);assert.equal((await handleNetatmo(request('configure','POST',{clientId,clientSecret},'owner',{Origin:'https://intrus.example'}),env)).status,403);assert.equal((await handleNetatmo(request('configure','POST',{},'owner',{'Content-Type':'text/plain'}),env)).status,403);assert.equal(env.BUCKET.records.size,0);});
test('configuration persistante, sans secret dans status et isolée par compte',async()=>{const env=context();assert.equal((await configure(env)).status,200);assert(!JSON.stringify([...env.BUCKET.records]).includes(clientSecret));const status=await (await handleNetatmo(request('status'),env)).json();assert.equal(status.configured,true);assert.equal(status.connected,false);assert(!JSON.stringify(status).includes(clientId));assert.equal((await (await handleNetatmo(request('status','GET',null,'other'),env)).json()).configured,false);});
test('refuse identifiants et coordonnées invalides',async()=>{const env=context();assert.equal((await handleNetatmo(request('configure','POST',{clientId:'x',clientSecret:''}),env)).status,400);for(const p of ['stations?lat=NaN&lon=2','stations?lat=500&lon=2','stations?lon=2'])assert.equal((await handleNetatmo(request(p),env)).status,400);});
test('OAuth : scope lecture, cookie sécurisé et callback exact',async()=>{const env=context();await configure(env);const start=await handleNetatmo(request('connect','POST'),env),url=new URL((await start.json()).url);assert.equal(url.origin,'https://api.netatmo.com');assert.equal(url.searchParams.get('scope'),'read_station');assert.equal(url.searchParams.get('redirect_uri'),SITE_ORIGIN+'/api/netatmo/callback');assert.match(start.headers.get('Set-Cookie'),/Secure; HttpOnly; SameSite=Lax/);});
test('OAuth : refuse un state absent ou un callback rejoué',async()=>{const env=context();let calls=0;const fetcher=async()=>{calls++;return tokenResponse();};const {response,cookie,state}=await authorized(env,fetcher);assert.match(response.headers.get('Location'),/connexion-netatmo\?netatmo=connected/);const replay=await handleNetatmo(request('callback?code=fixture-code&state='+state,'GET',null,'owner',{Cookie:cookie}),env,fetcher);assert.match(replay.headers.get('Location'),/netatmo=failed/);const mismatch=await handleNetatmo(request('callback?code=x&state=bad'),env,fetcher);assert.match(mismatch.headers.get('Location'),/netatmo=failed/);assert.equal(calls,1);assert.equal((await (await handleNetatmo(request('status'),env)).json()).connected,true);});
test('refus utilisateur et état expiré : aucun échange de jeton',async()=>{const env=context();await configure(env);let start=await handleNetatmo(request('connect','POST'),env),cookie=start.headers.get('Set-Cookie').split(';')[0],state=new URL((await start.json()).url).searchParams.get('state'),calls=0;let response=await handleNetatmo(request('callback?error=access_denied&state='+state,'GET',null,'owner',{Cookie:cookie}),env,async()=>{calls++;return tokenResponse();});assert.match(response.headers.get('Location'),/failed/);start=await handleNetatmo(request('connect','POST'),env);cookie=start.headers.get('Set-Cookie').split(';')[0];state=new URL((await start.json()).url).searchParams.get('state');const owner=await digest('owner'),key='netatmo/oauth/'+owner,old=await env.BUCKET.get(key),data=await unseal(await old.text(),env.NETATMO_ENCRYPTION_KEY,owner);await env.BUCKET.put(key,await seal({...data,expires:0},env.NETATMO_ENCRYPTION_KEY,owner));response=await handleNetatmo(request('callback?code=x&state='+state,'GET',null,'owner',{Cookie:cookie}),env,async()=>{calls++;return tokenResponse();});assert.match(response.headers.get('Location'),/failed/);assert.equal(calls,0);});
test('stations extérieures : timestamp, vrai rayon et exclusion des mesures suspectes',()=>{const body=stationBody();body.push({...body[0],_id:'far',place:{location:[0,40]}});body.push({_id:'no-measure',place:{location:[2.52,50.76]},measures:{wind:{type:['wind_strength'],res:{[Date.now()/1000]:[15]}}}});const result=publicStations(body,50.76,2.52);assert.equal(result.length,1);assert.equal(result[0].temp,16.2);assert.equal(result[0].source,'Netatmo · réseau public');assert.equal(result[0].anomaly,false);assert(result[0].time>1e12);body[0].measures.outside.res={[Math.floor((Date.now()-7200000)/1000)]:[16.2,70]};assert.equal(publicStations(body,50.76,2.52)[0].anomaly,true);});
test('jeton renouvelé persistant + cache 10 minutes sans exposer de jetons',async()=>{const env=context();await authorized(env,async()=>tokenResponse());const owner=await digest('owner'),key='netatmo/vault/'+owner,object=await env.BUCKET.get(key),v=await unseal(await object.text(),env.NETATMO_ENCRYPTION_KEY,owner);v.tokens.expiresAt=0;await env.BUCKET.put(key,await seal(v,env.NETATMO_ENCRYPTION_KEY,owner));let refresh=0,weather=0;const fetcher=async(url,init)=>{if(url.endsWith('/token')){refresh++;assert.equal(new URLSearchParams(init.body).get('grant_type'),'refresh_token');return Response.json({access_token:'new-access',refresh_token:'rotated-refresh',expires_in:10800});}weather++;assert.equal(init.headers.Authorization,'Bearer new-access');return Response.json({body:stationBody()});};for(let i=0;i<2;i++){const response=await handleNetatmo(request('stations?lat=50.76&lon=2.52'),env,fetcher);assert.equal(response.status,200);const text=await response.text();assert(!text.includes('new-access'));assert.equal(JSON.parse(text).stations.length,1);}assert.equal(refresh,1);assert.equal(weather,1);const stored=await unseal(await (await env.BUCKET.get(key)).text(),env.NETATMO_ENCRYPTION_KEY,owner);assert.equal(stored.tokens.refresh,'rotated-refresh');});
test('deux Workers concurrents ne renouvellent pas deux fois un jeton tournant',async()=>{const env=context();await authorized(env,async()=>tokenResponse());const owner=await digest('owner'),key='netatmo/vault/'+owner,v=await unseal(await (await env.BUCKET.get(key)).text(),env.NETATMO_ENCRYPTION_KEY,owner);v.tokens.expiresAt=0;await env.BUCKET.put(key,await seal(v,env.NETATMO_ENCRYPTION_KEY,owner));let refresh=0;const fetcher=async url=>{if(url.endsWith('/token')){refresh++;await new Promise(r=>setTimeout(r,50));return tokenResponse();}return Response.json({body:stationBody()});};const responses=await Promise.all([handleNetatmo(request('stations?lat=50.76&lon=2.52'),env,fetcher),handleNetatmo(request('stations?lat=50.76&lon=2.52'),env,fetcher)]);assert(responses.every(r=>r.status===200));assert.equal(refresh,1);});
test('429 et 403 ne sont pas présentés comme zéro station',async()=>{for(const code of [429,403]){const env=context();await authorized(env,async()=>tokenResponse());const response=await handleNetatmo(request('stations?lat=50.76&lon=2.52'),env,async()=>new Response('',{status:code}));assert.equal(response.status,code);assert.equal((await response.json()).code,code===429?'NETATMO_RATE_LIMIT':'NETATMO_SCOPE');}});
test('suppression des identifiants : cache précédent inaccessible',async()=>{const env=context();await authorized(env,async()=>tokenResponse());await handleNetatmo(request('stations?lat=50.76&lon=2.52'),env,async()=>Response.json({body:stationBody()}));assert.equal((await handleNetatmo(request('disconnect','POST'),env)).status,200);assert.equal((await (await handleNetatmo(request('status'),env)).json()).configured,false);assert.equal((await handleNetatmo(request('stations?lat=50.76&lon=2.52'),env)).status,409);});

test('cache valide à 9 min 59 s, expiré exactement à 10 minutes',async t=>{
 const env=context();await authorized(env,async()=>tokenResponse());let calls=0,now=Date.now();t.mock.method(Date,'now',()=>now);
 const fetcher=async()=>{calls++;return Response.json({body:stationBody()});};
 const first=await (await handleNetatmo(request('stations?lat=50.76&lon=2.52'),env,fetcher)).json();
 now+=STATION_CACHE_MS-1;const cached=await (await handleNetatmo(request('stations?lat=50.76&lon=2.52'),env,fetcher)).json();
 assert.equal(calls,1);assert.equal(cached.at,first.at);assert.equal(cached.stations[0].time,first.stations[0].time);assert(cached.stations[0].reliability<first.stations[0].reliability);
 now++;await handleNetatmo(request('stations?lat=50.76&lon=2.52'),env,fetcher);assert.equal(calls,2);
});
test('deux lieux proches réutilisent la zone entière, avec distances et filtrage propres',async()=>{
 const env=context();await authorized(env,async()=>tokenResponse());let calls=0;
 const fetcher=async()=>{calls++;const body=stationBody();body.push({...body[0],_id:'north',place:{location:[2.52,50.905]}});return Response.json({body});};
 const south=await (await handleNetatmo(request('stations?lat=50.701&lon=2.52'),env,fetcher)).json();
 const north=await (await handleNetatmo(request('stations?lat=50.799&lon=2.52'),env,fetcher)).json();
 assert.equal(calls,1);assert(!south.stations.some(s=>s.id==='netatmo-north'));assert(north.stations.some(s=>s.id==='netatmo-north'));assert(north.stations.every(s=>s.distance<=20));assert.notEqual(south.stations[0].distance,north.stations.find(s=>s.id===south.stations[0].id).distance);
});
test('la boîte commune couvre les rayons aux deux bords de la cellule',()=>{
 const a=stationZone(50.701,2.501),b=stationZone(50.799,2.599);assert.equal(a.key,b.key);assert.equal(String(a.query),String(b.query));
 assert(Number(a.query.get('lat_sw'))<50.7-20/111);assert(Number(a.query.get('lat_ne'))>50.8+20/111);
 assert(Number(a.query.get('lon_sw'))<2.5-20/(111*Math.cos(50.8*Math.PI/180)));assert(Number(a.query.get('lon_ne'))>2.6+20/(111*Math.cos(50.8*Math.PI/180)));
 assert.notEqual(a.key,stationZone(50.81,2.52).key);assert.equal(stationZone(-33.95,-70.65).key,stationZone(-33.91,-70.61).key);
});
test('huit recherches simultanées proches partagent un seul getpublicdata',async()=>{
 const env=context();await authorized(env,async()=>tokenResponse());let calls=0;
 const fetcher=async()=>{calls++;await new Promise(r=>setTimeout(r,80));return Response.json({body:stationBody()});};
 const results=await Promise.all(Array.from({length:8},(_,i)=>handleNetatmo(request(`stations?lat=${50.71+i*.01}&lon=2.52`),env,fetcher)));
 assert.equal(calls,1);for(const r of results){assert.equal(r.status,200);assert(Array.isArray((await r.json()).stations));}
});
test('instances distinctes : le second attend le cache plutôt que rappeler Netatmo',async()=>{
 const env=context();await authorized(env,async()=>tokenResponse());let calls=0;
 const other={...env,BUCKET:{get:env.BUCKET.get.bind(env.BUCKET),put:env.BUCKET.put.bind(env.BUCKET),delete:env.BUCKET.delete.bind(env.BUCKET)}};
 const fetcher=async()=>{calls++;await new Promise(r=>setTimeout(r,2200));return Response.json({body:stationBody()});};
 const responses=await Promise.all([handleNetatmo(request('stations?lat=50.72&lon=2.52'),env,fetcher),handleNetatmo(request('stations?lat=50.78&lon=2.52'),other,fetcher)]);
 assert.equal(calls,1);assert(responses.every(r=>r.status===200));
});
test('zones distinctes : appels sérialisés, sans mélanger les caches',async()=>{
 const env=context();await authorized(env,async()=>tokenResponse());let active=0,peak=0,calls=0;
 const fetcher=async()=>{calls++;active++;peak=Math.max(peak,active);await new Promise(r=>setTimeout(r,30));active--;return Response.json({body:stationBody()});};
 const responses=await Promise.all([handleNetatmo(request('stations?lat=50.72&lon=2.52'),env,fetcher),handleNetatmo(request('stations?lat=50.92&lon=2.52'),env,fetcher)]);
 assert.equal(calls,2);assert.equal(peak,1);assert(responses.every(r=>r.status===200));
});
test('une erreur ne remplit pas le cache, impose une courte attente puis libère la requête partagée',async t=>{
 let now=Date.now();t.mock.method(Date,'now',()=>now);
 const env=context();await authorized(env,async()=>tokenResponse());let calls=0;
 const fetcher=async()=>{calls++;if(calls===1)throw new Error('Fixture : réseau coupé');return Response.json({body:stationBody()});};
 assert.equal((await handleNetatmo(request('stations?lat=50.76&lon=2.52'),env,fetcher)).status,503);
 assert.equal((await handleNetatmo(request('stations?lat=50.76&lon=2.52'),env,fetcher)).status,503);assert.equal(calls,1);now+=60000;
 assert.equal((await handleNetatmo(request('stations?lat=50.76&lon=2.52'),env,fetcher)).status,200);assert.equal(calls,2);
});


test('recherche 50 km : boîte étendue, filtrage réel et cache distinct du rayon historique',async()=>{
 const env=context();await authorized(env,async()=>tokenResponse());let calls=0;
 const fetcher=async url=>{calls++;const query=new URL(url).searchParams;assert(Number(query.get('lat_ne'))>51.2);const body=stationBody();body.push({...body[0],_id:'a-45km',place:{location:[2.52,50.76+45/111.195]}});body.push({...body[0],_id:'a-55km',place:{location:[2.52,50.76+55/111.195]}});return Response.json({body});};
 const path='stations?lat=50.76&lon=2.52&radiusKm=50';
 for(let i=0;i<2;i++){const response=await handleNetatmo(request(path),env,fetcher);assert.equal(response.status,200);const data=await response.json();assert.equal(data.radiusKm,50);assert(data.stations.some(s=>s.id==='netatmo-a-45km'));assert(!data.stations.some(s=>s.id==='netatmo-a-55km'));}
 assert.equal(calls,1);
 assert.notEqual(stationZone(50.76,2.52,20).key,stationZone(50.76,2.52,50).key);
 const original=await (await handleNetatmo(request('stations?lat=50.76&lon=2.52'),env,async()=>Response.json({body:stationBody()}))).json();assert.equal(original.radiusKm,20);
 for(const bad of [0,51,-1,'abc'])assert.equal((await handleNetatmo(request('stations?lat=50.76&lon=2.52&radiusKm='+bad),env)).status,400);
});


test('connexion indépendante : aucune origine de l’ancien Site admise, callback et secret propres',async()=>{
 const env=context();assert.equal((await handleNetatmo(request('status','GET',null,'owner',{Origin:'https://meteoai-atmosphere-nord.givingbay1.chatgpt.site'}),env)).status,403);
 const result=await (await handleNetatmo(request('status'),env)).json();assert.equal(result.redirectUri,SITE_ORIGIN+'/api/netatmo/callback');assert.equal(result.configured,false);
});


test('modules publics auxiliaires : types string/array, graphies historiques, zéros et heures distinctes',()=>{
 const at=Math.floor(Date.now()/1000),body=stationBody(),measures=body[0].measures;
 measures.base={type:'pressure',res:{[at-60]:[1022]}};
 measures.wind={wind_strengh:0,gust_strenght:0,wind_angle:0,wind_timeutc:at-120};
 measures.rain={rain_live:3,rain_60min:0,rain_24h:40,rain_timeutc:at-180};
 const row=publicStations(body,50.76,2.52,50)[0];
 assert.equal(row.pressure,1022);assert.equal(row.windSpeed,0);assert.equal(row.windGust,0);assert.equal(row.windDirection,0);assert.equal(row.precipitation,0);
 assert.equal(row.measurementTimes.pressure,(at-60)*1000);assert.equal(row.measurementTimes.windSpeed,(at-120)*1000);assert.equal(row.measurementTimes.precipitation,(at-180)*1000);assert.equal(row.precipitationPeriodMinutes,60);
});
test('auxiliaires contradictoires ou invalides : pas de valeur ancienne ou de cumul substitué',()=>{
 const at=Math.floor(Date.now()/1000),body=stationBody(),m=body[0].measures;
 m.base={type:['pressure'],res:{[at-60]:[1022],[at]:[null]}};m.wind={wind_strength:12,wind_strengh:20,gust_strength:500,wind_timeutc:at};m.rain={rain_live:5,rain_24h:20,rain_timeutc:at};
 let row=publicStations(body,50.76,2.52,50)[0];for(const field of ['pressure','windSpeed','windGust','precipitation']){assert.equal(row[field],null);assert.equal(row.measurementTimes[field],undefined);}
 m.base.res={[at]:[1020]};m.other={type:'pressure',res:{[at]:[1022]}};row=publicStations(body,50.76,2.52,50)[0];assert.equal(row.pressure,null);
});

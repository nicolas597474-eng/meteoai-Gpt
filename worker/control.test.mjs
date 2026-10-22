import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readdir} from 'node:fs/promises';
import worker from '../dist/server/index.js';
const env={DB:{prepare(){throw new Error('Accès DB inattendu');}},BUCKET:{get:async()=>null,put:async()=>{throw new Error('Écriture inattendue');}}},ctx={waitUntil(){}};
const base='https://controle.example';
test('les images inconnues ne deviennent pas une page HTML',async()=>{const r=await worker.fetch(new Request(base+'/manus-storage/inconnu.png'),env,ctx);assert.equal(r.status,404);});
test('l’historique nécessite une identité ChatGPT',async()=>{const r=await worker.fetch(new Request(base+'/api/control/history'),env,ctx);assert.equal(r.status,401);});
test('une capture navigateur sans identité ne peut pas écrire',async()=>{const r=await worker.fetch(new Request(base+'/api/history/capture',{method:'POST',body:'{}'}),env,ctx);assert.equal(r.status,401);});
test('les mesures Netatmo sans identité ne peuvent pas être archivées',async()=>{const r=await worker.fetch(new Request(base+'/api/history/stations',{method:'POST',headers:{Origin:base,'Content-Type':'application/json'},body:'{}'}),env,ctx);assert.equal(r.status,401);});

test('une période historique invalide est refusée avant toute lecture',async()=>{for(const days of ['0','-7','365','inconnu']){const r=await worker.fetch(new Request(base+'/api/history/comparisons?days='+days),env,ctx);assert.equal(r.status,400);}});
test('un lot d’import inconnu ne déclenche aucune écriture',async()=>{const r=await worker.fetch(new Request(base+'/api/control/import-history',{method:'POST',headers:{'Content-Type':'application/json'},body:'[]'}),env,ctx);assert.equal(r.status,400);});
test('une image altérée ne déclenche aucune écriture',async()=>{const r=await worker.fetch(new Request(base+'/api/control/assets/meteo3d-sunny_9181afc4.png',{method:'PUT',body:'image altérée'}),env,ctx);assert.equal(r.status,400);});
test('les mutations non migrées ne prétendent pas réussir',async()=>{const r=await worker.fetch(new Request(base+'/api/trpc/weather.changeWeights',{method:'POST',body:'{}'}),env,ctx);assert.equal(r.status,405);});
test('coordonnées invalides : pas d’appel fournisseur',async()=>{const r=await worker.fetch(new Request(base+'/api/trpc/weather.getDetailedForecast?input='+encodeURIComponent(JSON.stringify({json:{lat:999,lon:2}}))),env,ctx);const data=await r.json();assert.match(data.error.json.message,/Coordonnées/);});
test('coquille et service worker ont le bon type et un cache renouvelable',async()=>{for(const path of ['/','/sw.js']){const r=await worker.fetch(new Request(base+path),env,ctx);assert.equal(r.status,200);assert.equal(r.headers.get('Cache-Control'),'no-cache');assert.equal(r.headers.get('X-Content-Type-Options'),'nosniff');}});
test('le service worker publié prépare tous les chunks React et possède une version de contenu',async()=>{const code=await (await worker.fetch(new Request(base+'/sw.js'),env,ctx)).text();assert(!code.includes('__BUILD_VERSION__'));const urls=JSON.parse(code.match(/const PRECACHE_URLS = (\[[^;]+\]);/)[1]);for(const file of await readdir('dist/client/assets'))if(/\.(js|css)$/.test(file))assert(urls.includes('/assets/'+file),'Actif hors ligne manquant : '+file);assert(urls.includes('/assets/icons/icon-192.png'));assert(urls.includes('/manifest.webmanifest'));});

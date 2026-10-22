import {createServer} from 'node:http';
import {randomBytes} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {mkdir,readFile,writeFile,readdir} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import worker from '../dist/server/index.js';
import {build} from 'esbuild';
await mkdir('qa',{recursive:true});
await build({entryPoints:['client/src/lib/forecastOffline.ts'],outfile:'qa/forecast-cache.mjs',bundle:true,format:'esm',platform:'browser'});
// Contrôle local de CacheStorage réel ; aucune route QA n'est publiée par le Worker.
const cacheQaHtml=`<!doctype html><html lang="fr"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Contrôle local du cache MeteoAI</title><style>body{max-width:700px;margin:24px auto;padding:16px;background:#071426;color:white;font:16px/1.6 system-ui}button{padding:12px;color:white;background:#164e80;border:1px solid #83caff;border-radius:12px}pre{white-space:pre-wrap}</style><h1>Cache météo du navigateur</h1><p>Ce contrôle relit les vraies prévisions enregistrées. Le chargeur réseau est désactivé pour ce test ; la connexion de l’appareil reste inchangée.</p><button id="run">Relire les prévisions sans chargeur réseau</button><pre id="report" role="status">Prêt.</pre><script type="module">import {ForecastOfflineCache,FORECAST_CACHE} from '/qa/forecast-cache.mjs';document.querySelector('#run').onclick=async()=>{try{let calls=0;const stored=await caches.open(FORECAST_CACHE),keys=await stored.keys();if(!keys.length)throw Error('Aucune prévision enregistrée. Ouvrir le Dashboard connecté puis réessayer.');const results=[];const cache=new ForecastOfflineCache({origin:location.origin,storage:caches,online:()=>false});for(const request of keys){const key=decodeURIComponent(new URL(request.url).pathname.split('/').pop());const value=await cache.get(key,async()=>{calls++;throw Error('Réseau désactivé pour le contrôle');});const data=value.entry.payload.json;results.push({procedure:JSON.parse(key)[0],savedAt:new Date(value.entry.savedAt).toISOString(),reason:value.reason,hours:data.hours?.length??0,days:data.days?.length??0,models:data.models?.length??0});}const shell=(await caches.keys()).filter(k=>k.startsWith('meteoai-shell-'));let assets=0;for(const key of shell)assets+=(await (await caches.open(key)).keys()).length;document.querySelector('#report').textContent=JSON.stringify({networkLoaderCalls:calls,forecasts:results,shellCaches:shell,shellAssets:assets,serviceWorkerControlled:!!navigator.serviceWorker.controller},null,2);}catch(error){document.querySelector('#report').textContent=error.message;}};</script></html>`;
const root=process.cwd(),state=join(root,'preview-state','journal-qa');await mkdir(state,{recursive:true});
const sqlite=new DatabaseSync(join(state,'control.sqlite'));
const present=sqlite.prepare("SELECT name FROM sqlite_master WHERE name='site_users'").get();
if(!present){const journal=JSON.parse(await readFile('drizzle/meta/_journal.json','utf8'));for(const entry of journal.entries)sqlite.exec(await readFile('drizzle/'+entry.tag+'.sql','utf8'));}
const DB={prepare(sql){return {bind(...args){return {async first(){return sqlite.prepare(sql).get(...args)??null;},async all(){return {results:sqlite.prepare(sql).all(...args)};},async run(){return sqlite.prepare(sql).run(...args);},sql,args};},async all(){return {results:sqlite.prepare(sql).all()};},async first(){return sqlite.prepare(sql).get()??null;}};},async batch(statements){sqlite.exec('BEGIN');try{const out=statements.map(s=>sqlite.prepare(s.sql).run(...s.args));sqlite.exec('COMMIT');return out;}catch(e){sqlite.exec('ROLLBACK');throw e;}}};
const BUCKET={async put(key,value){const p=join(state,'r2',key);await mkdir(resolve(p,'..'),{recursive:true});await writeFile(p,typeof value==='string'?value:new Uint8Array(value));},async get(key){try{const body=await readFile(join(state,'r2',key));return {body,json:async()=>JSON.parse(body.toString()),arrayBuffer:async()=>body.buffer.slice(body.byteOffset,body.byteOffset+body.byteLength)};}catch{return null;}}};
const env={DB,BUCKET,NETATMO_ENCRYPTION_KEY:randomBytes(32).toString('base64')},ctx={waitUntil(p){p.catch(e=>console.error('Tâche locale :',e.message));}};
// Identité réservée au serveur de QA lié à 127.0.0.1 ; absente du Worker publié.
const localHeaders={'oai-authenticated-user-id':'controle-local','oai-authenticated-user-email':'controle-local@example.invalid'};
for(const file of await readdir('client/public/manus-storage'))await BUCKET.put('recovery/assets/'+file,await readFile('client/public/manus-storage/'+file));
// Une copie GitHub neuve démarre avec une base vide. Les exports privés restent facultatifs et hors Git.
const privateImports=await readdir('private-import').catch(error=>{if(error.code==='ENOENT')return [];throw error;});
for(const file of privateImports){
 const response=await worker.fetch(new Request('http://127.0.0.1:33076/api/control/import-history',{method:'POST',headers:{...localHeaders,'Content-Type':'application/json'},body:await readFile('private-import/'+file)}),env,ctx);
 if(!response.ok)throw new Error('Import local échoué : '+await response.text());
}
const server=createServer(async(req,res)=>{try{
 if(req.url.startsWith('/qa/offline-ui')){
  const requested=new URL('http://127.0.0.1'+req.url).searchParams.get('page');
  const target=['/ai-lab','/details'].includes(requested)?requested:'/';
  const response=await worker.fetch(new Request('http://127.0.0.1:33076/'),env,ctx);
  const html=(await response.text()).replace('<head>','<head><script>Object.defineProperty(navigator,"onLine",{value:false,configurable:true});history.replaceState(null,"",'+JSON.stringify(target)+');</script>').replace('<body>','<body><p style="margin:0;padding:8px;background:#4b3211;color:white;font:13px system-ui">Contrôle local : connexion simulée hors ligne pour cette page uniquement.</p>');
  res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'});res.end(html);return;
 }
 if(req.url==='/qa/offline'){res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'});res.end(cacheQaHtml);return;}
 if(req.url==='/qa/forecast-cache.mjs'){res.writeHead(200,{'Content-Type':'text/javascript; charset=utf-8','Cache-Control':'no-store'});res.end(await readFile('qa/forecast-cache.mjs'));return;}
 const chunks=[];for await(const c of req)chunks.push(c);const request=new Request('http://127.0.0.1:33076'+req.url,{method:req.method,headers:{...req.headers,...localHeaders},...(!['GET','HEAD'].includes(req.method)?{body:Buffer.concat(chunks)}:{})});const result=await worker.fetch(request,env,ctx);res.writeHead(result.status,Object.fromEntries(result.headers));res.end(Buffer.from(await result.arrayBuffer()));}catch(e){console.error(e.message);res.writeHead(500);res.end('Erreur locale');}});
server.listen(33076,'127.0.0.1',()=>console.log('Local: http://127.0.0.1:33076'));

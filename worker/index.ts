import {readHistoryPage,readReportPage} from './history-pages';
import {receiveMeteoAIForecast} from './meteoai-receipt';
import {handleAssistantGemini} from './assistant-gemini';
import {readWeightHistory,compareSnapshots} from './fusion-snapshots';
import {recordCollectionJournal} from './collection-journal';
import {recordDailyCaptureRequest} from './daily-capture-request';
import {recordDailyCapture} from './daily-archive';
import {recordServerObservations} from './server-observations';
import {finalizePhysicalReferences,readPhysicalReferenceEvidence} from './physical-reference-store';
import {finalizeLearningDays,readLearningHistory,recordLearningForecast} from './learning-store';
import {refreshQualifiedLearning} from './learning-collection';
import {readDailyEvidence} from './daily-evidence';
import {readComparisonDiagnostics} from './comparison-diagnostics';
import {readOpenMeteoDiagnostic,flushOpenMeteoTraffic,hasUnflushedOpenMeteoTraffic} from './open-meteo-diagnostics';
import superjson from 'superjson';
import {handleNetatmo} from './netatmo-api.mjs';
import {handleBackgroundCollection} from './background-collection';
import {serverWeatherQuota} from './provider-rate-limit';
import {searchStations} from './station-search';
import {readStationOverview} from './station-overview';
import {getCurrentStationRankingContract} from '../shared/currentStationRankingContract';
import {readArchiveCollectionReport} from './archive-diagnostics';
import {RESTORED_PAGE_READS,restoredPageRead} from './restored-page-contracts';
import {readReliability,readReliabilityYesterday} from './reliability';
import {favoriteProcedure,FAVORITE_MUTATIONS} from './favorites';
import {ApiError} from './api-error';
import {personalJournal,PERSONAL_JOURNAL_MUTATIONS} from './personal-journal';
import {current,detailed,daily,aiLab,regimeCatalogue,liveModelComparison} from './weather';
import {ASSET_MANIFEST,IMPORT_MANIFEST} from './import-manifest';
import {getWeatherProviderDiagnostics} from '../server/weatherFetch';
import {recordCapture,archiveStatus,collectorStatus,verifyLatestCapture} from './archive';
import {collectHourlyForecastAllModelsWithDiagnostics} from '../server/weatherServices';
import {getParisDate} from '../server/weatherTime';
import {recordObservations,observationStatus,verifyLatestObservations,observationSummaryHtml} from './station-observations';
import {readProvisionalComparisons,comparisonHtml} from './provisional-comparisons';
declare const EMBEDDED_ASSETS: Record<string,{body:string,type:string}>;
const MUTATIONS=new Set([...FAVORITE_MUTATIONS,...PERSONAL_JOURNAL_MUTATIONS]);
type Env={DB:any;BUCKET:any;NETATMO_ENCRYPTION_KEY?:string;GEMINI_API_KEY?:string;GEMINI_ENABLED?:string};
const json=(data:any,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
const digest=async(bytes:ArrayBuffer)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))).map(v=>v.toString(16).padStart(2,'0')).join('');
async function identity(request:Request,env:Env){
 const subject=request.headers.get('oai-authenticated-user-id');if(!subject)return null;
 const row=await env.DB.prepare('SELECT id FROM site_users WHERE subject=?').bind(subject).first();
 let id=row?.id;
 if(!id){await env.DB.prepare('INSERT INTO site_users(subject,created_at) VALUES (?,?) ON CONFLICT(subject) DO NOTHING').bind(subject,new Date().toISOString()).run();id=(await env.DB.prepare('SELECT id FROM site_users WHERE subject=?').bind(subject).first())?.id;}
 return {id,openId:subject,name:request.headers.get('oai-authenticated-user-full-name')??'Mon compte',email:request.headers.get('oai-authenticated-user-email'),role:'user',loginMethod:'chatgpt'};
}
async function control(request:Request,env:Env,path:string){
 if(path==='/api/control/provider-diagnostics'){
  let direct:any;
  try{const r=await fetch('https://api.open-meteo.com/v1/forecast?latitude=50.7567&longitude=2.5204&current=temperature_2m&timeformat=unixtime',{signal:AbortSignal.timeout(6000)});const b=await r.json();direct={status:r.status,hasCurrent:!!b.current,reason:b.reason??null};}catch(e){direct={error:e instanceof Error?e.message:'Échec réseau'};}
  return json({direct,collectors:getWeatherProviderDiagnostics(),abortAny:typeof AbortSignal.any});
 }
 // Site déclaré privé : le contrôle d'accès de la plateforme protège aussi
 // les imports serveur autorisés, sans fabriquer une identité de visiteur.
 if(path.startsWith('/api/control/assets/')&&request.method==='PUT'){
  const name=decodeURIComponent(path.slice('/api/control/assets/'.length));
  const expected=ASSET_MANIFEST[name];if(!expected)return json({error:'Ressource inconnue'},404);
  if(Number(request.headers.get('content-length')??0)>6000000)return json({error:'Taille excessive'},413);
  const bytes=await request.arrayBuffer();if(bytes.byteLength!==expected.bytes||await digest(bytes)!==expected.sha256)return json({error:'Empreinte incorrecte'},400);
  await env.BUCKET.put('recovery/assets/'+name,bytes,{httpMetadata:{contentType:expected.type}});return json({stored:true,name,bytes:bytes.byteLength});
 }
 if(path==='/api/control/import-history'&&request.method==='POST'){
  if(!request.headers.get('content-type')?.includes('application/json'))return json({error:'Format JSON requis'},415);
  const bytes=await request.arrayBuffer();if(bytes.byteLength>1000000)return json({error:'Lot trop grand'},413);
  const hash=await digest(bytes),expected=IMPORT_MANIFEST[hash];if(!expected)return json({error:'Lot absent du manifeste vérifié'},400);
  const rows=JSON.parse(new TextDecoder().decode(bytes));if(rows.length!==expected.rows)return json({error:'Nombre de lignes incorrect'},400);
  await env.DB.batch(rows.map((r:any)=>env.DB.prepare('INSERT INTO recovery_weather_history(source_table,source_id,weather_date,payload,digest) VALUES (?,?,?,?,?) ON CONFLICT(source_table,source_id) DO UPDATE SET weather_date=excluded.weather_date,payload=excluded.payload,digest=excluded.digest').bind(r.table,r.id,r.date,JSON.stringify(r.payload),r.digest)));
  return json({imported:rows.length,hash});
 }
 if(path==='/api/control/verify-history'&&request.method==='POST'){
  const bytes=await request.arrayBuffer();if(bytes.byteLength>1000000)return json({error:'Lot trop grand'},413);
  const hash=await digest(bytes),expected=IMPORT_MANIFEST[hash];if(!expected)return json({error:'Lot inconnu'},400);
  const rows=JSON.parse(new TextDecoder().decode(bytes));
  const stable=(v:any):any=>Array.isArray(v)?v.map(stable):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,stable(v[k])])):v;
  let verified=0;
  for(const row of rows){const actual=await env.DB.prepare('SELECT payload,digest FROM recovery_weather_history WHERE source_table=? AND source_id=?').bind(row.table,row.id).first();if(!actual||actual.digest!==row.digest||JSON.stringify(stable(JSON.parse(actual.payload)))!==JSON.stringify(stable(row.payload)))return json({error:'Valeur importée non conforme',table:row.table,id:row.id},409);verified++;}
  return json({verified,hash});
 }
 if(path==='/api/control/status'){
  const rows=await env.DB.prepare('SELECT source_table AS sourceTable,COUNT(*) AS rows FROM recovery_weather_history GROUP BY source_table').all();
  const response=await handleNetatmo(new Request(new URL('/api/netatmo/status',request.url),{headers:request.headers}),env);
   const state=await response.json() as any;
   const netatmo=response.ok?{configured:state.configured===true,connected:state.connected===true,needsReconnect:state.needsReconnect===true}:{status:response.status===401?'authentication_required':'unavailable'};
   return json({stage:'controle',history:{scope:'échantillon restauré et nouvelles archives séparées ; historique incomplet',tables:rows.results},calibration:'voir_les_preuves_qualifiees',netatmo});
 }
 if(path==='/api/control/history'){
  const user=await identity(request,env);if(!user)return json({error:'Connexion ChatGPT requise'},401);
  const rows=await env.DB.prepare('SELECT source_table AS sourceTable,source_id AS sourceId,weather_date AS date,payload,digest FROM recovery_weather_history ORDER BY weather_date DESC,source_id DESC LIMIT 100').all();
  return json({scope:'100 lignes de l’échantillon réel de restauration, pas tout l’historique',rows:rows.results.map((r:any)=>({...r,payload:JSON.parse(r.payload)}))});
 }
 return json({error:'Route inconnue'},404);
}
async function procedure(name:string,input:any,request:Request,env:Env,ctx:any){
 if(name==='weather.getReliabilityLaboratory')return readReliability(input,env);
 if(name==='weather.getYesterdayForecastObservation')return readReliabilityYesterday(input,env);
 if(name==='weather.getStationReliabilityOverview')return readStationOverview(input,request,env);
 if(name==='weather.getHistory')return readHistoryPage(input,env);
 if(name==='weather.getReport')return readReportPage(input,env);
 if(name==='weather.getWeightTraceHistory')return readWeightHistory(input,env);
 if(name==='weather.compareWeightSnapshots')return compareSnapshots(input,env);
 if(RESTORED_PAGE_READS.has(name))return restoredPageRead(name,input);
 switch(name){
  case 'auth.me':return identity(request,env);
  case 'auth.logout':return {success:true};
  case 'weather.getCurrentModelSnapshot':return current(input,env,ctx);
  case 'weather.getModelComparison':return liveModelComparison(input,env,ctx);
  case 'weather.getAILab':return aiLab(input,env,ctx);
  case 'weather.searchStations':return searchStations(input,request,env);
  case 'weather.getStationRankingCriteria':return getCurrentStationRankingContract();
  case 'weather.getForecastCollectionReport':return readArchiveCollectionReport(input,request,env);
  case 'weather.getHourlyComparisonDiagnostics':return readComparisonDiagnostics(input,request,env);
  case 'weather.getEvidenceStatus':return readDailyEvidence(input,request,env);
  case 'weather.getDetailedForecast':return detailed(input,env,ctx);
  case 'weather.getDashboardDailyForecast':return daily(input,env,ctx);
  case 'weather.get15DayForecast':return daily(input,env,ctx);
  case 'weather.getHourlyForecast':return detailed(input,env,ctx);
  case 'weather.getRegimeCatalogue':return regimeCatalogue();
  case 'weather.getDashboard':return null;
  case 'favorites.getCurrentDashboardWeather':return null;
  case 'favorites.list':return favoriteProcedure(name,input,(await identity(request,env))?.id,env.DB);
  case 'favorites.add':case 'favorites.update':case 'favorites.delete':case 'favorites.setDefault':return favoriteProcedure(name,input,(await identity(request,env))?.id,env.DB);
  case 'favorites.getPreloadedForecasts':return [];
  case 'personalObservations.history':case 'personalObservations.submit':case 'personalObservations.update':case 'personalObservations.delete':return personalJournal(name,input,(await identity(request,env))?.id,env.DB);
  default:throw new Error('Cette fonction est en cours de migration dans la version de contrôle.');
 }
}
const MIME:Record<string,string>={html:'text/html; charset=utf-8',js:'text/javascript; charset=utf-8',css:'text/css; charset=utf-8',json:'application/json',webmanifest:'application/manifest+json',svg:'image/svg+xml',png:'image/png',webp:'image/webp',jpg:'image/jpeg',woff2:'font/woff2'};
export default {async fetch(request:Request,env:Env,ctx:any){
 const originalWaitUntil=typeof ctx?.waitUntil==='function'?ctx.waitUntil.bind(ctx):(promise:Promise<unknown>)=>{void promise.catch(()=>{});};
 ctx={waitUntil(promise:Promise<unknown>){originalWaitUntil(Promise.resolve(promise).finally(()=>flushOpenMeteoTraffic(env)));}};
 // Cette capacité reste interne au Worker ; aucun POST client ne peut se déclarer source serveur.
 env={...env,openMeteoQuota:serverWeatherQuota(env),getLearningEvidence:async(coords:any)=>coords.lat===50.7567&&coords.lon===2.5204?readLearningHistory(env):null,archiveDailyForecasts:async(payload:any)=>{
  await recordDailyCapture(payload,env,'server');await recordLearningForecast(payload,env);
 },archivePhysicalStations:async(payload:any)=>{
  const result=await recordServerObservations(payload,env);
  if(payload.lat===50.7567&&payload.lon===2.5204&&payload.radiusKm===50){
   try{await finalizePhysicalReferences(env);}catch{console.warn('Références physiques indisponibles ; mesures serveur conservées.');}
   ctx.waitUntil(refreshQualifiedLearning(env).catch(()=>console.warn('Reprise de l’apprentissage indisponible ; archives conservées.')));
  }
  return result;
 }} as Env;
 const url=new URL(request.url),path=url.pathname;
 try{
  if(path==='/api/history/meteoai-forecast')return receiveMeteoAIForecast(request,env);
  if(path==='/api/assistant/gemini')return handleAssistantGemini(request,env);
  if(path==='/api/automation/hourly-collection')return handleBackgroundCollection(request,env);
  if(path.startsWith('/api/netatmo/'))return handleNetatmo(request,env);
  if(path==='/health')return json({ok:true,stage:'controle-restauration'});
  if(path==='/api/history/open-meteo-diagnostic'){
   if(request.method!=='GET')return json({error:'Méthode non autorisée'},405);
   if(!request.headers.get('oai-authenticated-user-id'))return json({error:'Connexion ChatGPT requise'},401);
   return json(await readOpenMeteoDiagnostic(env));
  }
  if(path==='/api/history/learning-evidence'&&request.method==='GET'){
   if(Number(url.searchParams.get('lat'))!==50.7567||Number(url.searchParams.get('lon'))!==2.5204)return json({version:1,scope:'not_covered',available:false,units:[]});
   // Historique agrégé partagé, protégé par le Site propriétaire privé ; aucun compte ni station exposé.
   try{return json(await readLearningHistory(env));}catch{return json({error:'Historique des scores qualifiés indisponible'},503);}
  }
  if(path==='/api/control/finalize-physical-references'){
   // Agrégats partagés du Site propriétaire privé, protégé par Sites comme /history/collect.
   // Aucun compte, identifiant de station ou contenu navigateur n'est accepté comme source.
   if(request.method!=='POST')return json({error:'Méthode non autorisée'},405);
   if(request.headers.get('Origin')!==url.origin||!request.headers.get('Content-Type')?.startsWith('application/json'))return json({error:'Origine ou format non autorisé'},403);
   if(Number(request.headers.get('Content-Length')??0)>32)return json({error:'Requête trop grande'},413);
   const text=await request.text();if(text.length>32)return json({error:'Requête trop grande'},413);
   let input;try{input=JSON.parse(text);}catch{return json({error:'JSON invalide'},400);}
   if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).length)return json({error:'Aucune donnée client acceptée'},400);
   try{
    const references=await finalizePhysicalReferences(env).catch(()=>null);let learning:any;
    try{
     learning=await refreshQualifiedLearning(env);
    }catch{learning={available:false};}
    if(!references)return json({error:'Reprise des références indisponible ; archives conservées'},503);
    return json({...references,evidence:await readPhysicalReferenceEvidence(env),learning});
   }
   catch{return json({error:'Reprise des références indisponible ; archives conservées'},503);}
  }
  if(path==='/api/history/collection-journal'&&request.method==='POST'){
   if(!request.headers.get('oai-authenticated-user-id'))return json({error:'Connexion ChatGPT requise'},401);
   if(request.headers.get('Origin')!==url.origin||!request.headers.get('Content-Type')?.startsWith('application/json'))return json({error:'Origine ou format non autorisé'},403);
   const text=await request.text();if(text.length>50000)return json({error:'Journal trop grand'},413);
   let input;try{input=JSON.parse(text);}catch{return json({error:'JSON invalide'},400);}
   try{return json(await recordCollectionJournal(input,env));}catch{return json({error:'Journal non enregistré ; contenu invalide ou stockage indisponible'},503);}
  }
  if(path==='/api/history/daily-capture'&&request.method==='POST'){
   if(!request.headers.get('oai-authenticated-user-id'))return json({error:'Connexion ChatGPT requise'},401);
   if(request.headers.get('Origin')!==url.origin||!request.headers.get('Content-Type')?.startsWith('application/json'))return json({error:'Origine ou format non autorisé'},403);
   const text=await request.text();if(text.length>100000)return json({error:'Capture quotidienne trop grande'},413);
   let input;try{input=JSON.parse(text);}catch{return json({error:'JSON invalide'},400);}
   const result=await recordDailyCaptureRequest(input,env);return json(result.body,result.status);
  }
  if(path==='/api/history/comparisons'&&request.method==='GET'){
   const days=Number(url.searchParams.get('days')??7);
   if(days!==7&&days!==14&&days!==30)return json({error:'Période autorisée : 7, 14 ou 30 jours'},400);
   return json(await readProvisionalComparisons(env,Date.now(),days));
  }
  if(path==='/api/history/stations/status'&&request.method==='GET')return json(await observationStatus(env));
  if(path==='/api/history/stations/verify'&&request.method==='GET')return json(await verifyLatestObservations(env));
  if(path==='/api/history/stations'&&request.method==='POST'){
   if(!await identity(request,env))return json({error:'Connexion ChatGPT requise'},401);
   if(request.headers.get('Origin')!==url.origin||!request.headers.get('Content-Type')?.startsWith('application/json'))return json({error:'Origine ou format non autorisé'},403);
   const text=await request.text();if(text.length>256000)return json({error:'Lot trop grand'},413);
   let input;try{input=JSON.parse(text);}catch{return json({error:'JSON invalide'},400);}
   try{return json(await recordObservations(input,env));}catch(error){console.error('Archivage stations :',error instanceof Error?error.message:'échec');return json({error:'Mesures non enregistrées ; réessayez ultérieurement'},503);}
  }
  if(path==='/api/history/status'&&request.method==='GET')return json(await archiveStatus(env));
  if(path==='/api/history/verify'&&request.method==='GET')return json(await verifyLatestCapture(env));
  if(path==='/api/history/capture'&&request.method==='POST'){
   if(!await identity(request,env))return json({error:'Connexion ChatGPT requise'},401);
   const text=await request.text();if(text.length>2000000)return json({error:'Capture trop grande'},413);
   try{return json(await recordCapture(JSON.parse(text),env,'browser'));}catch(error){return json({error:error instanceof Error?error.message:'Capture invalide'},400);}
  }
  if(path==='/api/history/collect'&&request.method==='POST'){
   // Action serveur réservée au Site privé par le contrôle d'accès Sites.
   // Aucun jeton Netatmo ni identité de visiteur n'est requis ou fabriqué.
   const id='50.757_2.520/'+new Date().toISOString().slice(0,13)+'/server';
   if(await env.DB.prepare('SELECT id FROM weather_captures WHERE id=?').bind(id).first())return json({stored:false,duplicate:true,id});
   try{
    const capturedAt=Date.now();
    const collection=await collectHourlyForecastAllModelsWithDiagnostics(getParisDate(),{lat:50.7567,lon:2.5204},{includeBestMatch:false,includeNextDay:true,forecastDays:2,timeoutMs:6000,retryBudgetMs:0});
    if(!collection.forecasts.length)throw new Error('Fournisseur indisponible : '+collection.diagnostics.map(d=>d.modelName+' '+(d.errorCode??d.status)).join(', '));
    const result=await recordCapture({capturedAt,lat:50.7567,lon:2.5204,models:collection.forecasts},env,'server');
    await collectorStatus(env,'ok','Capture de prévisions futures ; aucune observation fabriquée');return json(result);
   }catch(error){const message=error instanceof Error?error.message:'Échec du fournisseur';await collectorStatus(env,'failed',message);return json({stored:false,error:message},503);}
  }
  if(path==='/suivi-historique'){
   if(!await identity(request,env))return new Response('Connexion ChatGPT requise',{status:401});
   const state=await archiveStatus(env),esc=(v:any)=>String(v??'—').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
   const dateFR=(v:string)=>new Date(v).toLocaleString('fr-FR',{timeZone:'Europe/Paris'});
   const stationState=await observationStatus(env);
   const comparisons=await readProvisionalComparisons(env).catch(()=>null);
   return new Response(`<!doctype html><html lang="fr"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Reprise de l’historique MeteoAI</title><style>body{margin:0;background:#071426;color:#edf6ff;font:16px/1.6 system-ui}main{max-width:680px;margin:auto;padding:20px}a{color:#65d4ff}article{padding:16px;margin:12px 0;border:1px solid #29608c;border-radius:16px;background:#0c2238}h1{font-size:25px}p{overflow-wrap:anywhere}td,th{text-align:left;padding:10px 5px;border-bottom:1px solid #315676;font-size:15px}</style><main><a href="/">← Retour à la météo</a><h1>Reprise de l’historique</h1><p>Les périodes manquantes restent des lacunes. Les anciennes données ne sont ni écrasées ni recréées.</p><article><h2>Sauvegarde récupérée</h2>${state.legacy.map((r:any)=>`<p>${esc(r.name)} : ${esc(r.rows)} lignes · ${esc(r.firstDate)} → ${esc(r.lastDate)}</p>`).join('')}<a href="/controle-historique">Voir les données récupérées</a></article><article><h2>Nouvelles prévisions archivées</h2>${state.captures.length?state.captures.map((r:any)=>`<p>${r.origin==='server'?'Collecte serveur':'Collecte depuis votre appareil'} : ${esc(r.captures)} capture(s), ${esc(r.forecasts)} échéances réparties entre les modèles.<br>Première réception : ${esc(dateFR(r.firstCapture))}<br>Dernière réception : ${esc(dateFR(r.lastCapture))}</p>`).join(''):'<p>Aucune capture reçue pour le moment. Ouvrez la météo pour commencer.</p>'}<p>Une capture maximum par heure et par canal. Les échéances passées sont exclues.</p></article>${observationSummaryHtml(stationState)}${comparisons?comparisonHtml(comparisons):'<article><h2>Prévu / mesuré</h2><p>Le contrôle des comparaisons est momentanément indisponible. Les archives restent conservées.</p></article>'}<article><h2>Collecte sans ouvrir l’application</h2>${state.attempts.length?state.attempts.map((r:any)=>`<p>Dernier essai : ${esc(dateFR(r.attemptedAt))} · ${r.status==='ok'?'réussi':'échec'}<br>${r.status==='ok'?'Prévisions futures archivées.':'Le fournisseur météo refuse les appels depuis le serveur. La collecte automatique reste à activer.'}</p>`).join(''):'<p>Collecte serveur automatique non activée : accès fournisseur à vérifier.</p>'}</article><article><h2>Apprentissage</h2><p>Les nouvelles captures sont des prévisions, pas des observations. La calibration reste inactive jusqu’au raccordement des mesures réelles et de l’historique qualifié. Les captures provenant du navigateur ne sont pas admises comme preuves de calibration.</p></article></main></html>`,{headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'}});
  }
  if(path==='/controle-historique'){
   const user=await identity(request,env);if(!user)return new Response('Connexion ChatGPT requise',{status:401});
   const counts=await env.DB.prepare('SELECT source_table AS name,COUNT(*) AS n FROM recovery_weather_history GROUP BY source_table').all();
   const records=await env.DB.prepare('SELECT source_table AS name,weather_date AS date,payload FROM recovery_weather_history ORDER BY weather_date DESC LIMIT 40').all();
   const esc=(v:any)=>String(v??'—').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
   return new Response(`<!doctype html><html lang="fr"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Contrôle de l’historique MeteoAI</title><style>body{margin:0;background:#071426;color:#edf6ff;font:16px/1.6 system-ui}main{max-width:680px;margin:auto;padding:20px}a{color:#65d4ff}article{padding:14px;margin:12px 0;border:1px solid #29608c;border-radius:16px;background:#0c2238}table{width:100%;font-size:13px;border-collapse:collapse}td,th{text-align:left;padding:8px 4px;border-bottom:1px solid #284158}h1{font-size:24px}</style><main><a href="/">← Retour à la météo</a><h1>Historique récupéré : contrôle</h1><p>Échantillon réel de la sauvegarde. Ce contrôle ne représente pas encore l’intégralité de votre historique et n’active pas la calibration.</p>${counts.results.map((r:any)=>`<article><strong>${esc(r.name)}</strong> : ${esc(r.n)} lignes préservées</article>`).join('')}<h2>Dernières lignes de l’échantillon</h2><table><thead><tr><th>Date</th><th>Table</th><th>Température</th></tr></thead><tbody>${records.results.map((r:any)=>{const p=JSON.parse(r.payload);return `<tr><td>${esc(r.date)}</td><td>${esc(r.name)}</td><td>${esc(p.tempMax??p.temperature??p.temp??null)} °C</td></tr>`;}).join('')}</tbody></table></main></html>`,{headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'}});
  }
  if(path.startsWith('/api/control/'))return control(request,env,path);
  if(path.startsWith('/api/trpc/')){
   const names=path.slice('/api/trpc/'.length).split(',');if(names.length>20)return json({error:'Lot trop grand'},400);
   const mutation=request.method==='POST';
   if(request.method!=='GET'&&!mutation||mutation&&names.some(n=>!MUTATIONS.has(n))||!mutation&&names.some(n=>MUTATIONS.has(n)))return json({error:'Méthode non disponible'},405);
   if(mutation&&(request.headers.get('Origin')!==url.origin||!request.headers.get('Content-Type')?.startsWith('application/json')))return json({error:'Origine ou format non autorisé'},403);
   const body=mutation?await request.text():url.searchParams.get('input')??'{}';
   if(body.length>16000)return json({error:'Requête trop grande'},413);
   let raw;try{raw=JSON.parse(body);}catch{return json({error:'JSON invalide'},400);}
   const batch=url.searchParams.get('batch')==='1';
   const results=await Promise.all(names.map(async(name,index)=>{try{const serialized=batch?raw[index]:raw;const input=serialized?.json==null?undefined:superjson.deserialize(serialized);const value=await procedure(name,input,request,env,ctx);return {result:{data:superjson.serialize(value)}};}catch(error){const status=error instanceof ApiError?error.status:503;return {error:{json:{message:error instanceof ApiError||name.startsWith('weather.')&&error instanceof Error?error.message:'Données momentanément indisponibles',code:status===401?-32001:status===400?-32600:-32603,data:{code:status===401?'UNAUTHORIZED':status===404?'NOT_FOUND':status===409?'CONFLICT':status===400?'BAD_REQUEST':'INTERNAL_SERVER_ERROR',httpStatus:status,path:name}}}};}}));
   return json(batch?results:results[0]);
  }
  if(path.startsWith('/api/'))return json({error:'Route inconnue'},404);
  if(!['GET','HEAD'].includes(request.method))return json({error:'Méthode non autorisée'},405);
  if(path.startsWith('/manus-storage/')){
   const name=decodeURIComponent(path.slice('/manus-storage/'.length));if(!ASSET_MANIFEST[name])return new Response('Introuvable',{status:404});
   const asset=await env.BUCKET.get('recovery/assets/'+name);if(!asset)return new Response('Image en cours de restauration',{status:503,headers:{'Cache-Control':'no-store'}});
   return new Response(request.method==='HEAD'?null:asset.body,{headers:{'Content-Type':ASSET_MANIFEST[name].type,'Cache-Control':'public,max-age=86400','X-Content-Type-Options':'nosniff'}});
  }
  const assetPath=path==='/favicon.ico'?'/assets/icons/icon-192.png':path;
  const key=EMBEDDED_ASSETS[assetPath==='/'?'/index.html':assetPath]?assetPath==='/'?'/index.html':assetPath:assetPath.includes('.')?null:'/index.html';
  const asset=key?EMBEDDED_ASSETS[key]:null;if(!asset)return new Response('Introuvable',{status:404});
  const bytes=Uint8Array.from(atob(asset.body),c=>c.charCodeAt(0));
  return new Response(request.method==='HEAD'?null:bytes,{headers:{'Content-Type':asset.type,'Cache-Control':key==='/sw.js'||key==='/index.html'?'no-cache':key!.startsWith('/assets/')?'public,max-age=31536000,immutable':'public,max-age=3600','X-Content-Type-Options':'nosniff'}});
  }catch(error){console.error('Contrôle restauration :',error instanceof Error?error.message:'échec');return json({error:'Service de contrôle momentanément indisponible'},503);}
  finally{if(hasUnflushedOpenMeteoTraffic())originalWaitUntil(flushOpenMeteoTraffic(env));}
}};

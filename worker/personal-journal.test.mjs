import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFile} from 'node:fs/promises';
import {build} from 'esbuild';
import worker from '../dist/server/index.js';
const built=await build({entryPoints:['worker/personal-journal.ts'],bundle:true,platform:'node',format:'esm',write:false});
const {personalJournal:call}=await import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].text).toString('base64'));
const coords={lat:50.7567,lon:2.5204},values={temperature:0,condition:'rain',windSpeed:null,precipitation:0},input={...coords,...values};
async function fixture(){
 const sqlite=new DatabaseSync(':memory:');
 const journal=JSON.parse(await readFile('drizzle/meta/_journal.json','utf8'));for(const entry of journal.entries)sqlite.exec(await readFile('drizzle/'+entry.tag+'.sql','utf8'));
 sqlite.exec("PRAGMA foreign_keys=ON; INSERT INTO site_users VALUES(1,'alice','date'),(2,'bob','date'); INSERT INTO recovery_weather_history(source_table,source_id,payload,digest) VALUES('ancienne_sauvegarde',1,'{}','empreinte');");
 const DB={prepare(sql){return {bind(...args){return {sql,args,first:async()=>sqlite.prepare(sql).get(...args)??null,all:async()=>({results:sqlite.prepare(sql).all(...args)}),run:async()=>sqlite.prepare(sql).run(...args)};}};}};
 return {DB,sqlite};
}
test('déclaration privée persistée : zéro, valeurs absentes et horodatage serveur conservés',async()=>{
 const {DB,sqlite}=await fixture();try{const result=await call('personalObservations.submit',input,1,DB,10000);
 assert.equal(result.calibration,'not_active');assert.equal(result.scoredModelCount,0);
 const rows=await call('personalObservations.history',coords,1,DB);assert.equal(rows.length,1);assert.equal(rows[0].temperature,0);assert.equal(rows[0].precipitation,0);assert.equal(rows[0].windSpeed,null);assert.equal(rows[0].observedAt,10000);assert.equal(rows[0].source,'personal_declaration');
 assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM recovery_weather_history').get().n,1);assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM weather_station_observations').get().n,0);assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM weather_captures').get().n,0);
 }finally{sqlite.close();}
});
test('comptes et lieux isolés ; une correction ne déplace pas l’observation dans le temps',async()=>{
 const {DB,sqlite}=await fixture();try{
 const {observationId:id}=await call('personalObservations.submit',input,1,DB,10000);
 assert.equal((await call('personalObservations.history',coords,2,DB)).length,0);assert.equal((await call('personalObservations.history',{lat:50.63,lon:3.06},1,DB)).length,0);
 for(const method of ['personalObservations.update','personalObservations.delete'])await assert.rejects(()=>call(method,method.endsWith('update')?{id,observation:values}:{id},2,DB),e=>e.status===404);
 await call('personalObservations.update',{id,observation:{...values,temperature:12.4,windSpeed:8}},1,DB,20000);
 const row=(await call('personalObservations.history',coords,1,DB))[0];assert.equal(row.temperature,12.4);assert.equal(row.windSpeed,8);assert.equal(row.observedAt,10000);assert.equal(row.updatedAt,20000);
 }finally{sqlite.close();}
});
test('valeurs impossibles, faux propriétaires et dates injectées sont refusés avant insertion',async()=>{
 const {DB,sqlite}=await fixture();try{
 for(const bad of [{...input,temperature:61},{...input,windSpeed:-1},{...input,precipitation:501},{...input,lat:91},{...input,condition:'inventé'},{...input,temperature:NaN},{...input,userId:2},{...input,observedAt:1}])await assert.rejects(()=>call('personalObservations.submit',bad,1,DB),e=>e.status===400);
 await assert.rejects(()=>call('personalObservations.submit',input,undefined,DB),e=>e.status===401);assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM site_personal_observations').get().n,0);
 }finally{sqlite.close();}
});
test('suppression limitée au propriétaire, sans suppression de la sauvegarde historique',async()=>{
 const {DB,sqlite}=await fixture();try{const {observationId:id}=await call('personalObservations.submit',input,1,DB);
 await assert.rejects(()=>call('personalObservations.unknown',{id},1,DB),e=>e.status===404);
 await call('personalObservations.delete',{id},1,DB);assert.equal((await call('personalObservations.history',coords,1,DB)).length,0);
 await assert.rejects(()=>call('personalObservations.delete',{id},1,DB),e=>e.status===404);assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM recovery_weather_history').get().n,1);
 }finally{sqlite.close();}
});
test('lecture bornée aux 200 dernières déclarations, sans effacer les plus anciennes',async()=>{
 const {DB,sqlite}=await fixture();try{for(let i=1;i<=205;i++)await call('personalObservations.submit',input,1,DB,i);
 const rows=await call('personalObservations.history',coords,1,DB);assert.equal(rows.length,200);assert.equal(rows[0].observedAt,6);assert.equal(rows.at(-1).observedAt,205);assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM site_personal_observations').get().n,205);
 }finally{sqlite.close();}
});
test('transport : identité réelle requise, origine et méthode contrôlées ; lecture après écriture',async()=>{
 const {DB,sqlite}=await fixture();try{
 const origin='https://meteo.example',env={DB},ctx={};
 const post=(method,data,headers={})=>worker.fetch(new Request(origin+'/api/trpc/'+method,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json',...headers},body:JSON.stringify({json:data})}),env,ctx);
 let r=await post('personalObservations.submit',input);assert.equal((await r.json()).error.json.data.httpStatus,401);
 r=await post('personalObservations.submit',input,{Origin:'https://autre.example'});assert.equal(r.status,403);
 r=await worker.fetch(new Request(origin+'/api/trpc/personalObservations.delete?input='+encodeURIComponent(JSON.stringify({json:{id:1}}))),env,ctx);assert.equal(r.status,405);
 const before=Date.now();r=await post('personalObservations.submit',{...input,radiusKm:20,localMode:'standard'},{'oai-authenticated-user-id':'alice'});assert.equal((await r.json()).result.data.json.calibration,'not_active');
 r=await worker.fetch(new Request(origin+'/api/trpc/personalObservations.history?input='+encodeURIComponent(JSON.stringify({json:coords})),{headers:{'oai-authenticated-user-id':'alice'}}),env,ctx);assert.equal(r.headers.get('Cache-Control'),'no-store');const rows=(await r.json()).result.data.json;assert.equal(rows.length,1);assert(rows[0].observedAt>=before);
 }finally{sqlite.close();}
});

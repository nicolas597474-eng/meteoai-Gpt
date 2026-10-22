import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFile} from 'node:fs/promises';
import {build} from 'esbuild';
import worker from '../dist/server/index.js';
const built=await build({entryPoints:['worker/favorites.ts'],bundle:true,platform:'node',format:'esm',write:false});
const {favoriteProcedure:call}=await import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].text).toString('base64'));
async function fixture(){
 const sqlite=new DatabaseSync(':memory:');sqlite.exec('PRAGMA foreign_keys=ON; CREATE TABLE site_users(id INTEGER PRIMARY KEY,subject TEXT,created_at TEXT); INSERT INTO site_users VALUES(1,\'alice\',\'date\'),(2,\'bob\',\'date\');');
 sqlite.exec(await readFile('drizzle/0003_glamorous_silvermane.sql','utf8'));sqlite.exec(await readFile('drizzle/0010_black_roughhouse.sql','utf8'));
 const DB={prepare(sql){return {bind(...args){return {sql,args,first:async()=>sqlite.prepare(sql).get(...args)??null,all:async()=>({results:sqlite.prepare(sql).all(...args)}),run:async()=>sqlite.prepare(sql).run(...args)};}};},async batch(statements){sqlite.exec('BEGIN');try{const result=statements.map(s=>sqlite.prepare(s.sql).run(...s.args));sqlite.exec('COMMIT');return result;}catch(e){sqlite.exec('ROLLBACK');throw e;}}};
 return {DB,sqlite};
}
const city=(n=0)=>({name:'Ville '+n,lat:50+n/100,lon:2});
test('sauvegarde, renommage et isolation stricte des comptes',async()=>{const {DB,sqlite}=await fixture();try{
 const {id}=await call('favorites.add',city(),1,DB);
 assert.equal((await call('favorites.list',undefined,1,DB))[0].isDefault,1);
 assert.equal((await call('favorites.list',undefined,2,DB)).length,0);
 for(const method of ['favorites.delete','favorites.update','favorites.setDefault'])await assert.rejects(()=>call(method,method==='favorites.update'?{id,customName:'Intrusion'}:{id},2,DB),e=>e.status===404);
 await call('favorites.update',{id,customName:'Ma ville'},1,DB);
 assert.equal((await call('favorites.list',undefined,1,DB))[0].customName,'Ma ville');
 await assert.rejects(()=>call('favorites.list',undefined,undefined,DB),e=>e.status===401);
 }finally{sqlite.close();}});
test('limite atomique de cinq lieux, même avec ajouts concurrents ; doublons refusés',async()=>{const {DB,sqlite}=await fixture();try{
 const results=await Promise.allSettled(Array.from({length:8},(_,i)=>call('favorites.add',city(i),1,DB)));
 assert.equal(results.filter(r=>r.status==='fulfilled').length,5);assert.equal((await call('favorites.list',undefined,1,DB)).length,5);
 await assert.rejects(()=>call('favorites.add',city(),1,DB),e=>e.status===409);
 assert.equal((await call('favorites.add',city(),2,DB)).id>0,true);
 }finally{sqlite.close();}});
test('ordre, favori par défaut et suppression conservent un défaut unique',async()=>{const {DB,sqlite}=await fixture();try{
 const a=await call('favorites.add',city(),1,DB),b=await call('favorites.add',city(1),1,DB);
 await call('favorites.setDefault',b,1,DB);
 await call('favorites.update',{...a,position:1},1,DB);await call('favorites.update',{...b,position:0},1,DB);
 let rows=await call('favorites.list',undefined,1,DB);assert.deepEqual(rows.map(r=>r.id),[b.id,a.id]);assert.deepEqual(rows.map(r=>r.isDefault),[1,0]);
 await call('favorites.delete',b,1,DB);rows=await call('favorites.list',undefined,1,DB);assert.equal(rows.length,1);assert.equal(rows[0].isDefault,1);
 await call('favorites.delete',a,1,DB);assert.equal((await call('favorites.list',undefined,1,DB)).length,0);
 }finally{sqlite.close();}});
test('coordonnées, noms et réglages non migrés sont refusés sans écriture',async()=>{const {DB,sqlite}=await fixture();try{
 for(const input of [{...city(),lat:91},{...city(),lon:Infinity},{...city(),name:' '},{...city(),localMode:'invalid'},{...city(),userId:2}])await assert.rejects(()=>call('favorites.add',input,1,DB),e=>e.status===400);
 assert.equal((await call('favorites.list',undefined,1,DB)).length,0);
 }finally{sqlite.close();}});
test('transport tRPC : authentification, origine, méthode et lecture après écriture',async()=>{const {DB,sqlite}=await fixture();try{
 const base='https://meteo.example',env={DB},ctx={};
 const post=(headers={},body={json:city()})=>worker.fetch(new Request(base+'/api/trpc/favorites.add',{method:'POST',headers:{Origin:base,'Content-Type':'application/json',...headers},body:JSON.stringify(body)}),env,ctx);
 let r=await post();assert.equal((await r.json()).error.json.data.httpStatus,401);
 r=await post({Origin:'https://autre.example'});assert.equal(r.status,403);
 r=await worker.fetch(new Request(base+'/api/trpc/favorites.add'),env,ctx);assert.equal(r.status,405);
 r=await post({'oai-authenticated-user-id':'alice'});assert.equal((await r.json()).result.data.json.id,1);
 r=await worker.fetch(new Request(base+'/api/trpc/favorites.list',{headers:{'oai-authenticated-user-id':'alice'}}),env,ctx);assert.equal((await r.json()).result.data.json[0].name,'Ville 0');
 }finally{sqlite.close();}});

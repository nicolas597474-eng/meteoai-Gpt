import {DatabaseSync} from 'node:sqlite';
import {readFile} from 'node:fs/promises';
import {build} from 'esbuild';
const output=await build({stdin:{contents:"export {recordCapture} from './worker/archive'; export {recordObservations} from './worker/station-observations';",resolveDir:process.cwd()},bundle:true,platform:'node',format:'esm',write:false});
export const {recordCapture,recordObservations}=await import('data:text/javascript;base64,'+Buffer.from(output.outputFiles[0].text).toString('base64'));
export async function archiveTestContext(){
 const db=new DatabaseSync(':memory:');
 for(const name of ['0001_youthful_robin_chapel','0002_cute_celestials'])db.exec(await readFile('drizzle/'+name+'.sql','utf8'));
 const objects=new Map();
 const DB={prepare(sql){const statement=db.prepare(sql);let args=[];return {bind(...values){args=values;return this;},async first(){return statement.get(...args)??null;},async all(){return {results:statement.all(...args)};},async run(){return statement.run(...args);}};},async batch(statements){return Promise.all(statements.map(statement=>statement.run()));}};
 const BUCKET={async put(key,value){objects.set(key,value);},async get(key){const value=objects.get(key);return value?{size:Buffer.byteLength(value),arrayBuffer:async()=>new TextEncoder().encode(value).buffer}:null;}};
 return {env:{DB,BUCKET},db,objects};
}

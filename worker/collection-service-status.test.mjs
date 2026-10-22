import {test} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
const built=await build({stdin:{contents:"export * from './worker/collection-service-status';",resolveDir:process.cwd()},bundle:true,platform:'node',format:'esm',write:false});
const {readCollectionServiceStatus}=await import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].text).toString('base64'));
const now=Date.parse('2026-10-20T16:15:00Z');
const env=(row)=>({METEOAI_BACKGROUND_ENABLED:'true',DB:{prepare(){return {bind(){return {first:async()=>row};}};}}});
test('statut du service : les reçus partiels, anciens ou illisibles ne deviennent jamais une collecte complète',async()=>{
 const row={attempted_at:'2026-10-20T16:07:00Z',status:'partial',message:JSON.stringify({version:1,slot:'2026-10-20T16',status:'partial',observations:0,models:7,dailyModels:5})};
 const result=await readCollectionServiceStatus(env(row),now);assert.equal(result.status,'partial');assert.match(result.description,/0 relevés, 7\/7 modèles horaires et 5\/7/);
 assert.equal((await readCollectionServiceStatus(env(row),now+2*3600000)).status,'stale');
 assert.equal((await readCollectionServiceStatus(env({...row,message:'sensitive unknown error'}),now)).status,'unverified');
 assert(!JSON.stringify(await readCollectionServiceStatus(env({...row,message:'sensitive unknown error'}),now)).includes('sensitive'));
 assert.equal((await readCollectionServiceStatus({METEOAI_BACKGROUND_ENABLED:'false'},now)).status,'disabled');
});
test('un ancien reçu complet avec deux modèles quotidiens est reclassé partiel sans altérer les effectifs',async()=>{
 const at='2026-10-20T16:07:00Z',receipt={version:1,slot:'2026-10-20T16',status:'complete',observations:70,models:7,dailyModels:2,verified:true};
 const result=await readCollectionServiceStatus(env({attempted_at:at,status:'ok',message:JSON.stringify(receipt)}),now);
 assert.equal(result.status,'partial');assert.equal(result.receiptStatus,'partial');assert.equal(result.counts.dailyModels,2);
 const full=await readCollectionServiceStatus(env({attempted_at:at,status:'ok',message:JSON.stringify({...receipt,dailyModels:7})}),now);
 assert.equal(full.status,'complete');assert.equal(full.receiptStatus,'complete');
 const noProof=await readCollectionServiceStatus(env({attempted_at:at,status:'ok',message:JSON.stringify({...receipt,dailyModels:7,verified:false})}),now);assert.equal(noProof.status,'partial');
});

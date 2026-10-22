import {test} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
const built=await build({entryPoints:['worker/provider-collection-journal.ts'],bundle:true,platform:'node',format:'esm',write:false});
const {readProviderCollectionJournal}=await import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].text).toString('base64'));
const now=Date.parse('2026-10-21T08:00Z'),at='2026-10-21T07:30:00Z';
const env=summary=>({DB:{prepare(sql){assert.match(sql,/^SELECT/);return {bind(channel){assert.equal(channel,'learning_provider_runs_v3');return {first:async()=>({attempted_at:at,status:'ok',message:JSON.stringify(summary)})};}};}}});
test('les journaux existants deviennent lisibles sans inventer de date d’émission ni d’effectif',async()=>{
 const result=await readProviderCollectionJournal(env({version:1,attempts:[{model:'AROME',status:'already_archived',httpStatus:null,reasonCode:null}]}),now);
 assert.equal(result.available,true);assert.equal(result.results.length,1);
 const row=result.results[0];assert.equal(row.model,'AROME');assert.equal(row.status,'already_archived');assert.equal(row.providerRunAt,null);assert.equal(row.availableAt,null);assert.equal(row.valuesStored,null);assert.equal(row.leadBasis,'unknown');assert.equal(row.capturedAt,at);assert.equal(row.journalTimingScope,'batch_start');
});
test('les nouveaux journaux restituent les dates et effectifs réellement enregistrés, sans URL ou payload',async()=>{
 const run=now-6*3600000,received=now-1800000;
 const result=await readProviderCollectionJournal(env({version:2,attempts:[{model:'AROME',status:'succeeded',httpStatus:200,metadataHttpStatus:200,providerRunAt:run,availableAt:received,requestStartedAt:received-1000,metadataAvailableAt:run+300000,valuesStored:288,minimumForecastLeadMilliseconds:7200000,maximumForecastLeadMilliseconds:172800000,requestUrl:'private fixture',responsePayload:{private:true}}]}),now);
 assert.equal(result.available,true);const row=result.results[0];assert.equal(row.providerRunAt,run);assert.equal(row.availableAt,received);assert.equal(row.valuesStored,288);assert.equal(row.leadBasis,'provider_run');assert(!JSON.stringify(result).includes('private'));
});
test('un journal corrompu, un doublon ou un modèle étranger reste indisponible, sans appel réseau',async()=>{
 for(const attempts of [[{model:'INCONNU',status:'succeeded'}],[{model:'AROME',status:'intrus'}],[{model:'AROME',status:'succeeded'},{model:'AROME',status:'succeeded'}],[]])assert.equal((await readProviderCollectionJournal(env({version:1,attempts}),now)).available,false);
 assert.equal((await readProviderCollectionJournal({DB:{prepare(){throw Error('indisponible');}}},now)).available,false);
});

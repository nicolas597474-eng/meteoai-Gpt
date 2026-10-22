import {test} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
const built=await build({entryPoints:['worker/station-observations.ts'],bundle:true,platform:'node',format:'esm',write:false});
const {prepareObservations}=await import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].text).toString('base64'));
test('archive jusqu’à 50 km, sans modifier la qualification ni accepter 51 km',async()=>{
 const now=Date.now(),input={lat:50.7567,lon:2.5204,stations:[{id:'netatmo-local-50',temp:12,time:now,distance:45,elevation:null,anomaly:false}]};
 const result=await prepareObservations(input,now);assert.equal(result.rows.length,1);assert.equal(result.rows[0].distance,45);assert.equal(result.rows[0].calibrationEligible,false);
 await assert.rejects(()=>prepareObservations({...input,stations:[{...input.stations[0],distance:51}]},now));
});

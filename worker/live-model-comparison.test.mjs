import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {build} from 'esbuild';
const output=join(mkdtempSync(join(tmpdir(),'meteo-live-')),'comparison.mjs');
await build({entryPoints:['shared/liveModelComparison.ts'],outfile:output,bundle:true,format:'esm',platform:'browser'});
const {projectLiveComparison,summarizeLiveComparison,describeLiveModel,selectLiveComparisonSlot}=await import(pathToFileURL(output).href);
const at=Date.parse('2026-10-17T12:00:00Z');
function fixture(){return projectLiveComparison({forecasts:[{modelName:'AROME',availableAt:at-1000,hours:[{validAt:at,temperature:12,precipitation:0},{validAt:at+3600000,temperature:18}]},{modelName:'ICON',hours:[{validAt:at,temperature:14}]},{modelName:'best_match',hours:[{validAt:at,temperature:40}]}],diagnostics:[{modelName:'AROME',status:'partial',errorCode:'partial_variables'}],controlCache:{stale:true}},[{validAt:at,temp:12.7}],at);}
test('sept modèles attendus et Best Match isolé, écart calculé uniquement sur les contributeurs présents',()=>{const d=fixture(),s=summarizeLiveComparison(d,at,'temperature');assert.equal(d.models.length,8);assert.equal(s.contributors,2);assert.equal(s.spread,2);assert.equal(s.consensus,12.7);assert.equal(s.members.find(m=>m.name==='best_match').reference,true);});
test('aucune substitution entre heures, modèles ou variables ; zéro pluie reste une valeur valide',()=>{const d=fixture();assert.equal(summarizeLiveComparison(d,at,'precipitation').members[0].value,0);const s=summarizeLiveComparison(d,at+3600000,'temperature');assert.equal(s.contributors,1);assert.equal(s.spread,null);assert.equal(s.members.find(m=>m.name==='ICON').value,null);assert.equal(s.members.find(m=>m.name==='GFS').value,null);assert.equal(s.consensus,null);});
test('disponibilité partielle, fraîcheur et réception ne sont pas confondues avec une qualité historique',()=>{const d=fixture();assert.equal(d.stale,true);assert.equal(d.models[0].status,'partial');assert.equal(d.models[0].collectedAt,at-1000);assert.equal(d.calibration,'robust_fallback');assert.equal(d.models.find(m=>m.name==='GFS').status,'failed');});
test('diagnostic précis : zéro reçu, variable absente, heure absente et panne fournisseur sont distincts',()=>{
 const data=fixture(),arome=data.models[0],icon=data.models.find(m=>m.name==='ICON'),missing=data.models.find(m=>m.name==='GFS');
 assert.match(describeLiveModel(arome,at,'precipitation'),/Valeur reçue/);
 assert.equal(describeLiveModel(icon,at,'precipitation'),'Variable non fournie à cette échéance');
 assert.equal(describeLiveModel(icon,at+3600000,'temperature'),'Aucune valeur reçue pour cette heure');
 assert.match(describeLiveModel({...missing,errorCode:'timeout'},at,'temperature'),/délai/);
 assert.equal(describeLiveModel({...missing,errorCode:'provider_http_4xx'},at,'temperature'),'Requête refusée par le fournisseur');
 assert.equal(describeLiveModel({...missing,errorCode:'invalid_response'},at,'temperature'),'Réponse fournisseur inexploitable');
 assert.equal(summarizeLiveComparison(data,at,'precipitation').spread,null);
});
test('l’heure choisie est conservée au rafraîchissement ; une heure disparue est remplacée par une échéance reçue',()=>{
 const slots=[at,at+3600000,at+7200000];assert.equal(selectLiveComparisonSlot(slots,at,at+1800000),at);
 assert.equal(selectLiveComparisonSlot(slots,0,at+1800000),at+3600000);
 assert.equal(selectLiveComparisonSlot([at],0,at+3600000),at);assert.equal(selectLiveComparisonSlot([],at),0);
});

import {test} from 'node:test';
import assert from 'node:assert/strict';
import worker from '../dist/server/index.js';

const now=Date.now(),at=new Date(now).toISOString();
const date=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Paris',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);
const daily={days:[{date,tempMax:13,tempMin:5,precipitation:1,windSpeed:14,officialFusion:{referenceAt:at,issuedAt:at,sourcesByVariable:{},availabilityStatus:{},calibrationStatus:{}}}],modelsUsed:[],dailyStatus:'ready',aiLabDetails:{}};
const hourly={hours:[{date,hour:'12:00',validAt:now,temp:10}],currentSnapshot:{temp:6,sourceKind:'model_current_snapshot',source:'open-meteo',capturedAt:at},officialSnapshot:{computedAt:at,hourlyComputedAt:at,hourlyWeighting:{modelsConsidered:[],bestMatchIncluded:false}},regime:null};
const reads=[];
const env={DB:{prepare(){throw Error('SQL inattendu');}},BUCKET:{async get(key){reads.push(key);assert.ok(key.endsWith('/unavailable'),'Sans preuves signées, seul le cache sans apprentissage est admissible');const value=key.includes('daily-full-v4/')?daily:key.includes('hourly-v5/')?hourly:null;if(!value)throw Error('Collecte fournisseur inattendue : '+key);return {json:async()=>({at:now,value})};},async put(){throw Error('Écriture inattendue');}}};
const ctx={waitUntil(){throw Error('Tâche inattendue');}};
async function read(path){const url=new URL('https://controle.example/api/trpc/'+path);url.searchParams.set('input',JSON.stringify({json:{lat:50.7567,lon:2.5204}}));const response=await worker.fetch(new Request(url),env,ctx);const data=await response.json();assert.ok(data.result,JSON.stringify(data.error));return data.result.data.json;}
test('AI Lab réutilise les caches existants et distingue snapshot, horaire et quotidien',async()=>{
 const data=await read('weather.getAILab');
 assert.equal(data.forecastComparison.currentSnapshot.temp,6);
 assert.equal(data.forecastComparison.hourlyForecast.points[0].temp,10);
 assert.equal(data.officialForecast.tempMax,13);
 assert.deepEqual(data.forecastComparison.coordinates,{lat:50.7567,lon:2.5204});
 assert.equal(data.modelsUsed,0);assert.equal(data.trace,null);
 assert.equal(reads.length,2);
});
test('la projection quotidienne du Dashboard n’envoie pas les traces et entrées complètes AI Lab',async()=>{
 const data=await read('weather.getDashboardDailyForecast');
 assert.equal(data.days[0].tempMax,13);
 assert.ok(!('aiLabDetails' in data));
});

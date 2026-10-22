import type {EnvironmentalSnapshot} from '../../../server/environmentalData';
import {publicEnvironmentalCache} from './publicEnvironmentalCache';
let instance:Worker|null=null,nextId=0;
const pending=new Map<number,{resolve:(value:any)=>void;reject:(reason:Error)=>void;timer:ReturnType<typeof setTimeout>}>();
function worker(){
 if(instance)return instance;
 const created=new Worker(new URL('./environmentWorker.ts',import.meta.url),{type:'module'});
 created.onmessage=(event:MessageEvent<{id:number;data?:any;error?:string}>)=>{const task=pending.get(event.data.id);if(!task)return;clearTimeout(task.timer);pending.delete(event.data.id);if(event.data.error||!event.data.data)task.reject(new Error(event.data.error??'Réponse environnementale invalide.'));else task.resolve(event.data.data);};
 created.onerror=()=>{pending.forEach(task=>{clearTimeout(task.timer);task.reject(new Error('Le calcul environnemental en arrière-plan est indisponible.'));});pending.clear();created.terminate();instance=null;};
 instance=created;return created;
}
export async function collectEnvironmentalData(coords:{lat:number;lon:number},method='snapshot',eventId?:string):Promise<any>{
 if(typeof Worker==='undefined'){const mod=await import('../../../server/environmentalData');if(method==='position')return mod.getApparentAstronomyPosition(coords);if(method==='terrain')return mod.getTerrainHorizonProfile(coords);if(method==='eclipse'){const eclipse=await import('../../../server/eclipseVisibility');return eclipse.getLocalEclipseCircumstances({...coords,eventId:eventId??''});}return mod.getEnvironmentalSnapshot(coords,{online:navigator.onLine,jsonCache:publicEnvironmentalCache});}
 const target=worker(),id=++nextId;
 return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{pending.delete(id);reject(new Error('Le chargement environnemental a dépassé le délai.'));},30000);pending.set(id,{resolve,reject,timer});target.postMessage({id,coords,method,eventId,online:navigator.onLine});});
}

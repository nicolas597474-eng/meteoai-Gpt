import type {LearningHistory} from '@shared/qualifiedLearning';
const cache=new Map<string,{at:number;value:LearningHistory}>(),flights=new Map<string,Promise<LearningHistory|null>>();
let generation=0;
export function learningHistoryGeneration(){return generation;}
export function invalidateLearningHistory(){generation++;cache.clear();flights.clear();}
/** Les poids sont calculés avec les seuls scores signés et qualifiés relus par le serveur. */
export async function getLearningHistory(coords:{lat:number;lon:number}):Promise<LearningHistory|null>{
 if(coords.lat!==50.7567||coords.lon!==2.5204)return null;
 const key=coords.lat+'/'+coords.lon,old=cache.get(key);if(old&&Date.now()-old.at<60000)return old.value;
 if(flights.has(key))return flights.get(key)!;
 const startedGeneration=generation;
 const flight=(async()=>{
  const response=await fetch('/api/history/learning-evidence?'+new URLSearchParams({lat:String(coords.lat),lon:String(coords.lon)}),{credentials:'same-origin',cache:'no-store',redirect:'error',signal:AbortSignal.timeout(8000)});
  if(!response.ok)throw Error('Preuves d’apprentissage indisponibles');
  const value=await response.json();if(value.version!==1||value.scope!=='hondeghem'||value.available!==true||!Array.isArray(value.units)||!Array.isArray(value.hourlyScores)||!Array.isArray(value.exactHourlyScores)||!Array.isArray(value.providerModels)||typeof value.revision!=='string')throw Error('Historique d’apprentissage invalide');
  // Une réponse commencée avant Actualiser ne peut pas remplacer les nouvelles preuves.
  if(generation===startedGeneration)cache.set(key,{at:Date.now(),value});return value as LearningHistory;
 })().finally(()=>{if(flights.get(key)===flight)flights.delete(key);});flights.set(key,flight);return flight;
}

let flight:Promise<void>|undefined;

/** Reprend les preuves et vérifie la collecte serveur d'apprentissage (cache partagé de dix minutes). */
export function finalizeStoredPhysicalReferences():Promise<void>{
 if(flight)return flight;
 flight=(async()=>{
  const response=await fetch('/api/control/finalize-physical-references',{
   method:'POST',credentials:'same-origin',cache:'no-store',redirect:'error',
   headers:{'Content-Type':'application/json'},body:'{}',signal:AbortSignal.timeout(55000),
  });
  if(!response.ok)throw Error('Reprise des références indisponible ; archives conservées.');
  invalidateLearningHistory();
 })().finally(()=>{flight=undefined;});
 return flight;
}
import {invalidateLearningHistory} from './learningHistory';

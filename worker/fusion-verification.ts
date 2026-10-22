import {readFusionSnapshots} from './fusion-snapshots';

/** Les traces actuellement archivées sont des reçus navigateur, explicitement
 * non admissibles pour la calibration. Leur présence ne prouve pas une prévision
 * quotidienne reçue avant les mesures. On les vérifie, sans les promouvoir en score. */
const cache=new WeakMap<object,{date:string;until:number;value:Promise<any>}>();
export async function readFusionVerificationStatus(date:string,env:any,now=Date.now()){
 const existing=cache.get(env.DB);if(existing&&existing.date===date&&existing.until>now)return existing.value;
 let rejected=0;
 const value=(async()=>{
  try{
   // Le lecteur vérifie le fichier, son empreinte et sa provenance. Le résultat
   // est la dernière trace de la date, pas un inventaire de toutes les captures.
   const traces=await readFusionSnapshots(env,now,{start:date,end:date},()=>{rejected++;});
   if(rejected)return {status:'unavailable',reasonCode:'trace_integrity_error',reason:'Une trace de fusion a été rejetée lors de sa vérification. Aucune comparaison de la fusion n’est publiée.',pairCount:null,groups:[],diagnostic:{traceFound:traces.length>0,filesRejected:rejected}};
   if(traces.length)return {status:'unavailable',reasonCode:'diagnostic_trace_only',reason:'Une trace de fusion vérifiée est présente pour cette date. Elle provient du navigateur et reste un diagnostic non qualifié ; elle ne prouve pas une prévision quotidienne reçue avant les mesures. Aucun score MeteoAI n’en est déduit.',pairCount:null,groups:[],diagnostic:{traceFound:true,filesRejected:0}};
   return {status:'unavailable',reasonCode:'no_verified_trace',reason:'Aucune trace de fusion vérifiable n’a été trouvée pour cette date. Les comparaisons des modèles fournisseurs restent distinctes.',pairCount:null,groups:[],diagnostic:{traceFound:false,filesRejected:0}};
  }catch{return {status:'unavailable',reasonCode:'history_unavailable',reason:'L’historique des traces de fusion ne peut pas être vérifié actuellement. Aucune absence d’archive ni aucun score MeteoAI n’est déduit de cet échec.',pairCount:null,groups:[],diagnostic:{traceFound:false,filesRejected:0}};}
 })();
 const protectedValue=value.then(result=>{if(result.reasonCode==='history_unavailable'||result.reasonCode==='trace_integrity_error'){if(cache.get(env.DB)?.value===protectedValue)cache.delete(env.DB);}return result;});
 cache.set(env.DB,{date,until:now+5*60000,value:protectedValue});return protectedValue;
}

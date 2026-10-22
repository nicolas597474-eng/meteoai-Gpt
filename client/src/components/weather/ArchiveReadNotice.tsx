import {MeteoSurface} from './MeteoSurface';

/** Compatible avec les anciennes réponses sans diagnostic de lecture. */
export function ArchiveReadNotice({data,onRetry}:{data:unknown;onRetry?:()=>void}){
 const status=(data as {archiveRead?:{partial?:boolean;rejectedFiles?:number;boundedRead?:boolean;unavailableSources?:unknown[]}}|null)?.archiveRead;
 if(status?.partial!==true)return null;
 const count=status.rejectedFiles,rejected=typeof count==='number'&&Number.isSafeInteger(count)&&count>0?count:0;
 return <MeteoSurface role="status" className="rounded-xl border border-amber-300/25 p-3 text-xs leading-relaxed text-amber-100">
  <p>Lecture partielle des archives. Seules les données vérifiées sont affichées ; les éléments illisibles restent exclus des graphiques et des comparaisons.</p>
  {rejected>0&&<p className="mt-1">{rejected} archive(s) non vérifiable(s).</p>}
  {Array.isArray(status.unavailableSources)&&status.unavailableSources.length>0&&<p className="mt-1">Certaines sources d’archives sont temporairement indisponibles.</p>}
  {status.boundedRead===true&&<p className="mt-1">La limite de lecture a été atteinte ; cette vue ne couvre pas toutes les archives demandées.</p>}
  {onRetry&&<button type="button" onClick={onRetry} className="mt-2 min-h-9 rounded-lg border border-amber-300/30 px-3 font-semibold">Réessayer la lecture</button>}
 </MeteoSurface>;
}

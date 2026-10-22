import {useEffect,useState} from 'react';
import {Activity,ChevronDown,RefreshCw,X} from 'lucide-react';
type Report={available:boolean;configured:boolean;connected:boolean;checkedAt:number;totals:{requests:number;success:number;rateLimited:number;providerErrors:number;networkErrors:number;timeouts:number;forbidden:number}|null;last:{at:number;endpoint:string;status:number|null;code:string;retryAt:number|null}|null};
const at=(n:number)=>new Date(n).toLocaleString('fr-FR',{timeZone:'Europe/Paris',dateStyle:'short',timeStyle:'short'});
const reasons:Record<string,string>={ok:'Réponse reçue',NETATMO_RATE_LIMIT:'Refus de quota Netatmo confirmé',NETATMO_SCOPE:'Accès refusé par Netatmo',NETATMO_PROVIDER_ERROR:'Erreur du serveur Netatmo',NETATMO_TIMEOUT:'Délai de réponse dépassé',NETATMO_NETWORK_ERROR:'Erreur de connexion',NETATMO_HTTP_ERROR:'Réponse HTTP en erreur'};
export function NetatmoDiagnosticView({report,error,loading,onRefresh}:{report:Report|null;error:boolean;loading:boolean;onRefresh:()=>void}){
 const [open,setOpen]=useState(false),last=report?.last;
 return <section className="order-[-1] rounded-2xl border border-sky-400/25 bg-sky-400/[0.055] p-4" aria-labelledby="netatmo-diagnostic-title">
  <div className="flex items-start gap-2"><Activity className="h-5 w-5 shrink-0 text-sky-300"/><div className="flex-1"><h2 id="netatmo-diagnostic-title" className="text-sm font-semibold text-slate-100">Netatmo · diagnostic des appels</h2><p className="mt-1 text-[11px] text-slate-400">Stations et renouvellements d’accès côté serveur, sur 24 créneaux horaires.</p></div><button type="button" className="weather-icon-bare grid h-9 w-9 shrink-0 place-items-center text-sky-300" aria-label={open?'Fermer le diagnostic Netatmo':'Dérouler le diagnostic Netatmo'} aria-expanded={open} onClick={()=>setOpen(!open)}>{open?<X className="h-4 w-4"/>:<ChevronDown className="h-4 w-4"/>}</button></div>
  <p className="mt-3 text-xs text-sky-100" role="status">{error||report?.available===false?'Lecture du suivi Netatmo indisponible':!report?loading?'Lecture…':'Suivi indisponible':!report.connected?'Netatmo non connecté':last?reasons[last.code]??'État non documenté':'Suivi en démarrage · aucun appel observé'}</p>
  <p className="mt-2 text-[10px] text-slate-400">Quota restant : non communiqué. Les requêtes observées ne représentent pas le compteur officiel Netatmo.</p>
  {open&&<div className="mt-3 space-y-2 border-t border-sky-300/15 pt-3"><button type="button" disabled={loading} onClick={onRefresh} className="inline-flex min-h-9 items-center gap-2 text-xs text-sky-200"><RefreshCw className="h-4 w-4"/>Actualiser le suivi Netatmo</button>
   <p className="text-[10px] text-slate-400">Lecture seule : aucun appel aux stations n’est lancé par ce bouton. {report?`Dernière lecture : ${at(report.checkedAt)} (Paris).`:''} {error&&report?'Dernier diagnostic conservé ; actualisation échouée.':''}</p>
   <p className="text-xs text-slate-300">{report?.available&&report.totals?`${report.totals.requests} requête(s) · ${report.totals.success} réussie(s) · ${report.totals.rateLimited} refus de quota 429 · ${report.totals.providerErrors} erreur(s) serveur · ${report.totals.networkErrors} erreur(s) réseau, dont ${report.totals.timeouts} délai(s) dépassé(s) · ${report.totals.forbidden} refus d’accès 403.`:'Compteurs non accessibles ; aucune valeur supposée.'}</p>
   {last&&<p className="text-[11px] text-slate-300">Dernier appel observé : {at(last.at)} (Paris) · {last.endpoint==='oauth'?'renouvellement d’accès':'stations'} · {last.status===null?'sans réponse HTTP':`HTTP ${last.status}`}.</p>}
   {last?.retryAt&&last.retryAt>Date.now()&&<p className="text-[11px] text-amber-200">Nouveaux appels suspendus jusqu’au {at(last.retryAt)} (Paris). Ce délai n’est pas une garantie de rétablissement ou de recharge du quota.</p>}
   <p className="text-[10px] text-slate-400">Comptage depuis cette mise à jour, propre à votre connexion. Les autres applications et les appels antérieurs ne sont pas connus. Les anciennes mesures ne sont jamais redatées.</p>
  </div>}
 </section>;
}
export function NetatmoDiagnosticPanel(){
 const [report,setReport]=useState<Report|null>(null),[error,setError]=useState(false),[loading,setLoading]=useState(false);
 useEffect(()=>{const controller=new AbortController();void read(AbortSignal.any([controller.signal,AbortSignal.timeout(8000)]));return()=>controller.abort();},[]);
 async function read(signal?:AbortSignal){setLoading(true);try{const r=await fetch('/api/netatmo/diagnostic',{credentials:'same-origin',cache:'no-store',signal:signal??AbortSignal.timeout(8000)});if(!r.ok)throw Error();const v=await r.json();if(v.version!==1||typeof v.available!=='boolean')throw Error();if(!signal?.aborted){setReport(v);setError(false);}}catch{if(!signal?.aborted)setError(true);}finally{if(!signal?.aborted)setLoading(false);}}
 return <NetatmoDiagnosticView report={report} error={error} loading={loading} onRefresh={()=>void read()}/>;
}

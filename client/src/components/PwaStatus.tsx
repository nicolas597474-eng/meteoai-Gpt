import {useEffect,useState} from 'react';
import {useLocation} from '@/contexts/LocationContext';
import {offlineForecastStatus} from '@/lib/forecastOffline';
import {MeteoSurface} from '@/components/weather/MeteoSurface';
import {WifiOff,RefreshCw} from 'lucide-react';

/** Informations de fraîcheur indépendantes du dessin des cartes météo. */
export function PwaStatus(){
 const {activeLocation}=useLocation();
 const [online,setOnline]=useState(navigator.onLine);
 const [,redraw]=useState(0);
 const [update,setUpdate]=useState<ServiceWorkerRegistration|null>(null);
 useEffect(()=>{
  const connectivity=()=>setOnline(navigator.onLine),changed=()=>redraw(n=>n+1);
  const available=(event:Event)=>setUpdate((event as CustomEvent<ServiceWorkerRegistration>).detail);
  window.addEventListener('online',connectivity);window.addEventListener('offline',connectivity);
  window.addEventListener('meteoai-offline-status',changed);window.addEventListener('meteoai-update-ready',available);
  void navigator.serviceWorker?.getRegistration().then(registration=>{if(registration?.waiting)setUpdate(registration);});
  return()=>{window.removeEventListener('online',connectivity);window.removeEventListener('offline',connectivity);window.removeEventListener('meteoai-offline-status',changed);window.removeEventListener('meteoai-update-ready',available);};
 },[]);
 const recent=Array.from(offlineForecastStatus.values()).filter(s=>s.lat===(activeLocation?.lat??50.7567)&&s.lon===(activeLocation?.lon??2.5204)).sort((a,b)=>b.savedAt-a.savedAt)[0];
 const stale=recent&&['refreshing','unavailable'].includes(recent.reason);
 if(online&&!stale&&!update)return null;
 const date=recent?new Date(recent.savedAt).toLocaleString('fr-FR',{timeZone:'Europe/Paris',day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'}):null;
 return <div className="mx-auto w-full max-w-2xl px-1 pt-2 sm:px-3"><MeteoSurface as="aside" role="status" aria-live="polite" className="rounded-xl px-3 py-2 text-xs leading-relaxed">
  {!online?<p className="flex items-center gap-2 text-sky-100"><WifiOff className="h-4 w-4 shrink-0"/>Hors ligne · {date?`prévisions enregistrées le ${date} (Paris).`:'Aucune prévision chargée pour ce lieu.'}</p>:stale?<p className="text-amber-100">Prévisions enregistrées le {date} (Paris). {recent.reason==='refreshing'?'Actualisation en cours…':'Source momentanément indisponible.'}</p>:null}
  {!online&&<p className="mt-1 text-slate-300">Les relevés Netatmo et les fonctions du compte nécessitent une connexion. Conservation des prévisions : 48 h maximum.</p>}
  {update&&<button type="button" className="mt-1 inline-flex min-h-10 items-center gap-2 rounded-lg border border-sky-300/40 px-3 font-semibold text-sky-100" onClick={()=>{window.dispatchEvent(new Event('meteoai-apply-update'));update.waiting?.postMessage({type:'SKIP_WAITING'});}}><RefreshCw className="h-4 w-4"/>Mise à jour disponible · Installer</button>}
 </MeteoSurface></div>;
}

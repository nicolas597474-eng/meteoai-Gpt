import {useEffect,useState,type FormEvent} from 'react';
import {Radio,ShieldCheck} from 'lucide-react';
import {MeteoSurface} from '@/components/weather/MeteoSurface';
import {RestoredWeatherPage,RestoredCardTitle} from '@/components/weather/RestoredWeatherPage';

type Status={configured:boolean;connected:boolean;needsReconnect:boolean;redirectUri:string};
const REDIRECT='https://meteoai-restauree-controle.givingbay1.chatgpt.site/api/netatmo/callback';
async function request(path:string,data?:unknown){
 const response=await fetch('/api/netatmo/'+path,{credentials:'same-origin',cache:'no-store',...(data===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)})});
 const result=await response.json();if(!response.ok)throw Error(result.error??'Connexion Netatmo momentanément indisponible.');return result;
}
/** Les identifiants saisis ne passent que dans le corps POST privé, jamais dans une URL ou un stockage navigateur. */
export default function NetatmoConnection(){
 const [status,setStatus]=useState<Status|null>(null),[clientId,setClientId]=useState(''),[clientSecret,setClientSecret]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[loading,setLoading]=useState(true);
 const refresh=async()=>{setLoading(true);setError('');try{setStatus(await request('status'));}catch(e){setError(e instanceof Error?e.message:'Échec de lecture.');}finally{setLoading(false);}};
 useEffect(()=>{void refresh();},[]);
 const connect=async()=>{setBusy(true);setError('');try{const data=await request('connect',{}),url=new URL(data.url);if(url.origin!=='https://api.netatmo.com'||url.pathname!=='/oauth2/authorize')throw Error('Adresse d’autorisation Netatmo invalide.');window.location.assign(url.toString());}catch(e){setError(e instanceof Error?e.message:'Connexion impossible.');setBusy(false);}};
 const configure=async(event:FormEvent)=>{event.preventDefault();setBusy(true);setError('');try{await request('configure',{clientId:clientId.trim(),clientSecret:clientSecret.trim()});setClientId('');setClientSecret('');await connect();}catch(e){setError(e instanceof Error?e.message:'Enregistrement impossible.');setBusy(false);}};
 const disconnect=async()=>{if(!window.confirm('Supprimer les identifiants et jetons Netatmo enregistrés sur cette application ? Les archives météo sont conservées.'))return;setBusy(true);setError('');try{await request('disconnect',{});window.location.assign('/connexion-netatmo');}catch(e){setError(e instanceof Error?e.message:'Déconnexion impossible.');setBusy(false);}};
 const result=new URLSearchParams(window.location.search).get('netatmo');
 const card='rounded-[22px] border border-sky-300/20 p-4';
 return <RestoredWeatherPage><div className="mx-auto max-w-2xl space-y-3 px-2 pb-28 pt-4 text-slate-100">
  <MeteoSurface as="header" className={card}><RestoredCardTitle level={1} icon={Radio} title="Connecter Netatmo" description="Connexion propre à cette application"/><p className="mt-3 text-sm text-slate-300">Recherche des stations publiques dans un rayon de 50 km autour de votre lieu, cache partagé de 10 minutes.</p><a href="/ranking" className="mt-3 inline-flex min-h-10 items-center text-sm text-sky-300">← Retour aux stations</a></MeteoSurface>
  <MeteoSurface as="section" className={card}><RestoredCardTitle icon={ShieldCheck} title="Votre connexion sécurisée" description="Lecture météo uniquement"/>
   {loading?<p role="status" className="mt-3 text-sm">Vérification de la connexion…</p>:<p role="status" className="mt-3 text-sm text-sky-200">{status?.connected&&!status.needsReconnect?'Netatmo connecté sur cette application.':status?.needsReconnect?'Une nouvelle autorisation Netatmo est nécessaire.':status?.configured?'Identifiants enregistrés. Autorisez maintenant la lecture météo.':'Netatmo n’est pas encore connecté sur cette application.'}</p>}
   {result==='connected'&&status?.connected&&<p className="mt-2 text-sm text-emerald-300">Connexion confirmée. Vous pouvez revenir au Dashboard et choisir Local ou Ultra-local.</p>}
   {result==='failed'&&<p role="alert" className="mt-2 text-sm text-amber-200">L’autorisation n’a pas abouti. Vérifiez l’adresse de redirection ci-dessous puis réessayez.</p>}
   {error&&<p role="alert" className="mt-3 text-sm text-red-300">{error}</p>}
   {!status&& !loading&&<button onClick={()=>void refresh()} className="mt-3 min-h-11 rounded-xl border border-sky-300/30 px-4">Réessayer</button>}
   {status?.configured&&(!status.connected||status.needsReconnect)&&<button disabled={busy} onClick={()=>void connect()} className="mt-3 min-h-11 w-full rounded-xl border border-sky-300/40 bg-sky-400/10 px-4 text-sky-100 disabled:opacity-50">{busy?'Connexion…':'Autoriser Netatmo'}</button>}
   {status?.connected&&!status.needsReconnect&&<div className="mt-3 flex flex-wrap gap-3"><a href="/" className="inline-flex min-h-11 items-center rounded-xl border border-sky-300/30 px-4 text-sky-200">Ouvrir le Dashboard</a><a href="/stations-netatmo" className="inline-flex min-h-11 items-center rounded-xl border border-sky-300/30 px-4 text-sky-200">Consulter les stations à 50 km</a><button disabled={busy} onClick={()=>void disconnect()} className="min-h-11 rounded-xl border border-red-300/30 px-4 text-sm text-red-200 disabled:opacity-50">Déconnecter cette application</button></div>}
  </MeteoSurface>
  <MeteoSurface as="section" className={card}><h2 className="text-base font-semibold text-white">Configurer votre application Netatmo Connect</h2><p className="mt-2 text-sm text-slate-300">Dans Netatmo Connect, ajoutez cette adresse de redirection à votre application :</p><p className="mt-2 break-all rounded-xl border border-slate-600/50 bg-black/20 p-3 text-sm text-sky-200">{status?.redirectUri??REDIRECT}</p><a href="https://dev.netatmo.com/apps/" target="_blank" rel="noopener noreferrer" className="mt-2 inline-flex min-h-11 items-center text-sm text-sky-300">Ouvrir Netatmo Connect ↗</a>
   {status?.connected?<p className="mt-2 text-sm text-slate-400">Connexion active. Les identifiants restent chiffrés côté serveur et ne sont jamais réaffichés.</p>:<form onSubmit={configure} className="mt-3 space-y-3"><label className="block text-sm">Client ID<input required value={clientId} onChange={e=>setClientId(e.target.value)} autoComplete="off" spellCheck={false} className="mt-1 min-h-11 w-full rounded-xl border border-slate-600 bg-black/20 px-3 text-white"/></label><label className="block text-sm">Client Secret<input required type="password" value={clientSecret} onChange={e=>setClientSecret(e.target.value)} autoComplete="off" className="mt-1 min-h-11 w-full rounded-xl border border-slate-600 bg-black/20 px-3 text-white"/></label><button type="submit" disabled={busy||loading||!status} className="min-h-11 w-full rounded-xl border border-sky-300/40 bg-sky-400/10 px-4 text-sm text-sky-100 disabled:opacity-50">{busy?'Enregistrement…':'Enregistrer et connecter Netatmo'}</button></form>}
   <p className="mt-3 text-xs leading-relaxed text-slate-400">Aucune liaison avec l’ancien Site. Vos identifiants et jetons sont chiffrés sur ce Site, séparément pour votre compte. Aucun token n’est conservé dans le navigateur.</p>
  </MeteoSurface>
 </div></RestoredWeatherPage>;
}

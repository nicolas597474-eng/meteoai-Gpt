import {MeteoSurface} from '@/components/weather/MeteoSurface';
import {useEffect,useState} from 'react';
import {MapPin,Radio,ShieldCheck} from 'lucide-react';
import {RestoredWeatherPage,RestoredCardTitle} from '@/components/weather/RestoredWeatherPage';
import {getNetatmoStations as getStations,type NetatmoStation as Station} from '@/lib/netatmoStations';

/** Lecture seule ; jamais de Client Secret ou de jeton dans cette page. */
export default function NetatmoStations({lat=50.7567,lon=2.5204,locationName='Hondeghem',preview=false}:{lat?:number;lon?:number;locationName?:string;preview?:boolean}){
 const [stations,setStations]=useState<Station[]|null>(null),[error,setError]=useState(''),[loading,setLoading]=useState(false),[revision,setRevision]=useState(0),[archiveMessage,setArchiveMessage]=useState('');
 useEffect(()=>{if(preview)return;let active=true;setLoading(true);setError('');setStations(null);setArchiveMessage('');
  getStations(lat,lon).then(async v=>{if(!active)return;setStations(v);
   if(lat!==50.7567||lon!==2.5204){setArchiveMessage('Archivage actuellement limité à Hondeghem.');return;}
   try{
    // Seuls les champs utiles à l'archive sont envoyés ; pas de coordonnées
    // précises de station, de nom de compte ou de jeton Netatmo.
    const minimal=v.map(({id,temp,time,distance,elevation,anomaly})=>({id,temp,time,distance,elevation,anomaly}));
    const total={stored:0,duplicates:0,excluded:0,conflicts:0};
    for(let offset=0;offset<minimal.length;offset+=200){
     const r=await fetch('/api/history/stations',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({lat,lon,stations:minimal.slice(offset,offset+200)}),signal:AbortSignal.timeout(15000)});
     if(!r.ok)throw Error('Archive indisponible');const result=await r.json();
     for(const key of ['stored','duplicates','excluded','conflicts'] as const)total[key]+=result[key]??0;
    }
    if(active)setArchiveMessage(`${total.stored} nouvelle(s) mesure(s) archivée(s) · ${total.duplicates} déjà présente(s)${total.excluded?' · '+total.excluded+' exclue(s)':''}${total.conflicts?' · '+total.conflicts+' conflit(s) conservés sans écrasement':''}. Calibration encore inactive.`);
   }catch{if(active)setArchiveMessage('Mesures visibles, mais archivage non confirmé. Réessayez avec Actualiser.');}
  }).catch(e=>{if(active)setError(e instanceof Error&&e.message!=='Failed to fetch'?e.message:'La connexion Netatmo est indisponible. Vérifiez ses réglages dans cette application.');}).finally(()=>{if(active)setLoading(false);});return()=>{active=false;};
 },[lat,lon,preview,revision]);
 useEffect(()=>{if(preview)return;const timer=window.setInterval(()=>{if(document.visibilityState==='visible')setRevision(r=>r+1);},5*60000);return()=>window.clearInterval(timer);},[preview]);
 const fr=(v:number,digits=1)=>v.toLocaleString('fr-FR',{maximumFractionDigits:digits});
 return <RestoredWeatherPage className="nb-page">
  <style>{`.nb-page{max-width:672px;margin:auto;padding:4px 4px 100px;color:#f1f8ff;font-size:16px;line-height:1.55}.nb-page *{box-sizing:border-box}.nb-page p{margin:8px 0}.nb-muted{color:#b9d6ed}.nb-overline{color:#58d7ff;letter-spacing:.14em;font-size:12px;font-weight:700}.nb-card{padding:12px;margin:12px 0;border-radius:22px}.nb-badge{display:inline-block;color:#69e8cf;background:#093d43;padding:5px 10px;border-radius:30px;font-size:13px}.nb-preview{border:1px solid #f6c35c;color:#ffdb92;background:#47331366;padding:12px;border-radius:14px}.nb-page a,.nb-page button{display:inline-flex;align-items:center;justify-content:center;min-height:46px;padding:10px 14px;margin-top:10px;border:1px solid rgba(100,140,177,.3);border-radius:13px;background:rgba(2,6,23,.55);color:white;font:inherit;text-decoration:none;cursor:pointer}.nb-page button:disabled{opacity:.55;cursor:default}.nb-actions{display:flex;flex-wrap:wrap;gap:10px}.nb-empty{padding:22px 0;color:#cce1f0}.nb-value{font-size:34px;font-weight:750;color:#67e6ed}.nb-station{display:flex;align-items:center;justify-content:space-between;gap:12px}.nb-small{font-size:13px}.nb-page strong{color:white}.nb-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:15px}.nb-tile{padding:12px;border-radius:14px;background:var(--weather-surface-inset)}.nb-symbol{width:46px;height:46px;display:grid;place-items:center;border-radius:15px;background:#148bdc33;color:#63d9ff;font-size:28px}`} </style>
  <MeteoSurface as="header" className="nb-card"><RestoredCardTitle level={1} icon={Radio} title="Stations près de vous" description="Observations locales Netatmo"/><p className="nb-muted">{locationName} · rayon de 50 km</p></MeteoSurface>
  {preview&&<p className="nb-preview" role="status">Aperçu de la page · passerelle non activée. Aucune station ni mesure n’est inventée.</p>}
  <MeteoSurface as="article" className="nb-card"><RestoredCardTitle icon={ShieldCheck} title="Votre connexion Netatmo" description="Netatmo · lecture seule"/><p>Les stations sont lues directement par cette application. Vos identifiants sont chiffrés dans son coffre sécurisé.</p><div className="nb-grid"><div className="nb-tile"><strong>10 minutes</strong><div className="nb-small nb-muted">Cache partagé des stations</div></div><div className="nb-tile"><strong>Aucune clé à recopier</strong><div className="nb-small nb-muted">Lecture via votre connexion</div></div></div><div className="nb-actions"><a href="/connexion-netatmo" target="_blank" rel="noopener noreferrer">Gérer la connexion Netatmo</a><button disabled={preview||loading} onClick={()=>setRevision(r=>r+1)}>Actualiser</button></div></MeteoSurface>
  <MeteoSurface as="article" className="nb-card"><RestoredCardTitle icon={MapPin} title="Mesures disponibles" description="Température et provenance par station"/>
   {preview?<p className="nb-empty">Les stations réelles apparaîtront ici après activation et vérification de la liaison.</p>:loading?<p role="status">Lecture des stations…</p>:error?<p role="alert">{error}</p>:stations?.length===0?<p>Aucune station retournée dans ce rayon. Aucune mesure n’est remplacée par une prévision.</p>:stations?.map(s=><MeteoSurface as="div" key={s.id} className="nb-card" style={{padding:12}}><div className="nb-station"><div><strong>{s.name}</strong><p className="nb-small nb-muted">À {fr(s.distance)} km · altitude {s.elevation===null?'non fournie':fr(s.elevation,0)+' m'}</p></div><span className="nb-value">{fr(s.temp)}°</span></div><p className="nb-small">Mesurée le {new Date(s.time).toLocaleString('fr-FR',{timeZone:'Europe/Paris'})}</p><p className="nb-small nb-muted">Qualité indicative : {fr(s.reliability,0)} / 100 · {s.anomaly?'Mesure à vérifier':'Aucune anomalie signalée par le filtre'}</p></MeteoSurface>)}
  </MeteoSurface>{archiveMessage&&<p role="status" className="nb-small">{archiveMessage} <a href="/suivi-historique">Voir l’archive</a></p>}<p className="nb-small nb-muted">Les mesures sont archivées à l’ouverture et actualisées toutes les cinq minutes lorsque cette page est visible. Elles restent distinctes des prévisions ; le raccordement à l’apprentissage sera vérifié séparément.</p>
 </RestoredWeatherPage>;
}

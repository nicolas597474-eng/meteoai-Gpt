import {MeteoSurface} from '@/components/weather/MeteoSurface';
import {useEffect,useState} from 'react';
import {useQuery} from '@tanstack/react-query';
import {Activity,FlaskConical} from 'lucide-react';
import {RestoredWeatherPage,RestoredCardTitle} from '@/components/weather/RestoredWeatherPage';
import {collectLiveModelComparison} from '@/lib/liveModelQuery';
import {useLocation} from '@/contexts/LocationContext';
import {LIVE_VARIABLES,summarizeLiveComparison,describeLiveModel,selectLiveComparisonSlot,type LiveComparison,type LiveVariable} from '../../../shared/liveModelComparison';
import {liveComparisonQueryKey,MODEL_COMPARISON_REFRESH_MS} from '@/lib/weatherQueryCache';
import './LiveModelComparison.css';

const colors=['#FFD23F','#FF9563','#4CC9F0','#EA9EFF','#80F3BA','#FF8CB5','#C1B1FF','#FFFFFF'];
const number=(value:number|null)=>value===null?'—':value.toLocaleString('fr-FR',{maximumFractionDigits:1});
const date=(value:number|string)=>new Date(value).toLocaleString('fr-FR',{timeZone:'Europe/Paris',weekday:'short',day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'});

/** Comparaison à échéance identique, sans mélanger les heures ou les modèles. */
export default function LiveModelComparisonPage(){
 const {activeLocation}=useLocation(),lat=activeLocation?.lat??50.7567,lon=activeLocation?.lon??2.5204;
 const [variable,setVariable]=useState<LiveVariable>('temperature');
 const [selected,setSelected]=useState(0);
 const query=useQuery({queryKey:liveComparisonQueryKey(lat,lon),queryFn:()=>collectLiveModelComparison(lat,lon),staleTime:MODEL_COMPARISON_REFRESH_MS,refetchInterval:MODEL_COMPARISON_REFRESH_MS,refetchIntervalInBackground:false,refetchOnWindowFocus:false,retry:false});
 const data=query.data,busy=query.isFetching,error=query.error?.message;
 useEffect(()=>{if(data)setSelected(old=>selectLiveComparisonSlot(data.slots,old));},[data]);
 const selectedSlot=data?selectLiveComparisonSlot(data.slots,selected):0;
 const definition=LIVE_VARIABLES.find(v=>v.key===variable)!;
 const summary=data?summarizeLiveComparison(data,selectedSlot,variable):null;
 const values=summary?.members.filter(m=>m.value!==null).map(m=>m.value!)??[];
 const min=values.length?Math.min(...values):0,max=values.length?Math.max(...values):1;
 const padding=Math.max((max-min)*.15,variable==='temperature'?1:.5),low=min-padding,high=max+padding;
 return <RestoredWeatherPage className="live-models">
  <MeteoSurface as="header" className="live-card"><RestoredCardTitle level={1} icon={FlaskConical} title="Accord des modèles" description="AI Lab · données Open-Meteo"/><p className="live-note">{activeLocation?.name??'Hondeghem'} · comparaison à la même échéance</p></MeteoSurface>
  <MeteoSurface as="section" className="live-card" aria-label="Choix de la comparaison">
   <div className="live-variables" aria-label="Variable météo">{LIVE_VARIABLES.map(v=><button key={v.key} aria-pressed={variable===v.key} onClick={()=>setVariable(v.key)}>{v.label}</button>)}</div>
   <label className="live-hour">Échéance · heure de Paris<select value={selectedSlot} disabled={!data?.slots.length} onChange={e=>setSelected(Number(e.target.value))}>{data?.slots.map(t=><option key={t} value={t}>{date(t)}</option>)}</select></label>
   <button className="live-refresh" disabled={busy} onClick={()=>void query.refetch()}>{busy?'Collecte en cours…':'Vérifier les données'}</button>
   <p className="live-note">Cache de 5 minutes partagé avec le tableau de bord. Les vérifications pendant ce délai réutilisent les résultats reçus.</p>
  </MeteoSurface>
  {error&&<MeteoSurface as="p" role="alert" className="live-card">{error}</MeteoSurface>}
  {busy&&<MeteoSurface as="p" role="status" className="live-card">{data?'Actualisation du comparatif…':'Interrogation des modèles disponibles…'}</MeteoSurface>}
  {data&&summary&&<>
   <section className="live-summary" aria-label="Synthèse de la comparaison">
    <MeteoSurface as="div" className="live-card"><span>Disponibles</span><strong>{summary.contributors}<small> / 7</small></strong></MeteoSurface>
    <MeteoSurface as="div" className="live-card"><span>Écart entre modèles</span><strong>{number(summary.spread)}<small> {definition.unit}</small></strong></MeteoSurface>
    <MeteoSurface as="div" className="live-card"><span>Fusion MeteoAI</span><strong>{number(summary.consensus)}<small> {definition.unit}</small></strong></MeteoSurface>
   </section>
   <MeteoSurface as="section" className="live-card" aria-label="Valeurs individuelles des modèles">
    <RestoredCardTitle icon={Activity} title={definition.label+' · '+definition.unit} description={date(selectedSlot)+' · heure de Paris'}/>
    <p className="live-note">Une ligne par modèle, sur une échelle commune. L'écart est la différence maximum − minimum des sept modèles de fusion disponibles.</p>
    <div className="live-axis" aria-hidden="true"><span>{number(low)}</span><span>{number(high)}</span></div>
    {summary.members.map((m,i)=><div className={'live-model-row'+(m.reference?' live-reference':'')} key={m.name}>
     <div className="live-model-heading"><strong><i style={{background:colors[i]}}/>{m.reference?'Best Match':m.name}</strong><b style={{color:colors[i]}}>{number(m.value)} <small>{m.value===null?'':definition.unit}</small></b></div>
     <div className="live-track" aria-hidden="true">{m.value!==null&&<span style={{left:((m.value-low)/(high-low)*100)+'%',background:colors[i],boxShadow:'0 0 12px '+colors[i]}}/>}</div>
     <p className="live-note">{describeLiveModel(m,selectedSlot,variable)}{m.collectedAt?' · reçue '+date(m.collectedAt):''}{m.reference?' · référence Open-Meteo exclue de la fusion et de son écart':''}</p>
    </div>)}
   </MeteoSurface>
   <MeteoSurface as="aside" className="live-card live-note"><p>Réception des modèles : {date(data.collectedAt)}{data.stale?' · prévisions enregistrées, actualisation nécessaire':''}.</p>{summary.contributors<2&&<p>Le calcul d’un écart nécessite au moins deux modèles disponibles pour cette variable à cette heure.</p>}<p>La fusion utilise le repli robuste du moteur d'origine. La calibration par l'historique des erreurs n'est pas encore réactivée. Un faible écart ne garantit pas une prévision exacte.</p><p>Cette page restaure le comparatif direct. Les autres analyses de l'ancien AI Lab restent à migrer.</p></MeteoSurface>
  </>}
 </RestoredWeatherPage>;
}

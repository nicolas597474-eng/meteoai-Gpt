import {MeteoSurface} from '@/components/weather/MeteoSurface';
import {useEffect,useState} from 'react';
import {Activity,ChartNoAxesCombined,Clock,Database,ShieldCheck} from 'lucide-react';
import {RestoredWeatherPage,RestoredCardTitle} from '@/components/weather/RestoredWeatherPage';
import {Link} from 'wouter';
import {FORECAST_HORIZON_WINDOWS} from '../../../shared/forecastHorizon';
import type {buildProvisionalComparisons} from '../../../worker/provisional-comparisons';
import type {archiveStatus} from '../../../worker/archive';
import type {observationStatus} from '../../../worker/station-observations';
import './LiveModelComparison.css';
import './RestoredHistory.css';

type Comparison=ReturnType<typeof buildProvisionalComparisons>&{boundedRead:boolean;rejectedArchives:number};
type Archive=Awaited<ReturnType<typeof archiveStatus>>;
type Observation=Awaited<ReturnType<typeof observationStatus>>;
type Row={model:string;validTime:number;forecast:number;observed:number;error:number;availableAt:number;horizonMinutes:number;horizonBucket:string;stations:number;firstMeasuredAt:number;lastMeasuredAt:number};
const fr=(v:number|null|undefined)=>v==null?'—':v.toLocaleString('fr-FR',{maximumFractionDigits:1});
const date=(v:number|string)=>new Date(v).toLocaleString('fr-FR',{timeZone:'Europe/Paris',day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'});
const bucket=(value:string)=>FORECAST_HORIZON_WINDOWS.find(h=>h.key===value)?.label??value;

/** Une seule courbe de modèle à la fois ; les lacunes restent des lacunes. */
function ComparisonChart({rows}:{rows:Row[]}){
 const points=[...rows].sort((a,b)=>a.validTime-b.validTime).slice(-48);
 if(!points.length)return <p>Aucun point comparable pour ce modèle et cet horizon.</p>;
 const times=points.map(r=>r.validTime),first=Math.min(...times),last=Math.max(...times);
 const all=points.flatMap(r=>[r.forecast,r.observed]),min=Math.floor(Math.min(...all)-1),max=Math.ceil(Math.max(...all)+1);
 const x=(time:number)=>points.length===1?190:44+(time-first)/(last-first)*290;
 const y=(value:number)=>155-(value-min)/(max-min)*125;
 const segments:Row[][]=[];for(const row of points){const prev=segments.at(-1);if(!prev||row.validTime-prev[prev.length-1].validTime!==3600000)segments.push([row]);else prev.push(row);}
 return <>
  <svg viewBox="0 0 370 210" role="img" aria-label={`Température prévue et référence locale provisoire, ${points.length} créneau(x). Les interruptions ne sont pas reliées.`}>
   {[min,(min+max)/2,max].map(v=><g key={v}><line x1="44" x2="340" y1={y(v)} y2={y(v)} stroke="#ffffff25"/><text x="5" y={y(v)+4} fill="#e2f3ff" fontSize="16">{fr(v)}°</text></g>)}
   {segments.map((segment,i)=><g key={i}><polyline fill="none" stroke="#ffba57" strokeWidth="3" points={segment.map(r=>`${x(r.validTime)},${y(r.forecast)}`).join(' ')}/><polyline fill="none" stroke="#69f0ce" strokeWidth="3" strokeDasharray="5 4" points={segment.map(r=>`${x(r.validTime)},${y(r.observed)}`).join(' ')}/></g>)}
   {points.map(r=><g key={r.validTime}><circle cx={x(r.validTime)} cy={y(r.forecast)} r="4" fill="#ffba57"><title>{date(r.validTime)} · prévu {fr(r.forecast)} °C</title></circle><circle cx={x(r.validTime)} cy={y(r.observed)} r="4" fill="#69f0ce"><title>{date(r.validTime)} · référence provisoire {fr(r.observed)} °C</title></circle></g>)}
   <text x="44" y="187" fill="#e2f3ff" fontSize="16">{date(first)}</text>{last!==first&&<text x="340" y="204" textAnchor="end" fill="#e2f3ff" fontSize="16">{date(last)}</text>}
  </svg>
  <p className="history-legend"><span>● Prévision archivée</span><span>● Référence locale provisoire</span></p>
  <p className="live-note">{points.length===1?'Premier point disponible : aucune tendance ne peut encore être tracée.':'48 derniers créneaux au maximum. Les heures sans comparaison ne sont pas reliées.'}</p>
 </>;
}

export default function RestoredHistory(){
 const [days,setDays]=useState<7|14|30>(7),[revision,setRevision]=useState(0),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const [state,setState]=useState<{comparisons:Comparison;archive:Archive;observations:Observation}|null>(null);
 const [model,setModel]=useState('AROME'),[horizon,setHorizon]=useState('all');
 useEffect(()=>{const controller=new AbortController();setBusy(true);setError('');setState(null);
  async function read(path:string){const response=await fetch(path,{credentials:'same-origin',cache:'no-store',signal:controller.signal});if(!response.ok)throw Error(response.status===401?'Reconnectez-vous au Site privé pour consulter votre historique.':'Lecture de l’historique momentanément indisponible.');return response.json();}
  Promise.all([read('/api/history/comparisons?days='+days),read('/api/history/status'),read('/api/history/stations/status')]).then(([comparisons,archive,observations])=>{if(controller.signal.aborted)return;setState({comparisons,archive,observations});setHorizon('all');setModel(old=>comparisons.models.some((m:any)=>m.model===old)?old:comparisons.models[0]?.model??'AROME');}).catch(e=>{if(!controller.signal.aborted)setError(e instanceof Error?e.message:'Lecture indisponible');}).finally(()=>{if(!controller.signal.aborted)setBusy(false);});return()=>controller.abort();
 },[days,revision]);
 const comparisons=state?.comparisons;
 const models=Array.from(new Set(comparisons?.models.map(m=>m.model)??[])).sort();
 const horizons=Array.from(new Set(comparisons?.models.filter(m=>m.model===model).map(m=>m.horizonBucket)??[]));
 const rows:Row[]=(comparisons?.details??[]).filter((r:Row)=>r.model===model&&(horizon==='all'||r.horizonBucket===horizon));
 const summary=comparisons?.models.filter(m=>m.model===model&&(horizon==='all'||m.horizonBucket===horizon))??[];
 const selectedCount=summary.reduce((n,r)=>n+r.comparisons,0);
 const legacyRows=state?.archive.legacy.reduce((n:number,r:any)=>n+Number(r.rows),0)??0;
 return <RestoredWeatherPage className="live-models history-page">
  <MeteoSurface as="header" className="live-card"><RestoredCardTitle level={1} icon={ShieldCheck} title="Prévu et mesuré" description="Fiabilité · historique en reprise"/><p className="live-note">Hondeghem · température · référence locale provisoire</p></MeteoSurface>
  <MeteoSurface as="section" className="live-card"><div className="live-variables" aria-label="Période de comparaison">{([7,14,30] as const).map(d=><button key={d} aria-pressed={days===d} onClick={()=>setDays(d)}>{d} jours</button>)}</div><button className="live-refresh" disabled={busy} onClick={()=>setRevision(r=>r+1)}>{busy?'Lecture en cours…':'Actualiser le suivi'}</button><p className="live-note">Cette page relit les archives. Pour recevoir de nouvelles données, ouvrez <Link href="/">la météo</Link> et <Link href="/ranking">les stations</Link>. La collecte quand l’application est fermée reste à activer.</p></MeteoSurface>
  {busy&&<MeteoSurface as="p" className="live-card" role="status">Vérification des archives et des créneaux terminés…</MeteoSurface>}
  {error&&<MeteoSurface as="p" className="live-card" role="alert">{error}</MeteoSurface>}
  {state&&comparisons&&<>
   <section className="live-summary" aria-label="État de la reprise"><MeteoSurface as="div" className="live-card"><span>Créneaux exploitables</span><strong>{comparisons.completedReferenceHours}</strong></MeteoSurface><MeteoSurface as="div" className="live-card"><span>Paires prévu / mesuré</span><strong>{comparisons.comparisonCount}</strong></MeteoSurface><MeteoSurface as="div" className="live-card"><span>Mesures archivées</span><strong>{fr(state.observations.measurements)}</strong></MeteoSurface></section>
   <MeteoSurface as="section" className="live-card"><RestoredCardTitle icon={ChartNoAxesCombined} title="Comparer un modèle" description="Prévisions et mesures archivées"/>
    <div className="history-selectors"><label className="live-hour">Modèle<select value={model} disabled={!models.length} onChange={e=>{setModel(e.target.value);setHorizon('all');}}>{models.map(m=><option key={m}>{m}</option>)}</select></label><label className="live-hour">Horizon de la prévision<select value={horizon} onChange={e=>setHorizon(e.target.value)}><option value="all">Tous les horizons · détail séparé</option>{horizons.map(h=><option key={h} value={h}>{bucket(h)}</option>)}</select></label></div>
    {comparisons.comparisonCount?<><ComparisonChart rows={rows}/><p className="live-note">{selectedCount} comparaison(s) pour cette sélection. Chaque échéance utilise la dernière prévision admissible, archivée avant les mesures.</p></>:<p>Aucune comparaison exploitable pour cette période. Il faut un créneau terminé, au moins trois stations valides et une prévision archivée à l’avance.</p>}
    {comparisons.pendingReferenceHours>0&&<p className="live-note">{comparisons.pendingReferenceHours} créneau(x) encore en cours.{comparisons.nextReviewAt?' Nouvelle lecture possible après '+date(comparisons.nextReviewAt)+'.':''}</p>}
    {(comparisons.boundedRead||comparisons.detailsTruncated)&&<p role="status" className="history-warning">La limite de lecture est atteinte. Ce contrôle montre une partie des archives de la période sélectionnée.</p>}
    {comparisons.rejectedArchives>0&&<p role="status" className="history-warning">{comparisons.rejectedArchives} archive(s) exclue(s) après contrôle d’intégrité.</p>}
   </MeteoSurface>
   <MeteoSurface as="section" className="live-card"><RestoredCardTitle icon={Clock} title="Les écarts, créneau par créneau" description="Température · prévu et mesuré"/><p className="live-note">Écart = prévu − référence locale. Orange : plus chaud ; cyan : plus froid. La référence regroupe des mesures du créneau, prises à des instants différents.</p>
    {!rows.length&&<p>Aucune ligne pour cette sélection.</p>}
    {rows.slice(0,28).map(r=><article className="history-row" key={r.model+'|'+r.validTime}><div className="history-row-title"><strong>{date(r.validTime)}</strong><b style={{color:r.error>=0?'#ffbe71':'#64dfef'}}>{Math.abs(r.error)<0.05?'≈ 0':(r.error>0?'+':'')+fr(r.error)} °C</b></div><div className="history-values"><span>Prévu<strong>{fr(r.forecast)} °C</strong></span><span>Référence<strong>{fr(r.observed)} °C</strong></span></div><p className="live-note">{r.stations} stations · mesures de {date(r.firstMeasuredAt)} à {date(r.lastMeasuredAt)} · horizon {fr(r.horizonMinutes/60)} h ({bucket(r.horizonBucket)})</p><details><summary>Provenance de la prévision</summary><p className="live-note">Disponible au plus tard le {date(r.availableAt)}. Comparaison exploratoire, exclue de la calibration.</p></details></article>)}
    {rows.length>28&&<p className="live-note">Les 28 lignes les plus récentes sont affichées ici. Le graphique présente jusqu’à 48 créneaux.</p>}
   </MeteoSurface>
   <MeteoSurface as="section" className="live-card"><RestoredCardTitle icon={Activity} title="Maturité des résultats" description="Volume et durée de l’échantillon"/><p>La calibration et le classement officiel restent inactifs.</p><p className="live-note">Les statistiques du moteur demandent au moins {comparisons.thresholds.minimumComparisons} comparaisons sur {comparisons.thresholds.minimumDays} jours par modèle et par horizon. Le classement public demande {comparisons.thresholds.publicRanking.minimumComparisons} comparaisons sur {comparisons.thresholds.publicRanking.minimumComparableDays} jours.</p>
    {summary.map(m=><div className="history-maturity" key={m.horizonBucket}><strong>{model} · {bucket(m.horizonBucket)}</strong><p className="live-note">{m.comparisons} comparaison(s) · {m.days} jour(s) · {m.maturity}</p>{m.mae!==null?<p>MAE {fr(m.mae)} °C · RMSE {fr(m.rmse)} °C · biais {fr(m.bias)} °C <small>· exploratoire uniquement</small></p>:<p className="live-note">MAE, RMSE et biais : échantillon insuffisant.</p>}</div>)}
    <details><summary>Méthode et limites</summary><p className="live-note">{comparisons.method}</p><p className="live-note">{comparisons.excludedMeasurements} mesure(s) écartée(s). Aucune mesure de pluie ou de vent n’est encore raccordée à ce contrôle. Un ancien score récupéré ne remplace pas une mesure récente.</p></details>
   </MeteoSurface>
   <MeteoSurface as="section" className="live-card"><RestoredCardTitle icon={Database} title="Historique récupéré conservé" description="Sauvegarde vérifiée"/><p><strong>{legacyRows} lignes</strong> de la sauvegarde sont présentes dans ce Site. Elles restent séparées des nouvelles comparaisons.</p><p className="live-note">Il s’agit de l’échantillon transféré et vérifié. La sauvegarde complète reste locale. Les périodes manquantes ne sont pas reconstituées.</p><a href="/controle-historique">Consulter les lignes récupérées →</a><br/><a href="/suivi-historique">Voir le détail des archives →</a></MeteoSurface>
  </>}
 </RestoredWeatherPage>;
}

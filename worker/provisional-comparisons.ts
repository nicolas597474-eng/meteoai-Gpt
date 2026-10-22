import {readVerifiedObservations} from './observation-integrity';
import {readForecastsBeforeObservedHours} from './forecast-observation-window';
import {buildPhysicalReferences} from './physical-references';
import {evaluateHourlyForecastRuns,type HourlyForecastRunValue} from '../server/hourlyForecastRunScoring';
import {getParisDateAndHour} from '../server/parisHourlyTime';
import {MINIMUM_RELIABILITY_COMPARISONS,PUBLIC_RANKING_EVIDENCE_THRESHOLDS,getStatisticalConfidence} from '../server/weatherReliabilityConfig';
const LOCATION='50.757_2.520',HOUR=3600000;
type ArchivedCapture={id:string;receivedAt:number;payload:any};

/** Laboratoire en lecture seule. Les règles spatiales et temporelles sont
 * celles des modules originaux ; aucun score n'est injecté dans la fusion. */
export function buildProvisionalComparisons(captures:ArchivedCapture[],observations:any[],now=Date.now(),windowDays:7|14|30=7){
 const {snapshots,references,pendingHours,excluded}=buildPhysicalReferences(observations,now);
 const values:HourlyForecastRunValue[]=[];
 for(const capture of captures){
  if(capture.payload.kind!=='forecast'||capture.payload.location!==LOCATION||!Number.isFinite(capture.receivedAt))continue;
  for(const model of capture.payload.models??[]){
   // La réception serveur constitue la borne conservatrice de disponibilité.
   const availableAt=Math.max(capture.receivedAt,capture.payload.capturedAt??0,model.availableAt??0);
   const requestStartedAt=Number.isFinite(model.requestStartedAt)&&model.requestStartedAt<=availableAt?model.requestStartedAt:availableAt;
   for(const hour of model.hours??[]){const local=getParisDateAndHour(hour.validAt);if(!local||!Number.isFinite(hour.temperature)||hour.validAt>now)continue;
    values.push({captureRunId:capture.id+'|'+model.modelName,locationKey:LOCATION,targetDate:local.date,sourceName:'open-meteo',modelName:model.modelName,modelId:model.modelId??null,requestStartedAt,availableAt,validTime:hour.validAt,variable:'temperature',value:hour.temperature,unit:'°C'});
   }
  }
 }
 const evaluated=evaluateHourlyForecastRuns(snapshots,values);
 const comparisons=evaluated.exactComparisons.filter(c=>c.variable==='temperature');
 const grouped=new Map<string,typeof comparisons>();
 for(const c of comparisons){const key=c.modelName+'|'+c.horizonBucket;grouped.set(key,[...(grouped.get(key)??[]),c]);}
 const models=Array.from(grouped.values()).map(rows=>{
  const days=new Set(rows.map(r=>r.observationDate)).size,maturity=getStatisticalConfidence({comparisons:rows.length,evaluatedDays:days});
  return {model:rows[0].modelName,horizonBucket:rows[0].horizonBucket,comparisons:rows.length,days,maturity:maturity.label,mae:maturity.isRankable?rows.reduce((n,r)=>n+r.absoluteError,0)/rows.length:null,rmse:maturity.isRankable?Math.sqrt(rows.reduce((n,r)=>n+r.signedError**2,0)/rows.length):null,bias:maturity.isRankable?rows.reduce((n,r)=>n+r.signedError,0)/rows.length:null,officialRanking:false};
 });
 const details=comparisons.map(c=>({model:c.modelName,validTime:c.validTime,availableAt:c.availableAt,horizonMinutes:c.horizonMinutes,horizonBucket:c.horizonBucket,forecast:c.forecastValue,observed:c.observedValue,error:c.signedError,stations:c.stationCount,...references.find(r=>r.validTime===c.validTime)})).sort((a,b)=>b.validTime-a.validTime||a.model.localeCompare(b.model));
 return {diagnostics:evaluated.diagnostics.filter(item=>item.variable==='temperature'),provisional:true,calibration:'not_active',officialRanking:false,windowDays,capturesRead:captures.length,measurementsRead:observations.length,completedReferenceHours:snapshots.length,pendingReferenceHours:pendingHours.size,nextReviewAt:pendingHours.size?Math.min(...Array.from(pendingHours))+HOUR:null,excludedMeasurements:excluded,comparisonCount:comparisons.length,models,details:details.slice(0,350),detailsTruncated:details.length>350,thresholds:{minimumComparisons:MINIMUM_RELIABILITY_COMPARISONS,minimumDays:2,publicRanking:PUBLIC_RANKING_EVIDENCE_THRESHOLDS},method:'Créneaux horaires terminés ; dernière mesure par station ; QC et pondération spatiale du moteur original ; disponibilité des prévisions antérieure aux mesures ; horizons séparés. Priorité technique neutre du moteur pour les stations sans historique ; altitude de référence inconnue, aucune correction appliquée. Données reçues via navigateur, non qualifiées pour la calibration.'};
}
export async function readProvisionalComparisons(env:any,now=Date.now(),windowDays:7|14|30=7){
 if(![7,14,30].includes(windowDays))throw Error('Fenêtre autorisée : 7, 14 ou 30 jours');
 const physical=await readVerifiedObservations(env,now,windowDays*24);
 const forecasts=await readForecastsBeforeObservedHours(env,physical.rows,now);
 const observations=physical.rows.map(row=>({station_key:row.stationKey,measured_at:row.measuredAt,received_at:row.receivedAt,temperature:row.temperature,source:'netatmo_browser_bridge',quality_flags:JSON.stringify(row.flags),distance:row.distance,elevation:row.elevation}));
 return {...buildProvisionalComparisons(forecasts.captures,observations,now,windowDays),rejectedArchives:forecasts.rejectedArchives,boundedRead:forecasts.boundedRead||physical.boundedRead,integrity:{physicalFiles:physical.checkedArchives,rejectedPhysicalFiles:physical.rejectedArchives,searchedHours:forecasts.searchedHours,observedHours:forecasts.observedHours,unmatchedHours:forecasts.unmatchedHours}};
}
export function comparisonHtml(data:ReturnType<typeof buildProvisionalComparisons>&{rejectedArchives?:number;boundedRead?:boolean;integrity?:{rejectedPhysicalFiles:number}}){
 const esc=(v:any)=>String(v??'—').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
 const number=(v:number)=>v.toLocaleString('fr-FR',{maximumFractionDigits:1});
 const date=(v:number)=>new Date(v).toLocaleString('fr-FR',{timeZone:'Europe/Paris',day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'});
 const latest=data.details[0]?.validTime,rows=data.details.filter(r=>r.validTime===latest);
 const warning=(data.nextReviewAt?`<p>Prochain créneau examinable après ${esc(date(data.nextReviewAt))}, une fois terminé.</p>`:'')
  +(data.rejectedArchives?`<p role="status">${Number(data.rejectedArchives)} archive(s) de prévision exclue(s) après contrôle d’intégrité.</p>`:'')
  +(data.integrity?.rejectedPhysicalFiles?`<p role="status">${Number(data.integrity.rejectedPhysicalFiles)} lot(s) physique(s) exclu(s) après contrôle d’intégrité.</p>`:'')
  +(data.boundedRead?'<p role="status">La fenêtre de contrôle a atteint sa limite de lecture ; elle ne représente pas tout l’historique.</p>':'');
 return `<article><h2>Prévu / mesuré · contrôle provisoire</h2>${warning}<p>${data.completedReferenceHours} créneau(x) terminé(s) exploitable(s) · ${data.comparisonCount} paire(s) modèle / référence locale · ${data.pendingReferenceHours} créneau(x) encore en cours.</p>${rows.length?`<p>Créneau du ${esc(date(latest))}. Référence locale calculée à partir de ${rows[0].stations} stations. Mesures du ${esc(date(rows[0].firstMeasuredAt))} au ${esc(date(rows[0].lastMeasuredAt))} : ce sont des mesures du créneau, pas toutes prises à son début.</p><div style="overflow-x:auto"><table style="width:100%;min-width:430px;border-collapse:collapse"><thead><tr><th>Modèle</th><th>Prévu</th><th>Référence</th><th>Écart</th><th>Horizon</th></tr></thead><tbody>${rows.map(r=>`<tr><td>${esc(r.model)}</td><td>${esc(number(r.forecast))} °C</td><td>${esc(number(r.observed))} °C</td><td style="color:${r.error>=0?'#ffbe71':'#64dfef'}">${r.error>0?'+':''}${esc(number(r.error))} °C</td><td>${esc(number(r.horizonMinutes/60))} h</td></tr>`).join('')}</tbody></table></div>`:'<p>En attente d’un créneau horaire terminé, avec au moins trois stations exploitables et une prévision archivée avant les mesures. Aucune valeur n’est créée pour remplir le tableau.</p>'}<p>Ces écarts restent exploratoires. La calibration et le classement officiel sont inactifs. Le moteur d’origine demande au moins ${data.thresholds.minimumComparisons} comparaisons et ${data.thresholds.minimumDays} jours pour ses statistiques ; le classement public demande ${data.thresholds.publicRanking.minimumComparisons} comparaisons sur ${data.thresholds.publicRanking.minimumComparableDays} jours.</p><details><summary>Méthode et limites</summary><p>${esc(data.method)}</p><p>Lecture de contrôle bornée à huit lots physiques et aux prévisions antérieures à huit heures observées au maximum. Les mesures signalées par les contrôles de qualité sont exclues de cette comparaison.</p></details></article>`;
}

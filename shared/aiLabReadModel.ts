import {OFFICIAL_HOURLY_MODELS} from '../server/officialModels';
import {EXTENDED_REGIME_INFO} from '../server/fusionEngine';
import {buildAppliedModelWeights,filterForecastTraceToModelNames} from '../server/aiLabTrace';
import {buildModelIndicator} from '../server/modelIndicator';
import {buildAILabForecastComparisonReadModel,formatAILabLocationLabel} from '../server/aiLabForecastComparison';
import type {OfficialWeatherSnapshot} from '../server/officialWeatherSnapshot';
import {summarizeDailyModelAgreement} from './modelAgreement';
import {summarizePrecipitationModels} from './precipitationConsensus';
import type {ForecastTrace,OfficialDailyForecastInput} from '../server/officialForecast';
import type {DayForecast} from '../server/weatherServices';

export type AILabDailyDetail={forecasts:OfficialDailyForecastInput[];trace:ForecastTrace};
export type AILabDailyPayload={learningSummary?:{available:boolean;scoreCount:number;qualifiedDays:number;hourlyEvidenceDays?:number;qualifiedGroups:number;lastScoreAt:number|null;filesRejected:number}|null;days:DayForecast[];modelsUsed:string[];aiLabDetails?:Record<string,AILabDailyDetail>;controlCache?:{stale?:boolean}};
const names:string[]=OFFICIAL_HOURLY_MODELS.map(model=>model.name);
const finite=(value:unknown):number|null=>typeof value==='number'&&Number.isFinite(value)?value:null;
const instant=(value:unknown):string|null=>typeof value==='string'&&Number.isFinite(Date.parse(value))?value:null;

/** Projection du calcul déjà effectué : aucune collecte, aucun nouveau poids, aucun score créé. */
export function buildAILabReadModel(hourly:any|null,daily:AILabDailyPayload|null,coordinates:{lat:number;lon:number},now=Date.now()) {
  const date=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Paris',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);
  const learning=daily?.learningSummary??hourly?.learningSummary;
  const day=daily?.days.find(item=>item.date===date)??null;
  const detail=daily?.aiLabDetails?.[date]??null;
  const forecasts=(detail?.forecasts??[]).filter(model=>names.includes(model.serviceName));
  const rawTrace=detail?.trace??null;
  // La page historique nomme ces groupes « température » et « vent ».
  // Il s’agit ici précisément de Tmax et du vent maximal quotidien, sans mélanger Tmin.
  const trace=rawTrace?filterForecastTraceToModelNames({...rawTrace,parameterSources:{...rawTrace.parameterSources,temperature:rawTrace.parameterSources.tempMax,wind:rawTrace.parameterSources.windSpeed}},new Set(names)):null;
  const appliedModelWeights=buildAppliedModelWeights(trace);
  const modelIndicator=buildModelIndicator(trace);
  const modelAgreement=summarizeDailyModelAgreement(forecasts.map(model=>({modelName:model.serviceName,...model})),names,0);
  const precipitationConsensus=summarizePrecipitationModels(forecasts.map(model=>({modelName:model.serviceName,amountMm:model.precipitation})),names);
  const regime=hourly?.regime??null;
  const primary=regime?.primary??null;
  const calculatedAt=instant(day?.officialFusion?.referenceAt);
  const hourlyComputedAt=instant(hourly?.officialSnapshot?.hourlyComputedAt??hourly?.officialSnapshot?.computedAt);
  const stale=Boolean(daily?.controlCache?.stale||hourly?.officialSnapshot?.snapshotStatus==='stale');
  const comparison=buildAILabForecastComparisonReadModel({
    computedAt:calculatedAt??hourlyComputedAt,
    hourlyComputedAt,
    sourceKind:'official_forecast',source:'open-meteo',
    hourlyWeighting:hourly?.officialSnapshot?.hourlyWeighting??{modelsConsidered:names,bestMatchIncluded:false},
    currentSnapshot:hourly?.currentSnapshot??null,hourly:hourly?.hours??[],daily:daily?.days??[],modelsUsed:daily?.modelsUsed??[],
  } as unknown as OfficialWeatherSnapshot,coordinates);
  // Le calcul journalier possède son propre instant, distinct du calcul horaire.
  comparison.dailyForecast.computedAt=calculatedAt as string;
  const number=(value:unknown)=>finite(value)===null?'—':new Intl.NumberFormat('fr-FR',{maximumFractionDigits:2}).format(value as number);
  const aiAnalysis=[
    `Lecture du calcul original pour ${formatAILabLocationLabel(coordinates)}.`,
    day?`Prévision du ${date} : ${number(day.tempMax)} °C maximum, ${number(day.tempMin)} °C minimum et ${number(day.precipitation)} mm de précipitations.`:'Prévision quotidienne du jour indisponible : aucun autre jour ne la remplace.',
    `${forecasts.length}/${names.length} modèles officiels disposent de données quotidiennes dans cette collecte. Best Match reste une référence séparée.`,
    primary?`Régime horaire dominant : ${primary.label}.`:'Régime horaire indisponible.',
    learning?.available
      ? `Les poids affichés sont ceux du calcul existant. ${learning.scoreCount} score(s) vérifié(s), ${learning.qualifiedGroups} groupe(s) admissible(s) pour l’apprentissage ; seuls les seuils atteints autorisent une pondération historique.`
      : 'Les poids affichés sont ceux du calcul existant. Lecture des preuves historiques indisponible ; aucun score ni poids historique n’est ajouté sans preuve.',
    stale?'Dernières prévisions mises en cache : actualisation non confirmée.':'',
  ].filter(Boolean).join(' ');
  return {
    presentationStatus:day||comparison.hourlyForecast.points.length?'connected':'awaiting_data',date,
    regime:primary?.id??null,regimeStatus:regime?.status??'unknown',regimeLabel:primary?.label??null,regimeEmoji:primary?.emoji??null,
    regimeDescription:primary?.description??regime?.description??'Données requises indisponibles.',weights:regime?.blendedWeights??null,allRegimes:EXTENDED_REGIME_INFO,
    modelDetails:names.map(name=>{const model=forecasts.find(item=>item.serviceName===name);return {name,label:name,tempMax:finite(model?.tempMax),tempMin:finite(model?.tempMin),precipitation:finite(model?.precipitation),windSpeed:finite(model?.windSpeed),cloudCover:finite(model?.cloudCover),condition:null,averageWeight:appliedModelWeights.find(item=>item.name===name)?.averageWeight??null};}),
    modelAgreement,precipitationConsensus,
    divergence:{tempRange:modelAgreement.tempMax.range,precipRange:modelAgreement.precipitation.range,windRange:modelAgreement.windSpeed.range,expectedModelCount:names.length},
    trace,modelIndicator,appliedModelWeights,
    officialForecast:{tempMax:finite(day?.tempMax),tempMin:finite(day?.tempMin),precipitation:finite(day?.precipitation),windSpeed:finite(day?.windSpeed),computedAt:calculatedAt?new Date(calculatedAt):null},
    latestStationCollection:null,aiAnalysis,
    replaySteps:[
      {step:1,title:'Collecte des flux',description:`${forecasts.length} modèles officiels reçus pour le jour demandé, distincts de Best Match.`,icon:'📡'},
      {step:2,title:'Détection du régime',description:primary?`Régime horaire : ${primary.label}.`:'Données requises indisponibles.',icon:'🔍'},
      {step:3,title:'Mesures par variable',description:'Les données manquantes restent absentes ; chaque variable possède son propre effectif.',icon:'📐'},
      {step:4,title:'Pondération de fusion',description:trace?'Lecture des poids finaux du moteur, sans nouveau calcul.':'Trace du calcul quotidien indisponible.',icon:'⚖️'},
      {step:5,title:'Accord inter-modèles',description:'Étendues descriptives des valeurs reçues pour le jour cible, avec effectif propre à chaque variable ; aucun cycle commun ni score de fiabilité n’est déduit.',icon:'📊'},
      {step:6,title:'Synthèse MeteoAI',description:day?`${number(day.tempMax)} °C max · ${number(day.tempMin)} °C min · ${number(day.precipitation)} mm.`:'Résultat quotidien indisponible.',icon:'🤖'},
      {step:7,title:'Fiabilité historique',description:learning?.available?`${learning.scoreCount} score(s) enregistré(s), ${learning.qualifiedDays} journée(s) quotidienne(s) qualifiée(s)${learning.hourlyEvidenceDays==null?'':`, ${learning.hourlyEvidenceDays} date(s) avec comparaisons horaires`} ; ${learning.qualifiedGroups} groupe(s) admissible(s) pour l’apprentissage, par modèle, variable et horizon. Aucun score global n’est déduit du nombre de modèles.`:'Lecture des scores qualifiés indisponible ; aucun poids historique ajouté.',icon:'✅'},
    ],
    sources:[
      {name:'Open-Meteo API',type:'Sept modèles officiels ; Best Match séparé',models:names,updateFrequency:'À la consultation · cache partagé de 5 minutes',lastSync:calculatedAt??hourlyComputedAt,quality:'Prévisions de modèles, pas observations physiques'},
      {name:'Stations physiques',type:'Observations locales',models:[],updateFrequency:'Flux Netatmo distinct',lastSync:null,quality:'Le bilan physique se consulte dans la branche Stations locales ; il reste distinct des prévisions de modèles'},
      {name:'Preuves de fiabilité',type:'Comparaisons qualifiées',models:[],updateFrequency:'Après qualification des observations',lastSync:learning?.lastScoreAt?new Date(learning.lastScoreAt).toISOString():null,quality:learning?.available?`${learning.scoreCount} scores quotidiens et horaires vérifiés ; apprentissage conditionné aux seuils par modèle, variable et horizon`:'Lecture des preuves indisponible'},
    ],
    forecastComparison:comparison,engineVersion:'MeteoAI · moteur original · apprentissage conditionné aux preuves',
    calculatedAt:calculatedAt?new Date(calculatedAt):null,snapshotStatus:calculatedAt?(stale?'archived':'live'):'unavailable',snapshotDate:day?.date??null,
    regimeSource:regime?.source??null,regimeSourceLabel:regime?.sourceLabel??null,regimeSourceUpdatedAt:regime?.sourceUpdatedAt??null,modelsUsed:appliedModelWeights.length,
    collectedAt:calculatedAt??hourlyComputedAt,controlCache:stale?{stale:true,cachedAt:calculatedAt??hourlyComputedAt}:undefined,
  };
}

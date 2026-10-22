import {describe,it,expect} from 'vitest';
import {buildAILabReadModel,type AILabDailyPayload} from './aiLabReadModel';
import {computeOfficialDailyForecastWithDiagnostics} from '../server/officialForecast';
import {getDailyForecastValidTime} from '../server/dailyForecastVerification';
import type {DayForecast} from '../server/weatherServices';
import {markCachedForecast} from '../client/src/lib/forecastOffline';

const now=Date.parse('2026-10-18T10:00:00Z'),date='2026-10-18',coords={lat:50.7567,lon:2.5204};
const models=[
 {serviceName:'AROME',modelId:'meteofrance_arome_france_hd',sourceName:'open-meteo',runId:'test-arome',runIdKind:'capture' as const,availableAt:now-60000,requestStartedAt:now-120000,validTime:getDailyForecastValidTime(date),tempMax:0,tempMin:-3,precipitation:0,windSpeed:10,windGust:20,humidity:80,cloudCover:60},
 {serviceName:'ICON',modelId:'dwd_icon_eu',sourceName:'open-meteo',runId:'test-icon',runIdKind:'capture' as const,availableAt:now-60000,requestStartedAt:now-120000,validTime:getDailyForecastValidTime(date),tempMax:2,tempMin:-1,precipitation:2,windSpeed:14,windGust:25,humidity:90,cloudCover:80},
];
const fusion=computeOfficialDailyForecastWithDiagnostics(models,{locationKey:'test',targetDate:date,issuedAt:now,referenceAt:now,evidenceStoreAvailable:false,evidence:[]});
const day={date,tempMax:fusion.tempMax,tempMin:fusion.tempMin,precipitation:fusion.precipitation,windSpeed:fusion.windSpeed,officialFusion:{referenceAt:new Date(now).toISOString()}} as DayForecast;
const daily:AILabDailyPayload={days:[day],modelsUsed:['AROME','ICON'],aiLabDetails:{[date]:{forecasts:models,trace:fusion.trace}}};
const hourly={officialSnapshot:{computedAt:new Date(now).toISOString(),hourlyWeighting:{modelsConsidered:['AROME','ICON'],bestMatchIncluded:false}},currentSnapshot:{sourceKind:'model_current_snapshot',source:'open-meteo',capturedAt:new Date(now-60000).toISOString(),temp:0},hours:[{date,hour:'12:00',validAt:now,temp:7,apparentTemp:6,precipitation:0,windSpeed:12}],regime:null};

describe('raccordement AI Lab au moteur original',()=>{
 it('garde les preuves horaires et leur vrai statut lorsque le quotidien est indisponible',()=>{
   const learningSummary={available:true,scoreCount:14,qualifiedDays:7,qualifiedGroups:2,lastScoreAt:now-60000,filesRejected:0};
   const data=buildAILabReadModel({...hourly,learningSummary},null,coords,now);
   expect(data.aiAnalysis).toContain('14 score(s) vérifié(s), 2 groupe(s)');
   expect(data.aiAnalysis).not.toContain('n’est pas rétablie');
   expect(data.replaySteps[6].description).toContain('par modèle, variable et horizon');
   expect(data.sources[2].quality).toContain('quotidiens et horaires');
   expect(data.officialForecast.tempMax).toBeNull();
 });
 it('projette les valeurs et les poids exacts du calcul, sans les reconstruire',()=>{
   const data=buildAILabReadModel(hourly,daily,coords,now);
   expect(data.officialForecast.tempMax).toBe(fusion.tempMax);
   expect(data.officialForecast.precipitation).toBe(fusion.precipitation);
   expect(data.trace?.parameterSources?.temperature).toEqual(fusion.trace.parameterSources.tempMax);
   expect(data.trace?.parameterSources?.wind).toEqual(fusion.trace.parameterSources.windSpeed);
   expect(data.modelsUsed).toBe(2);
   expect(data.modelDetails.find(model=>model.name==='AROME')?.tempMax).toBe(0);
   expect(data.modelDetails.find(model=>model.name==='GFS')?.tempMax).toBeNull();
   expect(data.modelAgreement.tempMax.range).toBe(2);
   expect(data.modelAgreement.commonRunVerified).toBe(false);
   expect(data).not.toHaveProperty('confidenceScore');
   expect(data).not.toHaveProperty('stabilityIndex');
 });
 it('garde les trois produits et leurs instants séparés pour les coordonnées demandées',()=>{
   const data=buildAILabReadModel(hourly,daily,{lat:48.86,lon:2.35},now);
   expect(data.forecastComparison.coordinates).toEqual({lat:48.86,lon:2.35});
   expect(data.forecastComparison.currentSnapshot?.temp).toBe(0);
   expect(data.forecastComparison.hourlyForecast.points[0].temp).toBe(7);
   expect(data.forecastComparison.dailyForecast.days[0].tempMax).toBe(fusion.tempMax);
   expect(data.forecastComparison.hourlyForecast.points[0].validAt).toBe(now);
 });
 it('n’emprunte pas le calcul de la veille à minuit Paris et conserve la série horaire disponible',()=>{
   const data=buildAILabReadModel(hourly,daily,coords,Date.parse('2026-10-18T22:30:00Z'));
   expect(data.date).toBe('2026-10-19');
   expect(data.officialForecast.tempMax).toBeNull();
   expect(data.trace).toBeNull();
   expect(data.calculatedAt).toBeNull();
   expect(data.forecastComparison.hourlyForecast.points).toHaveLength(1);
 });
 it('ne présente ni faux modèle disponible, ni fausse collecte archivée lors d’une panne partielle',()=>{
   const data=buildAILabReadModel(null,daily,coords,now);
   expect(data.forecastComparison.currentSnapshot).toBeNull();
   expect(data.forecastComparison.hourlyForecast.points).toEqual([]);
   expect(data.latestStationCollection).toBeNull();
   expect(data.appliedModelWeights.every(model=>['AROME','ICON'].includes(model.name))).toBe(true);
   const empty=buildAILabReadModel(null,null,coords,now);
   expect(empty.modelsUsed).toBe(0);expect(empty.snapshotStatus).toBe('unavailable');
   expect(empty.modelDetails.every(model=>model.averageWeight===null)).toBe(true);
 });
 it('retire le snapshot instantané en cache hors ligne et indique un calcul ancien',()=>{
   const data=buildAILabReadModel(hourly,{...daily,controlCache:{stale:true}},coords,now);
   expect(data.snapshotStatus).toBe('archived');
   const cached=markCachedForecast(data,now);
   expect(cached.forecastComparison.currentSnapshot).toBeNull();
   expect(cached.forecastComparison.hourlyForecast.points[0].temp).toBe(7);
   expect(cached.snapshotStatus).toBe('archived');
   expect(cached.controlCache.stale).toBe(true);
 });
});

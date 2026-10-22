import {describe,it,expect} from 'vitest';
import {computeOfficialHourlyForecast} from '../server/officialHourlyForecast';
import {OFFICIAL_HOURLY_MODELS,type HourlyModelForecast,type HourlyPoint} from '../server/weatherServices';
import {projectDashboardFusionTrace,selectFusionTarget} from './dashboardFusionTrace';

const validAt=Date.parse('2026-10-18T12:00:00Z');
function forecasts():HourlyModelForecast[]{
  return OFFICIAL_HOURLY_MODELS.slice(0,3).map((model,index)=>({modelName:model.name,modelId:model.modelId,sourceName:'open-meteo',availableAt:validAt-3600000,
    hours:[{validAt,hour:14,temperature:[0,10,30][index],apparentTemperature:null,precipitation:0,windSpeed:10,windDirection:350,windGusts:20,humidity:70,pressure:1010,cloudCover:20,weatherCode:2}]}));
}
function calculate(){return computeOfficialHourlyForecast(forecasts(),[],{referenceAt:validAt-1800000,historyAvailable:false,exactHistoryAvailable:false,availabilityReasonByModel:{GFS:'timeout'}});}

describe('trace Dashboard issue du moteur original',()=>{
  it('conserve la valeur finale et les poids exacts sans renormalisation ni scores inventés',()=>{
    const result=calculate(),trace=projectDashboardFusionTrace(result.hours);
    const projected=trace[0].variables.find(row=>row.key==='temperature')!;
    const original=result.hours[0].forecastWeighting!.variableWeightings.find(row=>row.variable==='temperature')!;
    expect(projected.value).toBe(result.hours[0].temp);
    expect(projected.models.map(row=>row.weight)).toEqual(original.modelWeights.map(row=>row.weight));
    expect(projected.models.find(row=>row.name==='AROME')?.value).toBe(0);
    expect(projected.status).toBe('UNCALIBRATED_ROBUST');
    expect(projected.models).not.toEqual(expect.arrayContaining([expect.objectContaining({name:'best_match'})]));
    expect(projected.excluded).toContainEqual({name:'GFS',reason:'timeout'});
  });
  it('ne transforme ni absence ni zéro de pluie en valeur simulée',()=>{
    const trace=projectDashboardFusionTrace(calculate().hours)[0];
    expect(trace.variables.find(row=>row.key==='precipitation')?.value).toBe(0);
    expect(trace.variables.find(row=>row.key==='apparent_temperature')?.value).toBeNull();
    expect(trace.variables.find(row=>row.key==='apparent_temperature')?.models).toEqual([]);
  });
  it('garde les dates absolues et sélectionne l’heure de la même prévision',()=>{
    const hour=calculate().hours[0],trace=projectDashboardFusionTrace([hour,{...hour,validAt:validAt+3600000}]);
    expect(selectFusionTarget(trace,validAt+3600000,validAt)?.validAt).toBe(validAt+3600000);
    expect(selectFusionTarget(trace,42,validAt+3600000)?.validAt).toBe(validAt+3600000);
    expect(selectFusionTarget([],null,null)).toBeNull();
  });
  it('distingue le seul modèle pluvieux d’un modèle unique disponible',()=>{
    const models=forecasts();models[0].hours[0].precipitation=0.3;
    const result=computeOfficialHourlyForecast(models,[],{referenceAt:validAt-1800000,historyAvailable:false,exactHistoryAvailable:false});
    const rain=projectDashboardFusionTrace(result.hours)[0].variables.find(row=>row.key==='precipitation')!;
    expect(rain.selection).toBe('weighted_ensemble_fallback');
    expect(rain.precipitation).toMatchObject({rainModels:1,availableModels:3,conditionalMeanMm:0.3});
    expect(rain.models.filter(model=>model.contributes)).toHaveLength(1);
    expect(rain.value).toBeCloseTo(0.1);
  });
  it('ne modifie pas le calcul et signale une ancienne prévision sans trace',()=>{
    const result=calculate(),before=JSON.stringify(result);
    projectDashboardFusionTrace(result.hours);
    expect(JSON.stringify(result)).toBe(before);
    const trace=projectDashboardFusionTrace([{...result.hours[0],forecastWeighting:undefined}]);
    expect(trace[0].variables[0].models).toEqual([]);
    expect(trace[0].variables[0].status).toBe('UNAVAILABLE');
    expect(projectDashboardFusionTrace([{validAt:NaN} as HourlyPoint])).toEqual([]);
  });
});

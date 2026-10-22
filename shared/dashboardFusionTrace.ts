import type { HourlyPoint } from '../server/weatherServices';

// Projection légère de la trace du calcul : aucun nouveau calcul de poids.
export const FUSION_FIELDS = [
  ['temperature','Température','temp','°C'],
  ['apparent_temperature','Ressenti','apparentTemp','°C'],
  ['precipitation','Précipitations','precipitation','mm'],
  ['wind_speed','Vent','windSpeed','km/h'],
  ['wind_direction','Direction du vent','windDirection','°'],
  ['wind_gust','Rafales','windGust','km/h'],
  ['humidity','Humidité','humidity','%'],
  ['pressure','Pression','pressure','hPa'],
  ['cloud_cover','Nuages','cloudCover','%'],
  ['uv_index','Indice UV','uvIndex',''],
] as const;
const finite = (value: unknown): number | null => typeof value === 'number' && Number.isFinite(value) ? value : null;
export function projectDashboardFusionTrace(hours: readonly HourlyPoint[]) {
  return hours.filter(hour => finite(hour.validAt) !== null).map(hour => ({
    validAt: hour.validAt!,
    variables: FUSION_FIELDS.map(([key,label,field,unit]) => {
      const trace=hour.forecastWeighting?.variableWeightings.find(row=>row.variable===key);
      return {key,label,unit,value:finite(hour[field]),
        precipitation:key==='precipitation'&&hour.multiModelMetrics?.precipitation?{
          rainModels:hour.multiModelMetrics.precipitation.rainModelCount,
          availableModels:hour.multiModelMetrics.precipitation.availableModelCount,
          thresholdMm:hour.multiModelMetrics.precipitation.thresholdMm,
          frequencyPercent:finite(hour.multiModelMetrics.precipitation.frequencyPercent),
          conditionalMeanMm:finite(hour.multiModelMetrics.precipitation.conditionalMeanMm),
        }:null,
        status:trace?.calibrationStatus??'UNAVAILABLE',
        selection:trace?.selectionStrategy??'unavailable',
        models:(trace?.modelWeights??[]).map(model=>({name:model.modelName,value:finite(model.value),weight:finite(model.weight),contributes:model.contributedToValue})),
        excluded:(trace?.modelReasons??[]).map(model=>({name:model.modelName,reason:model.reason})),
      };
    }),
  }));
}
export type DashboardFusionTrace = ReturnType<typeof projectDashboardFusionTrace>;
export function selectFusionTarget(points: DashboardFusionTrace, selected: number|null, preferred: number|null) {
  return points.find(point=>point.validAt===selected)??points.find(point=>point.validAt===preferred)??points[0]??null;
}

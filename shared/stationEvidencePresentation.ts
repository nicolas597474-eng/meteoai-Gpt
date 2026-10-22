import type {StationPerformanceEstimate} from '../server/stationPerformanceService';

const estimateFields = ['meanAbsoluteError', 'meanDailyAbsoluteError', 'rootMeanSquareError', 'meanBias', 'sourcePriorMeanAbsoluteError', 'shrunkMeanAbsoluteError', 'stationEvidenceWeight', 'meanReferenceDisagreement'] as const;
export function completeStationEstimate(value: any): value is StationPerformanceEstimate {
  return !!value && estimateFields.every(key => typeof value[key] === 'number' && Number.isFinite(value[key]))
    && estimateFields.filter(key => key !== 'meanBias').every(key => value[key] >= 0)
    && value.stationEvidenceWeight <= 1
    && typeof value.uncertainty95?.lower === 'number' && Number.isFinite(value.uncertainty95.lower)
    && typeof value.uncertainty95?.upper === 'number' && Number.isFinite(value.uncertainty95.upper)
    && value.uncertainty95.lower >= 0 && value.uncertainty95.upper >= value.uncertainty95.lower;
}

export function stationPerformanceVariable(result: any) {
  const measured = result?.status === 'mesuree' && completeStationEstimate(result?.estimate);
  const available = measured || (result?.status === 'non_mesuree' && result.estimate === null);
  const count = (value: unknown) => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
  return {
    available,
    estimate: measured ? result.estimate as StationPerformanceEstimate : null,
    comparisons: available ? count(result?.comparisons) : null,
    distinctDays: available ? count(result?.distinctDays) : null,
    distinctEventDays: available ? count(result?.distinctEventDays) : null,
    referenceNetworks: available && Array.isArray(result?.referenceNetworks) ? result.referenceNetworks.filter((name: unknown) => typeof name === 'string') as string[] : [],
  };
}

/** Une lecture manquante ne devient ni un zéro, ni un résultat non mesuré. */
export function stationComparisonSummary(data: any, periodDays: 1 | 7) {
  const summary = periodDays === 1 ? data?.comparisonSummary24h : data?.comparisonSummary7d;
  const selected = summary ?? (periodDays === 1 ? {deltaC: data?.instantDeltaC, validAt: data?.latestPairAt} : null);
  return selected && typeof selected.deltaC === 'number' && Number.isFinite(selected.deltaC)
    && typeof selected.validAt === 'number' && Number.isSafeInteger(selected.validAt)
    ? {deltaC: selected.deltaC, validAt: selected.validAt} : {deltaC: null, validAt: null};
}

/** Conserve le panneau pendant un changement de période, sans réutiliser un autre lieu. */
export function stationOverviewPlaceholder<T extends {center?: {lat: number; lon: number}; radiusKm?: number}>(previous: T | undefined, context: {lat: number; lon: number; radiusKm: number}): T | undefined {
  return previous?.center?.lat === context.lat && previous.center.lon === context.lon && previous.radiusKm === context.radiusKm
    ? previous : undefined;
}

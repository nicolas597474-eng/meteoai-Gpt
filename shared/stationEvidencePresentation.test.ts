import {describe, expect, it} from 'vitest';
import {completeStationEstimate, stationComparisonSummary, stationPerformanceVariable} from './stationEvidencePresentation';

export const validEstimate = {meanAbsoluteError: 0, meanDailyAbsoluteError: 0, rootMeanSquareError: 0, meanBias: 0, sourcePriorMeanAbsoluteError: 0, shrunkMeanAbsoluteError: 0, stationEvidenceWeight: 0.5, meanReferenceDisagreement: 0, uncertainty95: {lower: 0, upper: 0, method: 'hierarchical_day_block_approximation'}};

describe('présentation des preuves de Stations', () => {
  it('distingue une lecture absente d’un résultat non mesuré à zéro comparaison', () => {
    expect(stationPerformanceVariable(null)).toMatchObject({available: false, comparisons: null, distinctDays: null, estimate: null});
    expect(stationPerformanceVariable({status: 'non_mesuree', estimate: null, comparisons: 0, distinctDays: 0})).toMatchObject({available: true, comparisons: 0, distinctDays: 0});
    expect(stationPerformanceVariable({status: 'non_mesuree', estimate: null})).toMatchObject({available: true, comparisons: null, distinctDays: null});
  });

  it('n’affiche une estimation que si tous ses champs numériques sont exploitables', () => {
    expect(completeStationEstimate(validEstimate)).toBe(true);
    expect(completeStationEstimate({...validEstimate, meanBias: -2})).toBe(true);
    for (const estimate of [{}, {...validEstimate, uncertainty95: null}, {...validEstimate, rootMeanSquareError: NaN}, {...validEstimate, meanAbsoluteError: -1}, {...validEstimate, stationEvidenceWeight: 1.1}, {...validEstimate, uncertainty95: {lower: 2, upper: 1}}]) {
      const state = stationPerformanceVariable({status: 'mesuree', estimate, comparisons: 30, distinctDays: 7});
      expect(state.available).toBe(false); expect(state.estimate).toBeNull(); expect(state.comparisons).toBeNull();
    }
    expect(stationPerformanceVariable({status: 'mesuree', estimate: validEstimate, comparisons: 30, distinctDays: 7}).estimate).toBe(validEstimate);
  });

  it('rejette les compteurs impossibles et conserve les réseaux textuels', () => {
    const state = stationPerformanceVariable({status: 'non_mesuree', estimate: null, comparisons: -1, distinctDays: NaN, distinctEventDays: 1.5, referenceNetworks: ['netatmo', null, 1]});
    expect(state.comparisons).toBeNull(); expect(state.distinctDays).toBeNull(); expect(state.distinctEventDays).toBeNull(); expect(state.referenceNetworks).toEqual(['netatmo']);
  });

  it('sélectionne le dernier créneau de la période et conserve un écart nul', () => {
    const old = Date.parse('2026-10-18T08:00:00Z'), recent = Date.parse('2026-10-20T08:00:00Z');
    const data = {comparisonSummary24h: {deltaC: null, validAt: null}, comparisonSummary7d: {deltaC: -2, validAt: old}};
    expect(stationComparisonSummary(data, 1)).toEqual({deltaC: null, validAt: null});
    expect(stationComparisonSummary(data, 7)).toEqual({deltaC: -2, validAt: old});
    expect(stationComparisonSummary({...data, comparisonSummary24h: {deltaC: 0, validAt: recent}}, 1)).toEqual({deltaC: 0, validAt: recent});
    expect(stationComparisonSummary({instantDeltaC: 0, latestPairAt: recent}, 1)).toEqual({deltaC: 0, validAt: recent});
    expect(stationComparisonSummary({instantDeltaC: 1, latestPairAt: recent}, 7)).toEqual({deltaC: null, validAt: null});
  });

  it('ne fabrique pas un écart ou un instant à partir de champs manquants', () => {
    for (const summary of [{deltaC: NaN, validAt: 1}, {deltaC: 0, validAt: null}, {deltaC: null, validAt: 1}, {deltaC: 1, validAt: '2026-10-20'}, {deltaC: 1, validAt: Infinity}]) expect(stationComparisonSummary({comparisonSummary7d: summary}, 7)).toEqual({deltaC: null, validAt: null});
  });
});

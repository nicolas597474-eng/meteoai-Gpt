import {afterEach, describe, expect, it, vi} from 'vitest';
import {getCurrentStationRankingContract} from './currentStationRankingContract';
import {mapBridgeStations} from './currentStationAdapter';
import {buildStationSearchReadModel} from './stationSearchReadModel';
import {getStationRankingComponents, getStationRankingScore} from '../server/stationRankingScore';

const now = Date.parse('2026-10-20T08:00:00Z');
const coords = {lat: 50.7567, lon: 2.5204, radiusKm: 50};
const row = (id: string, age: number, lat = 50.7667) => ({id: `netatmo-${id}`, name: id, lat, lon: coords.lon, temp: 10, time: now - age * 60000, anomaly: false});
afterEach(() => vi.useRealTimers());

describe('critères du répertoire Stations publié', () => {
  it('décrit les métadonnées du pont actif, sans annoncer une autre source physique', () => {
    const contract = getCurrentStationRankingContract();
    const station = mapBridgeStations([row('test', 10)], coords.lat, coords.lon, 50)[0];
    expect(contract.sources).toEqual([{id: 'netatmo', name: 'Netatmo', sourcePriorityScore: station.reliabilityScore, updateFreqMin: station.updateFrequencyMin, estimatedAvailability: station.dataAvailability}]);
    expect(contract.sources[0].sourcePriorityScore).toBe(72);
    expect(contract).not.toHaveProperty('stationPerformance.historyWindowDays');
    expect(contract.ordering).toContain('ni des probabilités');
  });

  it('reproduit le score réel et distingue son seuil de distance du rayon demandé', () => {
    const contract = getCurrentStationRankingContract();
    const station = mapBridgeStations([row('test', 15)], coords.lat, coords.lon, 50)[0];
    const components = getStationRankingComponents(station, now);
    const weights = contract.rankingScore.componentWeights;
    const projected = weights.distance * components.distanceScore + weights.quality * components.qualityScore + weights.availability * components.availabilityScore + weights.freshness * components.freshnessScore;
    expect(projected).toBeCloseTo(getStationRankingScore(station, now), 12);
    expect(contract.criteria.map(c => c.weight)).toEqual([40, 30, 20, 10]);
    expect(contract.rankingScore.isProbability).toBe(false);
    vi.useFakeTimers().setSystemTime(now);
    const far = buildStationSearchReadModel(coords, {rows: [row('loin', 10, 51.12)]}).stations[0];
    expect(far.distanceKm).toBeGreaterThan(contract.rankingScore.distanceCutoffKm);
    expect(far.isActive).toBe(true);
    expect(getStationRankingComponents(far, now).distanceScore).toBe(0);
  });

  it('conserve les filtres réels à 90 minutes, distincts du score sur 180 minutes', () => {
    vi.useFakeTimers().setSystemTime(now);
    const contract = getCurrentStationRankingContract();
    const data = buildStationSearchReadModel(coords, {rows: [row('limite', 90), row('ancien', 90.01), row('futur', -1), {...row('anomalie', 10), anomaly: true}]});
    expect(data.stations.filter(s => s.isActive).map(s => s.name)).toEqual(['limite']);
    expect(contract.selection.maximumMeasurementAgeMinutes).toBe(90);
    expect(contract.rankingScore.freshnessCutoffMinutes).toBe(180);
    expect(contract.criteria[3].description).toContain('90 minutes');
    expect(getStationRankingComponents(data.stations[0], now).freshnessScore).toBe(0.5);
  });

  it('présente les stations actives avant les écartées même si leur score technique est inférieur', () => {
    vi.useFakeTimers().setSystemTime(now);
    const data = buildStationSearchReadModel(coords, {rows: [row('loin', 10, 51.12), {...row('proche', 1), anomaly: true}]});
    expect(data.stations.map(s => s.name)).toEqual(['loin', 'proche']);
    expect(getStationRankingScore(data.stations[1], now)).toBeGreaterThan(getStationRankingScore(data.stations[0], now));
    expect(getCurrentStationRankingContract().selection.activeFirst).toBe(true);
  });
});

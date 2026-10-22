import {describe, expect, it, vi} from 'vitest';
import {formatSourceNumber, formatSourceTimestamp, resolveSourceSelection, sourceDetailContribution, sourceSelectionKey} from './stationSourceDetails';
import {buildStationSearchReadModel} from './stationSearchReadModel';

describe('détails de source synchronisés', () => {
  const context = '[50.7567,2.5204,20]';
  const original = {stationId: 'netatmo-a', name: 'Station A', temperature: 10};

  it('retrouve le nouveau relevé entier sans conserver celui du clic initial', () => {
    const key = sourceSelectionKey(original, 'station', context);
    const refreshed = {...original, temperature: 0, humidity: null};
    const selection = resolveSourceSelection(key, [refreshed], [], context);
    expect(selection?.source).toBe(refreshed);
    expect(selection?.source.temperature).toBe(0);
    expect(key).not.toHaveProperty('source');
    expect(resolveSourceSelection(key, [], [], context)).toBeNull();
  });

  it('ferme les détails au changement de lieu ou rayon et sépare stations et modèles', () => {
    const key = sourceSelectionKey(original, 'station', context);
    expect(resolveSourceSelection(key, [original], [], '[50.7567,2.5204,50]')).toBeNull();
    expect(resolveSourceSelection(key, [original], [], '[48.8,2.3,20]')).toBeNull();
    expect(resolveSourceSelection(key, [], [{id: 'netatmo-a'}], context)).toBeNull();
    expect(sourceSelectionKey({}, 'station', context)).toBeNull();
    const model = {id: 'arome', temperature: 3};
    expect(resolveSourceSelection(sourceSelectionKey(model, 'model', context), [], [model], context)?.source).toBe(model);
  });

  it('ne propage pas le poids température aux autres mesures', () => {
    const contribution = {stationId: 'netatmo-a', weight: 0.6, fieldWeights: {temperature: 0.6, humidity: 1}};
    const detail = sourceDetailContribution({kind: 'station', source: original}, {stationsUsed: [contribution]});
    expect(detail.fieldWeights).toEqual([{field: 'temperature', label: 'Température', weight: 0.6}, {field: 'humidity', label: 'Humidité', weight: 1}]);
    expect(detail.temperatureUsed).toBe(true);
    const humidityOnly = sourceDetailContribution({kind: 'station', source: original}, {stationsUsed: [{...contribution, weight: 0, fieldWeights: {humidity: 1}}]});
    expect(humidityOnly.temperatureUsed).toBe(false);
    expect(humidityOnly.fieldWeights.map(f => f.field)).toEqual(['humidity']);
  });

  it('respecte une vraie contribution humidité quand le noyau local écarte la température', () => {
    const now = Date.parse('2026-10-20T08:00:00Z');
    vi.useFakeTimers().setSystemTime(now);
    try {
      const coords = {lat: 50.7567, lon: 2.5204, radiusKm: 20};
      const rows = [0, 0, 20].map((temp, i) => ({id: `netatmo-${i}`, name: `Station ${i}`, lat: coords.lat + 0.001 * (i + 1), lon: coords.lon, temp, humidity: 70, time: now - 120000, anomaly: false}));
      const model = buildStationSearchReadModel(coords, {rows});
      const station = model.stations.find(row => row.stationId === 'netatmo-2');
      const detail = sourceDetailContribution({kind: 'station', source: station}, model.groundTruth);
      expect(detail.contribution).not.toBeNull();
      expect(detail.temperatureUsed).toBe(false);
      expect(detail.fieldWeights.map(row => row.field)).toEqual(['humidity']);
      expect(detail.fieldWeights[0].weight).toBeGreaterThan(0);
    } finally { vi.useRealTimers(); }
  });

  it('ne prête aucune contribution à une source écartée ou un modèle et garde le motif réel', () => {
    const groundTruth = {stationsUsed: [{stationId: 'netatmo-a', weight: 0.5}], stationsIgnored: [{stationId: 'autre', reason: 'Hors rayon local'}]};
    const excluded = sourceDetailContribution({kind: 'station', source: {...original, isActive: false, exclusionReason: 'Horodatage futur'}}, groundTruth);
    expect(excluded.contribution).toBeNull();
    expect(excluded.exclusionReason).toBe('Horodatage futur');
    expect(excluded.fieldWeights).toEqual([]);
    expect(sourceDetailContribution({kind: 'model', source: original}, groundTruth).contribution).toBeNull();
    expect(sourceDetailContribution({kind: 'station', source: {stationId: 'autre'}}, groundTruth).exclusionReason).toBe('Hors rayon local');
  });

  it('refuse les poids invalides sans convertir une absence en zéro', () => {
    const detail = sourceDetailContribution({kind: 'station', source: original}, {stationsUsed: [{stationId: 'netatmo-a', weight: 0.5, fieldWeights: {temperature: NaN, humidity: 2, pressure: -1, windSpeed: '0.5', windGust: null}}]});
    expect(detail.fieldWeights).toEqual([]);
    expect(detail.temperatureUsed).toBe(false);
    expect(formatSourceNumber(0, ' °C')).toBe('0.0 °C');
    for (const value of [null, undefined, NaN, Infinity, '', '4']) expect(formatSourceNumber(value)).toBe('—');
  });

  it('affiche les instants en heure de Paris et gère les dates absentes ou invalides', () => {
    expect(formatSourceTimestamp('2026-10-20T08:00:00Z')).toContain('10:00');
    expect(formatSourceTimestamp('2026-12-20T08:00:00Z')).toContain('09:00');
    for (const value of [null, undefined, '', 'invalid']) expect(formatSourceTimestamp(value)).toBe('—');
  });
});

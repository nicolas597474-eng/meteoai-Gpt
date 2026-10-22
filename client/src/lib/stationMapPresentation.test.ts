import {describe, expect, it} from 'vitest';
import {stationArchiveSummary, stationFreshness, stationInfoHtml, stationMarkerColor, stationPopupWidth, stationPopupHeight, stationTooltipHtml, type StationMarker} from './stationMapPresentation';

const station: StationMarker = {stationId: 'netatmo-test', name: 'Station test', lat: 50, lon: 2, distanceKm: 1, ageMinutes: 10, source: 'netatmo', sourceKind: 'physical', reliabilityScore: 72, isActive: true, isUsed: true, archivedReadingCount: null, latest: {temperature: 0, humidity: 0}};

describe('présentation des marqueurs de Stations', () => {
  it('réserve le vert aux contributions connues, actives et horodatées', () => {
    expect(stationMarkerColor(station)).toBe('#34d399');
    for (const extra of [{isUsed: false}, {isUsed: undefined}, {isActive: false}, {ageMinutes: null}, {ageMinutes: -1}, {ageMinutes: NaN}, {ageMinutes: Infinity}]) {
      expect(stationMarkerColor({...station, ...extra})).toBe('#fbbf24');
    }
    // Le marqueur décrit la participation au dernier cycle, pas une tranche d'âge.
    expect(stationMarkerColor({...station, ageMinutes: 91})).toBe('#34d399');
    const nearby = stationInfoHtml({...station, isUsed: false, exclusionReason: 'Température écartée par les contrôles'});
    expect(nearby).toContain('Non utilisée dans la synthèse locale');
    expect(nearby).toContain('Température écartée par les contrôles');
    expect(nearby).toContain('Il y a 10 min');
  });

  it('échappe le texte fournisseur dans les fenêtres ET les infobulles Leaflet', () => {
    const hostile = {...station, name: '<img src=x onerror="alert(1)"> & "test"', source: '<b>Netatmo</b>', exclusionReason: '<script>alert(1)</script>'};
    const popup = stationInfoHtml(hostile), tooltip = stationTooltipHtml(hostile);
    for (const html of [popup, tooltip]) {
      expect(html).not.toContain('<img'); expect(html).not.toContain('<script');
      expect(html).toContain('&lt;img'); expect(html).toContain('&amp;');
    }
    expect(popup).toContain('&lt;b&gt;Netatmo&lt;/b&gt;');
    expect(popup).toContain('&lt;script&gt;');
  });

  it('préserve zéro et distingue une archive inconnue d’un compteur vérifié nul', () => {
    const html = stationInfoHtml(station);
    expect(html).toContain('0.0 °C'); expect(html).toContain('0 %');
    expect(html).toContain('Historique non disponible pour cette consultation');
    expect(html).not.toContain('0 relevé');
    expect(stationInfoHtml({...station, archivedReadingCount: 0})).toContain('0 relevé(s) vérifié(s) dans les archives consultées');
    expect(stationInfoHtml({...station, archivedReadingCount: 12})).toContain('12 relevé(s) vérifié(s) dans les archives consultées');
    for (const count of [undefined, null, -1, NaN, Infinity, '0', 1.5]) expect(stationArchiveSummary(count)).toContain('non disponible');
  });

  it('adapte la largeur utile au conteneur de carte mobile', () => {
    for (const viewport of [320, 390, 430]) {
      const mapWidth = viewport - 58;
      expect(stationPopupWidth(mapWidth) + 56).toBeLessThanOrEqual(mapWidth);
    }
    expect(stationPopupWidth(800)).toBe(280);
    expect(stationPopupWidth(NaN)).toBe(160);
    expect(stationPopupHeight(288) + 72).toBe(288);
    expect(stationPopupHeight(800)).toBe(560);
    expect(stationPopupHeight(NaN)).toBe(200);
    expect(stationInfoHtml(station)).not.toContain('min-width:248px');
    expect(stationInfoHtml(station)).toContain('overflow-wrap:anywhere');
  });

  it('ne rend pas NaN, Infinity ou une date invalide comme des valeurs fraîches', () => {
    for (const age of [-1, NaN, Infinity, null]) expect(stationFreshness(age).label).toBe('Horodatage indisponible');
    const html = stationInfoHtml({...station, reliabilityScore: NaN, ageMinutes: Infinity, distanceKm: NaN, latest: {temperature: NaN, humidity: Infinity}});
    expect(html).not.toContain('NaN'); expect(html).not.toContain('Infinity');
    expect(html).toContain('Horodatage indisponible'); expect(html).toContain('—');
  });
});

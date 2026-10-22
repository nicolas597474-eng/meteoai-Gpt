import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {describe, expect, it} from 'vitest';
import {SourceDetailsContent} from './SourceDetailsDialog';
import {resolveSourceSelection, sourceSelectionKey} from '@shared/stationSourceDetails';

const source = {stationId: 'netatmo-a', name: 'Station A', temperature: 0, humidity: 0, updatedAt: '2026-10-20T08:00:00Z', isActive: true};
function render(station = source, groundTruth: any = {}, kind: 'station'|'model' = 'station') {
  return renderToStaticMarkup(createElement(SourceDetailsContent, {selection: {kind, source: station}, groundTruth}));
}

describe('contenu réel de la fenêtre de source', () => {
  it('affiche zéro et les contributions température/humidité distinctes, sans poids global', () => {
    const html = render(source, {stationsUsed: [{stationId: source.stationId, weight: 0.6, fieldWeights: {temperature: 0.6, humidity: 1}, distanceWeight: 1, qualityWeight: 0.72, freshnessWeight: 0.8}]});
    expect(html).toContain('0.0 °C'); expect(html).toContain('0 %');
    expect(html).toContain('Poids température'); expect(html).toContain('60.0 %');
    expect(html).toContain('Poids humidité'); expect(html).toContain('100.0 %');
    expect(html).not.toContain('poids final'); expect(html).not.toContain('Poids pression');
    expect(html).toContain('Température relevée (Paris)'); expect(html).toContain('10:00');
  });

  it('n’affiche pas de décomposition température pour une contribution humidité seulement', () => {
    const html = render({...source, temperature: null} as any, {stationsUsed: [{stationId: source.stationId, weight: 0, fieldWeights: {humidity: 1}}]});
    expect(html).toContain('Poids humidité');
    expect(html).not.toContain('Poids température');
    expect(html).not.toContain('Composantes techniques de la température');
    expect(html).not.toContain('NaN');
  });

  it('rend le relevé renouvelé et le motif d’exclusion sans ancien poids ni champ greffé', () => {
    const initial = {...source, temperature: 10, pressure: 1000};
    const current = {...source, isActive: false, exclusionReason: 'Mesure de plus de 90 minutes'};
    const selection = resolveSourceSelection(sourceSelectionKey(initial, 'station', 'lieu'), [current], [], 'lieu');
    const html = renderToStaticMarkup(createElement(SourceDetailsContent, {selection, groundTruth: {stationsUsed: [{stationId: source.stationId, weight: 1}]}}));
    expect(html).toContain('0.0 °C'); expect(html).not.toContain('10.0 °C');
    expect(html).not.toContain('1000 hPa'); expect(html).not.toContain('Décomposition');
    expect(html).toContain('Mesure de plus de 90 minutes');
  });

  it('garde les modèles à contribution locale nulle et évite les dates et valeurs invalides', () => {
    const html = render({...source, updatedAt: 'invalid', temperature: NaN, coherenceWeight: Infinity} as any, {}, 'model');
    expect(html).toContain('poids de fusion locale 0 %');
    expect(html).not.toContain('NaN'); expect(html).not.toContain('Invalid Date');
    expect(html).not.toContain('Infinity'); expect(html).not.toContain('Décomposition');
  });
  it('affiche les heures des capteurs et distingue réception et échéance des modèles',()=>{
    const station=render({...source,windSpeed:12,measurementTimes:{windSpeed:'2026-10-20T07:57:00Z'}} as any);
    expect(station).toContain('Vent (Paris)');expect(station).toContain('09:57');
    const model=render({...source,collectedAt:'2026-10-20T08:14:00Z'} as any,{},'model');
    expect(model).toContain('Échéance (Paris)');expect(model).toContain('Reçu (Paris)');expect(model).toContain('10:14');expect(model).toContain('Prévisions brutes');
  });
});

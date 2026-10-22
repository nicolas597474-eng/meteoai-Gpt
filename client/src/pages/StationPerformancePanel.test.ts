import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {describe, expect, it} from 'vitest';
import {StationPerformancePanel} from './Ranking';

const render = (performance: any, windowDays: number | null = 7) => renderToStaticMarkup(createElement(StationPerformancePanel, {performance, windowDays}));
describe('performance individuelle dans Stations', () => {
  it('ne transforme pas une lecture indisponible en zéro comparaison ou fenêtre de 30 jours', () => {
    const html = render(null, null);
    expect(html).toContain('Performance individuelle indisponible');
    expect(html).toContain('Fenêtre historique non renseignée');
    expect(html).not.toContain('0 comparaison'); expect(html).not.toContain('0 jour'); expect(html).not.toContain('30 jours');
  });
  it('conserve les vrais résultats non mesurés et leurs compteurs nuls', () => {
    const html = render({variables: {temperature: {status: 'non_mesuree', estimate: null, reason: 'distinct_reference_networks_insufficient', comparisons: 0, distinctDays: 0, referenceNetworks: []}}});
    expect(html).toContain('Performance individuelle non mesurée'); expect(html).toContain('0 comparaison(s), 0 jour(s)');
    expect(html).toContain('moins de deux réseaux physiques distincts'); expect(html).toContain('Fenêtre glissante de 7 jours');
  });
  it('affiche une estimation incomplète comme indisponible sans erreur de rendu', () => {
    const html = render({variables: {temperature: {status: 'mesuree', estimate: {meanAbsoluteError: NaN}, comparisons: 99, distinctDays: 10}}});
    expect(html).toContain('Performance individuelle indisponible'); expect(html).not.toContain('NaN'); expect(html).not.toContain('Mesurée pour'); expect(html).not.toContain('99 comparaison');
  });
});

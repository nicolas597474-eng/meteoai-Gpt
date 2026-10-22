import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {expect,it} from 'vitest';
import {StationSummaryReadings} from './Ranking';
it('rend les vraies mesures et leur couverture propre, dont zéro pluie, dans la grille mobile',()=>{
 const groundTruth={temperature:10,humidity:92,pressure:1022.4,windSpeed:12,windGust:null,precipitation:0,stationsUsed:[{stationId:'a',fieldWeights:{temperature:1,humidity:1,pressure:1,windSpeed:1,precipitation:1},measurementTimes:{temperature:'2026-10-20T09:07:00Z',windSpeed:'2026-10-20T09:05:00Z',pressure:'2026-10-20T09:06:00Z',precipitation:'2026-10-20T09:04:00Z'}}]};
 const html=renderToStaticMarkup(createElement(StationSummaryReadings,{groundTruth}));
 expect(html).toContain('grid-cols-3');expect(html).toContain('1022 hPa');expect(html).toContain('12.0 km/h');expect(html).toContain('0.0 mm');expect(html).toContain('Netatmo · 1 station');expect(html).toContain('11:05');expect(html).toContain('Aucune mesure admissible');expect(html).not.toContain('NaN');
});

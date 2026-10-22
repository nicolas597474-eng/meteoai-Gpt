import {afterAll,describe,it,expect,vi} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import {createElement} from 'react';
import * as React from 'react';
import {HourlyComparisonDiagnosticsPanel} from './HourlyComparisonDiagnosticsPanel';
const response=vi.hoisted(()=>({data:null as any,isLoading:false,error:null as any}));
vi.mock('@/lib/trpc',()=>({trpc:{weather:{getHourlyComparisonDiagnostics:{useQuery:()=>response}}}}));
vi.stubGlobal('React',React);
afterAll(()=>vi.unstubAllGlobals());
describe('panneau AI Lab des comparaisons exploratoires',()=>{
 it('affiche les vraies étapes du scoreur sans les présenter comme un cycle ou une qualification quotidienne',()=>{
  response.data={kind:'exploratory_archive_read',scope:'hondeghem',capturedAt:'2026-10-19T03:00:00Z',cycleDate:'7 jours',summary:{measurements:3,physicalFiles:1,rejectedPhysicalFiles:0,forecastFiles:1,rejectedForecastFiles:0,searchedHours:1,observedHours:1,unmatchedHours:0,referenceHours:1,comparisons:1,boundedRead:false},diagnostics:[{path:'ordinary_hourly',variable:'temperature',archivedForecasts:1,opportunitiesAtSameLocationAndValidTime:1,qualifiedPhysicalObservationsPresent:1,temporallyAdmissible:1,admissiblePairs:1,retainedComparisons:1,firstRejectionCounts:{},temporalRule:'availableAt < validTime'}]};
  const html=renderToStaticMarkup(createElement(HourlyComparisonDiagnosticsPanel,{location:{lat:50.7567,lon:2.5204}}));
  expect(html).toContain('Référence locale exploratoire');expect(html).toContain('Retenues en lecture exploratoire');expect(html).not.toContain('Observation physique qualifiée');expect(html).toContain('Ce contrôle ne lance aucune collecte');expect(html).toContain('Ces écarts ne qualifient aucune journée');
 });
 it('un autre lieu ou une erreur ne devient pas une comparaison réussie',()=>{
  response.data={kind:'exploratory_archive_read',scope:'not_covered',capturedAt:'2026-10-19T03:00:00Z',cycleDate:'7 jours',diagnostics:[],summary:null};
  let html=renderToStaticMarkup(createElement(HourlyComparisonDiagnosticsPanel,{location:{lat:48.86,lon:2.35}}));expect(html).toContain('uniquement Hondeghem');expect(html).not.toContain('Paires comparables');
  response.error=Error('Indisponible');html=renderToStaticMarkup(createElement(HourlyComparisonDiagnosticsPanel,{location:undefined}));expect(html).toContain('momentanément indisponible');expect(html).not.toContain('relevé(s) vérifié(s)');response.error=null;response.data=null;
 });
});

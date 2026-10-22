import {afterAll,describe,it,expect,vi} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import * as React from 'react';
import {HourlyJournalPanel} from './HourlyJournalPanel';
vi.stubGlobal('React',React);afterAll(()=>vi.unstubAllGlobals());
describe('journal horaire restauré',()=>{
 it('conserve filtres et état reçu sans inventer une confirmation des écritures',()=>{
  const entry={model:'AROME',modelId:'meteofrance_arome_france_hd',isOfficialModel:true,status:'succeeded' as const,requestAttempts:1,hoursReceived:48,valuesReceived:960,expectedValueCount:960,archiveRowsWritten:null,projectionRowsWritten:null,errorCode:null,attemptedAt:Date.now()-1000,completedAt:Date.now()};
  const html=renderToStaticMarkup(React.createElement(HourlyJournalPanel,{expectedModels:['AROME'],entries:[entry],available:true,onOpenModel:()=>{}}));
  expect(html).toContain('non confirmée');expect(html).toContain('Collecte à la consultation');expect(html).toContain('Filtrer les journaux horaires');expect(html).toContain('Disponible');expect(html).not.toContain('archive 0');
 });
});

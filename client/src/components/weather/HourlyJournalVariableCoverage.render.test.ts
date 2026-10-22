import {afterAll,describe,it,expect,vi} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import * as React from 'react';
import {HourlyJournalVariableCoverage} from './HourlyJournalVariableCoverage';
import type {HourlyJournalEntry} from '@/lib/hourlyJournalFilter';
vi.stubGlobal('React',React);afterAll(()=>vi.unstubAllGlobals());
const entry:HourlyJournalEntry={model:'AROME',modelId:'meteofrance_arome_france_hd',isOfficialModel:true,status:'partial',requestAttempts:1,hoursReceived:48,expectedHoursCount:48,valuesReceived:48,expectedValueCount:960,archiveRowsWritten:null,projectionRowsWritten:null,errorCode:null,attemptedAt:1,completedAt:2};
describe('couverture du journal reçu',()=>{
 it('explique les valeurs nulles du fournisseur sans inventer un zéro ou une écriture',()=>{
  const html=renderToStaticMarkup(React.createElement(HourlyJournalVariableCoverage,{entry:{...entry,variableSummary:[{key:'temperature',receivedCount:48,expectedCount:48,providerNullCount:0},{key:'surface_pressure',receivedCount:0,expectedCount:48,providerNullCount:48}]}}));
  expect(html).toContain('Température');expect(html).toContain('Pression');expect(html).toContain('48 nulles chez le fournisseur');expect(html).toContain('pas la confirmation de son archivage');
 });
 it('ne déduit pas les champs de l’ancien journal agrégé',()=>{
  const html=renderToStaticMarkup(React.createElement(HourlyJournalVariableCoverage,{entry}));
  expect(html).toContain('n’a pas été conservé');expect(html).not.toContain('Pression');
 });
});

import {afterAll,describe,it,expect,vi} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import * as React from 'react';
import {DailyPhysicalCoverage,physicalEvidenceStep} from './DailyPhysicalCoverage';
import type {DailyPhysicalEvidence} from '@shared/dailyPhysicalEvidence';
vi.stubGlobal('React',React);afterAll(()=>vi.unstubAllGlobals());
const data:DailyPhysicalEvidence={scope:'hondeghem',windowDays:7,timeZone:'Europe/Paris',requiredCoverageHours:18,filesChecked:2,filesRejected:0,filesLimit:24,boundedRead:false,measurementsVerified:3,days:[],officialEvidence:'not_migrated',calibration:'not_active'};
describe('provenance physique côté serveur',()=>{
 it('distingue un apprentissage configuré sans score d’un groupe effectivement admissible',()=>{
  const learning={version:1 as const,scope:'hondeghem' as const,available:true,revision:'test',qualifiedDays:0,scoreCount:0,lastScoreAt:null,lastDay:null,lastCoverageHours:null,lastDayCreatedAt:null,filesRejected:0,boundedRead:false,forecastCount:1,collection:{status:'ok',attemptedAt:Date.now()},qualifiedGroups:0,dailyQualifiedGroups:0,hourlyQualifiedGroups:0,providerRunCount:0};
  const waiting=renderToStaticMarkup(React.createElement(DailyPhysicalCoverage,{data:{...data,learning}}));expect(waiting).toContain('en attente de preuves suffisantes');expect(waiting).toContain('Aucun poids historique');expect(waiting).toContain('30 dates');expect(waiting).toContain('7 dates');
  const ready=renderToStaticMarkup(React.createElement(DailyPhysicalCoverage,{data:{...data,learning:{...learning,scoreCount:120,qualifiedDays:30,qualifiedGroups:4,dailyQualifiedGroups:4}}}));expect(ready).toContain('4 groupe(s)');expect(ready).not.toContain('Aucun poids historique');
  const partial=renderToStaticMarkup(React.createElement(DailyPhysicalCoverage,{data:{...data,learning:{...learning,qualification:{attemptedAt:Date.now(),rejectedDays:2,pendingDays:2}}}}));expect(partial).toContain('2 journée(s) en échec');expect(partial).toContain('Les autres journées continuent');expect(waiting).not.toContain('journée(s) en échec');
  const fallback=renderToStaticMarkup(React.createElement(DailyPhysicalCoverage,{data:{...data,learning:{...learning,collection:{status:'ok',attemptedAt:Date.now(),mode:'verified_hourly_cycles',models:['AROME','ARPEGE','ICON','ECMWF'],dates:['2026-10-20'],forecastApiStatus:429}}}}));expect(fallback).toContain('4/7 modèles archivés');expect(fallback).toContain('journées futures entièrement couvertes');expect(fallback).toContain('2026-10-20');expect(fallback).not.toContain('dernier essai serveur en échec');
  expect(physicalEvidenceStep({...data,learning:{...learning,scoreCount:120,qualifiedDays:30,qualifiedGroups:4}})).toEqual({summary:expect.stringContaining('30 journée(s) physique(s) qualifiée(s), 120 score(s)'),status:'complete'});
  const unavailableQuota=renderToStaticMarkup(React.createElement(DailyPhysicalCoverage,{data:{...data,learning:{...learning,providerRateLimitsAvailable:false,scoreCount:4,qualifiedDays:1}}}));
  expect(unavailableQuota).toContain('Le journal des quotas est partiellement indisponible');expect(unavailableQuota).toContain('4 score(s)');expect(unavailableQuota).toContain('aucun appel fournisseur n’est autorisé sans contrôle');
  expect(waiting).not.toContain('journal des quotas est partiellement indisponible');
 });

 it('sépare les anciennes mesures des réceptions serveur sans activer la calibration',()=>{
  const serverMeasurements={status:'verified' as const,source:'netatmo_server' as const,filesChecked:1,filesRejected:0,filesLimit:48 as const,boundedRead:false,conflictingMeasurements:0,measurementsVerified:9,lastReceivedAt:Date.now(),days:[]};
  const html=renderToStaticMarkup(React.createElement(DailyPhysicalCoverage,{data:{...data,serverMeasurements}}));
  expect(html).toContain('3');expect(html).toContain('9');expect(html).toContain('Réceptions Netatmo côté serveur');expect(html).toContain('La provenance serveur ne suffit pas');expect(html).toContain('anciennes archives navigateur');
 });
 it('ne remplace pas un échec de lecture par un compteur nul',()=>{
  const serverMeasurements={status:'unavailable' as const,source:'netatmo_server' as const,filesChecked:0,filesRejected:0,filesLimit:48 as const,boundedRead:false,conflictingMeasurements:0,measurementsVerified:0,lastReceivedAt:null,days:[]};
  const html=renderToStaticMarkup(React.createElement(DailyPhysicalCoverage,{data:{...data,serverMeasurements}}));expect(html).toContain('contrôle des nouveaux lots serveur est indisponible');expect(html).not.toContain('0 mesure(s) distincte(s)');
 });
 it('affiche une référence enregistrée sans la présenter comme un score qualifié',()=>{
  const serverReferences={status:'verified' as const,referenceCount:1,filesChecked:1,filesRejected:0,filesLimit:48 as const,boundedRead:false,lastCreatedAt:Date.now(),days:[{date:'2026-10-19',hours:[5],coverageHours:1,closedDay:false,thresholdMet:false}],temperatureOnly:true as const,calibration:'not_active' as const};
  const html=renderToStaticMarkup(React.createElement(DailyPhysicalCoverage,{data:{...data,serverReferences}}));expect(html).toContain('Références horaires physiques enregistrées');expect(html).toContain('05 h');expect(html).toContain('aucune calibration');expect(html).not.toContain('seuil de couverture atteint');
  expect(physicalEvidenceStep({...data,serverReferences}).summary).toContain('heures serveur enregistrées et vérifiées');
  expect(physicalEvidenceStep({...data,serverReferences},true).summary).toContain('n’a pas pu être vérifiée');
 });
});

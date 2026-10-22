import {afterAll,describe,it,expect,vi} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import * as React from 'react';
import {DailyPhysicalCoverage} from './DailyPhysicalCoverage';
import type {DailyPhysicalEvidence} from '@shared/dailyPhysicalEvidence';
vi.stubGlobal('React',React);afterAll(()=>vi.unstubAllGlobals());
const evidence:DailyPhysicalEvidence={scope:'hondeghem',windowDays:7,timeZone:'Europe/Paris',requiredCoverageHours:18,filesChecked:18,filesRejected:0,filesLimit:24,boundedRead:false,measurementsVerified:54,days:[{date:'2026-10-17',measuredHours:18,usableHours:18,hours:Array.from({length:18},(_,i)=>i),pendingHours:0,ambiguousHours:0,closedDay:true,thresholdMet:true}],officialEvidence:'not_migrated',calibration:'not_active'};
describe('couverture par date dans la preuve AI Lab',()=>{
 it('un seuil atteint ne devient pas une qualification officielle ou un nombre de scores inventé',()=>{
  const html=renderToStaticMarkup(React.createElement(DailyPhysicalCoverage,{data:evidence}));
  expect(html).toContain('18/18 heures exploitables');expect(html).toContain('Seuil de couverture candidat atteint ; archive navigateur exclue de la calibration');expect(html).toContain('Aucun compteur nul ne remplace cet échec');expect(html).not.toContain('0 score');
 });
 it('distingue une erreur, un lieu non couvert et une lecture partielle',()=>{
  const error=renderToStaticMarkup(React.createElement(DailyPhysicalCoverage,{data:undefined,error:true}));expect(error).toContain('a échoué');expect(error).not.toContain('0 relevé');
  const other=renderToStaticMarkup(React.createElement(DailyPhysicalCoverage,{data:{...evidence,scope:'not_covered'}}));expect(other).toContain('uniquement Hondeghem');expect(other).not.toContain('18/18');
  const partial=renderToStaticMarkup(React.createElement(DailyPhysicalCoverage,{data:{...evidence,boundedRead:true,filesRejected:1}}));expect(partial).toContain('24');expect(partial).toContain('Lecture partielle');expect(partial).toContain('lot(s) écarté(s)');
 });
});

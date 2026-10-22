import {it,expect,vi} from 'vitest';
import * as React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {ReliabilityNotesSummary} from './ReliabilityEvidenceSections';

it('affiche une erreur provisoire avec son effectif sans fabriquer une note sur dix',()=>{
 vi.stubGlobal('React',React);
 try{
  const data={evidence:{status:'available',expectedModelCount:7},selectedHorizon:{exactWindow:true,label:'6–24 h'},period:{startDate:'2026-10-10',endDate:'2026-10-16'},notes:{complete:false,hourly:{mae:null,comparisonCount:0,evaluatedDays:0,qualifiedCells:0},daily:{mae:null,comparisonCount:0,evaluatedDays:0,qualifiedCells:0},provisionalHourly:{mae:1.25,comparisonCount:6,evaluatedDays:2,modelCount:2,partialArchive:true}}};
  const html=renderToStaticMarkup(React.createElement(ReliabilityNotesSummary,{data}));
  expect(html).toContain('Erreur horaire provisoire');expect(html).toContain('1.25 °C');expect(html).toContain('6 comparaisons');expect(html).toContain('2 dates');expect(html).toContain('2 modèles');expect(html).toContain('Lecture partielle');expect(html).not.toContain('>Fiable<');
  const empty=renderToStaticMarkup(React.createElement(ReliabilityNotesSummary,{data:{...data,notes:{...data.notes,provisionalHourly:{...data.notes.provisionalHourly,mae:null}}}}));expect(empty).not.toContain('Erreur horaire provisoire');
 }finally{vi.unstubAllGlobals();}
});

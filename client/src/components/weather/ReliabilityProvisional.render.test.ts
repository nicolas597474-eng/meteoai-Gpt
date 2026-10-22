import {it,expect,vi} from 'vitest';
import * as React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {ReliabilityNotesSummary} from './ReliabilityEvidenceSections';
import {summarizeMeteoAIReliability,type MeteoAIPair} from '@shared/meteoaiReliability';
const pair=(date:string,kind:'hourly'|'daily',forecast:number):MeteoAIPair=>({date,kind,variable:kind==='hourly'?'temperature':'temperature_max',validAt:1,availableAt:0,observedAt:2,forecast,observed:10});
const render=(history:any)=>{vi.stubGlobal('React',React);try{return renderToStaticMarkup(React.createElement(ReliabilityNotesSummary,{data:{meteoaiReliability:history,notes:{hourly:{mae:0,qualifiedCells:7}},selectedHorizon:{label:'6–24 h'}}}));}finally{vi.unstubAllGlobals();}};
it('affiche une vraie note MeteoAI provisoire sur deux jours, sans moyenne des modèles',()=>{
 const history=summarizeMeteoAIReliability([{date:'2026-10-19',pairs:[pair('2026-10-19','hourly',11)]},{date:'2026-10-20',pairs:[pair('2026-10-20','hourly',12)]}]);
 const html=render(history);expect(html).toContain('7,0');expect(html).toContain('Provisoire');expect(html).toContain('2 comparaisons');expect(html).toContain('2 jours');expect(html).toContain('Globale partielle');expect(html).not.toContain('Moyenne des MAE');expect(html).toContain('Tout l’historique MeteoAI disponible');
});
it('ne transforme pas l’ancien score des modèles en note MeteoAI et distingue le singulier',()=>{
 const empty=render(summarizeMeteoAIReliability([]));expect(empty).not.toContain('10,0');expect(empty).toContain('Non disponible');
 const one=render(summarizeMeteoAIReliability([{date:'2026-10-20',pairs:[pair('2026-10-20','daily',11)]}]));expect(one).toContain('1 comparaison');expect(one).toContain('1 jour');expect(one).not.toContain('1 jours');expect(one).toContain('quotidiennes uniquement');
});

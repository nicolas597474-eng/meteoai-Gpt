import {afterAll,expect,it,vi} from 'vitest';
import * as React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {NetatmoDiagnosticView} from './NetatmoDiagnosticPanel';
vi.stubGlobal('React',React);afterAll(()=>vi.unstubAllGlobals());
it('un suivi indisponible ne devient ni zéro appel ni un quota Netatmo épuisé',()=>{
 const html=renderToStaticMarkup(React.createElement(NetatmoDiagnosticView,{report:null,error:true,loading:false,onRefresh(){}}));expect(html).toContain('Lecture du suivi Netatmo indisponible');expect(html).toContain('Quota restant : non communiqué');expect(html).not.toContain('quota Netatmo confirmé');
});
it('une panne serveur est distinguée d’un dépassement de quota',()=>{
 const report:any={available:true,connected:true,totals:{requests:1},last:{code:'NETATMO_PROVIDER_ERROR'}};
 const html=renderToStaticMarkup(React.createElement(NetatmoDiagnosticView,{report,error:false,loading:false,onRefresh(){}}));expect(html).toContain('Erreur du serveur Netatmo');expect(html).not.toContain('quota Netatmo confirmé');
});

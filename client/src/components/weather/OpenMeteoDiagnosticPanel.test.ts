import {afterAll,expect,it,vi} from 'vitest';
import * as React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {OpenMeteoDiagnosticView} from './OpenMeteoDiagnosticPanel';
vi.stubGlobal('React',React);afterAll(()=>vi.unstubAllGlobals());
it('ne transforme pas une lecture serveur indisponible en zéro requête',()=>{
 const html=renderToStaticMarkup(React.createElement(OpenMeteoDiagnosticView,{report:null,loading:false,error:true,browserBuckets:[],hours:24,onHours(){},onRefresh(){}}));
 expect(html).toContain('Lecture serveur indisponible');expect(html).toContain('Compteurs non accessibles');expect(html).toContain('ni le quota restant');expect(html).toContain('aria-expanded="false"');
});
it('affiche un ancien refus actif même si aucun appel nouveau ne figure au compteur',()=>{
 const now=Date.now();
 const report:any={version:1,checkedAt:new Date(now).toISOString(),traffic:{available:true,bounded:false,buckets:[]},limits:[{endpoint:'forecast',observedAt:new Date(now-3600000).toISOString(),period:'day',retryAt:new Date(now+3600000).toISOString(),active:true}],daily:null,service:{},journalAvailable:true};
 const html=renderToStaticMarkup(React.createElement(OpenMeteoDiagnosticView,{report,loading:false,error:false,browserBuckets:[],hours:48,onHours(){},onRefresh(){}}));
 expect(html).toContain('Quota serveur en attente');expect(html).toContain('Ce journal peut précéder le début des compteurs');expect(html).toContain('48 créneaux');
});
it('une suspension propre au navigateur reste visible sans être confondue avec le quota serveur',()=>{
 const html=renderToStaticMarkup(React.createElement(OpenMeteoDiagnosticView,{report:null,loading:false,error:false,browserBuckets:[],browserLimit:{period:'day',retryAt:Date.now()+3600000},hours:24,onHours(){},onRefresh(){}}));expect(html).toContain('Cet appareil : nouveaux appels de prévision suspendus');expect(html).not.toContain('Quota serveur en attente');
});

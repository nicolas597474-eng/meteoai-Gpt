import {afterAll,describe,it,expect,vi} from 'vitest';
import * as React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {readFileSync} from 'node:fs';
import {ArchiveReadNotice} from './ArchiveReadNotice';
vi.stubGlobal('React',React);afterAll(()=>vi.unstubAllGlobals());
const render=(data:unknown)=>renderToStaticMarkup(React.createElement(ArchiveReadNotice,{data,onRetry:()=>{}}));
describe('lecture partielle des archives',()=>{
 it('ne modifie pas l’affichage normal et accepte les anciennes réponses',()=>{
  for(const data of [null,undefined,{}, {archiveRead:{partial:false,rejectedFiles:0}}])expect(render(data)).toBe('');
 });
 it('explique le rejet d’un fichier sans le transformer en absence totale',()=>{
  const html=render({archiveRead:{partial:true,rejectedFiles:2,boundedRead:false,unavailableSources:[]}});
  expect(html).toContain('role="status"');expect(html).toContain('Lecture partielle des archives');expect(html).toContain('2 archive(s) non vérifiable(s)');expect(html).toContain('Seules les données vérifiées sont affichées');expect(html).toContain('Réessayer la lecture');
  expect(html).not.toContain('Aucune donnée');expect(html).not.toContain('limite de lecture');
 });
 it('distingue une source indisponible et une lecture bornée sans afficher de détail privé',()=>{
  const html=render({archiveRead:{partial:true,rejectedFiles:-1,boundedRead:true,unavailableSources:['private fixture']}});
  expect(html).toContain('temporairement indisponibles');expect(html).toContain('limite de lecture a été atteinte');expect(html).not.toContain('private fixture');expect(html).not.toContain('-1 archive');
 });
 it('raccorde le même avertissement à l’historique et au rapport',()=>{
  for(const page of ['History','Report']){
   const source=readFileSync(new URL('../../pages/'+page+'.tsx',import.meta.url),'utf8');
   expect(source).toContain('<ArchiveReadNotice data={data} onRetry={()=>void refetch()} />');
  }
 });
});

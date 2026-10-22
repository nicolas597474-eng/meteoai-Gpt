import {afterEach,expect,it,vi} from 'vitest';
import {finalizeStoredPhysicalReferences} from './physicalReferenceRefresh';
afterEach(()=>vi.unstubAllGlobals());
it('regroupe les reprises simultanées sans envoyer de mesure ni lancer une collecte météo',async()=>{
 let resolve!:(value:Response)=>void;
 const fetch=vi.fn(()=>new Promise<Response>(done=>{resolve=done;}));vi.stubGlobal('fetch',fetch);
 const first=finalizeStoredPhysicalReferences(),second=finalizeStoredPhysicalReferences();
 expect(first).toBe(second);expect(fetch).toHaveBeenCalledTimes(1);
 const [url,options]=fetch.mock.calls[0] as unknown as [string,RequestInit];
 expect(url).toBe('/api/control/finalize-physical-references');expect(options.body).toBe('{}');expect(options.credentials).toBe('same-origin');expect(options.redirect).toBe('error');
 resolve(new Response('{}'));await first;
});
it('libère une reprise échouée pour permettre Actualiser sans boucle de réessai',async()=>{
 const fetch=vi.fn().mockResolvedValueOnce(new Response('{}',{status:503})).mockResolvedValueOnce(new Response('{}'));vi.stubGlobal('fetch',fetch);
 await expect(finalizeStoredPhysicalReferences()).rejects.toThrow('archives conservées');
 await finalizeStoredPhysicalReferences();expect(fetch).toHaveBeenCalledTimes(2);
});

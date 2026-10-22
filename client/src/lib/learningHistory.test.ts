import {afterEach,expect,it,vi} from 'vitest';
import {getLearningHistory,invalidateLearningHistory} from './learningHistory';
const coords={lat:50.7567,lon:2.5204};
const history=(revision:string)=>({version:1,scope:'hondeghem',available:true,revision,units:[],hourlyScores:[],exactHourlyScores:[],providerModels:[]});
afterEach(()=>{invalidateLearningHistory();vi.unstubAllGlobals();});
it('une ancienne lecture terminée après Actualiser ne remplace pas les nouvelles preuves',async()=>{
 let resolveOld!:(r:Response)=>void;
 const fetch=vi.fn().mockImplementationOnce(()=>new Promise<Response>(resolve=>{resolveOld=resolve;})).mockResolvedValueOnce(Response.json(history('nouveau')));vi.stubGlobal('fetch',fetch);
 const old=getLearningHistory(coords);invalidateLearningHistory();
 const current=await getLearningHistory(coords);expect(current?.revision).toBe('nouveau');
 resolveOld(Response.json(history('ancien')));await old;
 expect((await getLearningHistory(coords))?.revision).toBe('nouveau');expect(fetch).toHaveBeenCalledTimes(2);
});
it('une réponse incomplète échoue sans conserver de fausses preuves',async()=>{
 const fetch=vi.fn().mockResolvedValueOnce(Response.json({...history('incomplet'),hourlyScores:null})).mockResolvedValueOnce(Response.json(history('complet')));vi.stubGlobal('fetch',fetch);
 await expect(getLearningHistory(coords)).rejects.toThrow('invalide');expect((await getLearningHistory(coords))?.revision).toBe('complet');
});

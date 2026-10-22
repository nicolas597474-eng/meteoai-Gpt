import {describe,it,expect,vi} from 'vitest';
const collect=vi.hoisted(()=>vi.fn(async()=>({forecasts:[],diagnostics:[{modelName:'AROME',modelId:'meteofrance_arome_france_hd',status:'failed',attemptCount:2,hoursReceived:0,valuesReceived:0,expectedValueCount:960,expectedHoursCount:48,errorCode:'timeout'}]})));
vi.mock('../server/weatherServices',async importOriginal=>({...await importOriginal<any>(),collectHourlyForecastAllModelsWithDiagnostics:collect,collectCurrentWeatherSnapshot:async()=>null,collect15DayForecast:vi.fn()}));
import {detailed} from '../worker/weather';
describe('enregistrement des tentatives réelles',()=>{
 it('envoie le journal même si aucun modèle ne fournit une prévision exploitable',async()=>{
  const archiveCollectionJournal=vi.fn(async()=>{}),pending:Promise<unknown>[]=[];
  const env={BUCKET:{get:async()=>null,put:vi.fn()},archiveCollectionJournal},ctx={waitUntil(p:Promise<unknown>){pending.push(p);}};
  await expect(detailed({lat:50.7567,lon:2.5204},env,ctx)).rejects.toThrow('sources Open-Meteo');await Promise.all(pending);
  expect(archiveCollectionJournal).toHaveBeenCalledTimes(1);const payload=archiveCollectionJournal.mock.calls[0][0] as any;expect(payload.diagnostics[0].errorCode).toBe('timeout');expect(payload.completedAt).toBeGreaterThanOrEqual(payload.startedAt);
 });
});

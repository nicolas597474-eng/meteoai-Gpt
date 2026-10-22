import {describe,it,expect,vi} from 'vitest';
const collectDaily=vi.hoisted(()=>vi.fn(async(_coords:any,options:any)=>{
 const date=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Paris'}).format(Date.now());
 const values={tempMax:0,tempMin:null,precipitation:0,windSpeed:3,windGust:null,humidity:null,cloudCover:null};
 await options.resolveOfficialFusion(date,[{serviceName:'AROME',modelId:'meteofrance_arome_france_hd',...values}],Date.now(),{});
 return {days:[{date,...values,officialFusion:{availabilityStatus:{},calibrationStatus:{}}}],modelsUsed:['AROME']};
}));
vi.mock('../server/weatherServices',async original=>({...await original<any>(),collect15DayForecast:collectDaily}));
vi.mock('../server/officialForecast',async original=>({...await original<any>(),computeOfficialDailyForecastWithDiagnostics:()=>({trace:{}})}));
import {daily} from '../worker/weather';
describe('archive quotidienne à la collecte',()=>{
 it('sauvegarde les entrées réellement reçues, même une température nulle',async()=>{
  const archiveDailyForecasts=vi.fn(async()=>{}),pending:Promise<any>[]=[];
  const result=await daily({lat:50.7567,lon:2.5204},{BUCKET:{get:async()=>null,put:async()=>{}},archiveDailyForecasts},{waitUntil:p=>pending.push(p)});
  expect(result.days[0].tempMax).toBe(0);
  await Promise.all(pending);expect(archiveDailyForecasts).toHaveBeenCalledOnce();expect(archiveDailyForecasts.mock.calls[0][0].days[0].forecasts[0].tempMax).toBe(0);
 });
});

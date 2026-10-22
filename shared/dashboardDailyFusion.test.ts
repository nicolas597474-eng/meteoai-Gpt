import {describe,it,expect} from 'vitest';
import {DAILY_FUSION_FIELDS,projectDailyFusionDetails} from './dashboardDailyFusion';
import {projectDailyForecastForDashboard} from '../server/forecastResponseProjection';
import type {DailyOfficialFusionDisplay} from './dailyForecast';
import type {DayForecast} from '../server/weatherServices';

function fixture():DailyOfficialFusionDisplay {
 const rows=Object.fromEntries(DAILY_FUSION_FIELDS.map(([key])=>[key,[]]));
 return {issuedAt:'2026-10-18T10:00:00Z',referenceAt:'2026-10-18T10:01:00Z',horizonBucket:'1-3d',
   availabilityStatus:Object.fromEntries(DAILY_FUSION_FIELDS.map(([key])=>[key,'UNAVAILABLE'])),
   calibrationStatus:Object.fromEntries(DAILY_FUSION_FIELDS.map(([key])=>[key,'UNCALIBRATED_ROBUST'])),
   sourcesByVariable:{...rows,tempMax:[{modelName:'AROME',finalWeight:0.19},{modelName:'ICON',finalWeight:0.81}],precipitation:[{modelName:'AROME',finalWeight:0}]},
   diagnosticsByVariable:{tempMax:{availableModels:['AROME','ICON'],contributingModelCount:2,modelReasons:[{modelName:'GFS',reason:'Run non reçu'}]}},
 } as DailyOfficialFusionDisplay;
}
describe('trace compacte quotidienne du calcul réellement chargé',()=>{
 it('conserve exactement les poids et motifs, sans les renormaliser',()=>{
   const fusion=fixture(),before=JSON.stringify(fusion),rows=projectDailyFusionDetails(fusion);
   expect(rows[0]).toMatchObject({key:'tempMax',availableModels:['AROME','ICON'],contributingCount:2,models:[{name:'AROME',weight:0.19},{name:'ICON',weight:0.81}],excluded:[{name:'GFS',reason:'Run non reçu'}]});
   expect(JSON.stringify(fusion)).toBe(before);
   expect(rows.find(row=>row.key==='precipitation')?.models[0].weight).toBe(0);
 });
 it('ne déduit ni modèle ni effectif lorsqu’un diagnostic manque',()=>{
   const row=projectDailyFusionDetails(fixture()).find(row=>row.key==='humidity')!;
   expect(row.models).toEqual([]);expect(row.availableModels).toEqual([]);expect(row.contributingCount).toBeNull();
 });
 it('projette la trace sans modifier les valeurs météo ou le statut original',()=>{
   const day={date:'2026-10-19',tempMax:0,tempMin:null,precipitation:0,officialFusion:fixture()} as DayForecast;
   const [projected]=projectDailyForecastForDashboard([day]);
   expect(projected.tempMax).toBe(0);expect(projected.tempMin).toBeNull();expect(projected.precipitation).toBe(0);
   expect(projected.fusionDetails[0].models[0]).toEqual({name:'AROME',weight:0.19});
   expect(projected.officialFusion.referenceAt).toBe(day.officialFusion.referenceAt);
   expect(projected.officialFusion).not.toHaveProperty('sourcesByVariable');
   expect(day.officialFusion).toHaveProperty('sourcesByVariable');
 });
});

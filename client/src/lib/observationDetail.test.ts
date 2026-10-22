import { describe, expect, it } from 'vitest';
import { observationForecastDetail, observationForecastField, observationInstant } from './observationDetail';
import type { DashboardFusionTrace } from '@shared/dashboardFusionTrace';

const at = Date.parse('2026-10-25T01:00:00Z');
const row = { key: 'precipitation', label: 'Pluie', unit: 'mm', value: 0, precipitation: null, status: 'ROBUST_FALLBACK' as const, selection: 'weighted_ensemble_fallback' as const, models: [{ name: 'AROME', value: 0, weight: 1, contributes: true }, { name: 'ICON', value: 2, weight: 0, contributes: false }], excluded: [] };
const points = [{ validAt: at, variables: [row] }] as DashboardFusionTrace;

describe('détail des observations du Dashboard', () => {
  it('garde la prévision de température séparée d’une mesure actuelle et conserve zéro',()=>{
    const forecast=[{validAt:at,variables:[{...row,key:'temperature',label:'Température',unit:'°C',value:0,models:[{name:'AROME',value:0,weight:1,contributes:true}]}]}] as DashboardFusionTrace;
    expect(observationForecastDetail(forecast,at,'temperature')).toMatchObject({row:{value:0,unit:'°C'},availableModels:1,spread:null});
    expect(observationForecastDetail(forecast,at+3600000,'temperature').row).toBeNull();
  });
  it('ne confond pas les deux heures identiques du passage à l’heure d’hiver', () => {
    expect(observationForecastDetail(points, at - 3600000, 'precipitation').row).toBeNull();
    expect(observationForecastDetail(points, at, 'precipitation').row?.value).toBe(0);
    expect(observationForecastDetail(points, at, 'humidity').row).toBeNull();
    expect(observationForecastDetail(points, null, 'precipitation').row).toBeNull();
  });
  it('conserve zéro et distingue les modèles disponibles des contributeurs', () => {
    expect(observationForecastDetail(points, at, 'precipitation')).toMatchObject({ availableModels: 2, spread: 2 });
    const one = [{ validAt: at, variables: [{ ...row, models: row.models.slice(0, 1) }] }] as DashboardFusionTrace;
    expect(observationForecastDetail(one, at, 'precipitation')).toMatchObject({ availableModels: 1, spread: null });
  });
  it('écarte les nombres non finis sans fabriquer un écart à zéro', () => {
    const invalid = [{ validAt: at, variables: [{ ...row, models: row.models.map(m => ({ ...m, value: NaN })) }] }] as DashboardFusionTrace;
    expect(observationForecastDetail(invalid, at, 'precipitation')).toMatchObject({ availableModels: 0, spread: null });
  });
  it('documente la bonne échéance UV et ne remplit jamais un champ manquant', () => {
    expect(observationForecastField(0, at, '2026-10-25T00:30:00Z', 'Open-Meteo')).toMatchObject({ value: 0, provenance: { kind: 'official_hourly_forecast', observedAt: '2026-10-25T01:00:00.000Z', measurements: [] } });
    expect(observationForecastField(NaN, undefined, null, 'Open-Meteo')).toMatchObject({ value: null, provenance: { observedAt: null } });
    expect(observationForecastField(2, 1e100, null, 'Open-Meteo').provenance.observedAt).toBeNull();
    expect(observationInstant('invalid')).toBe('Horodatage indisponible');
    expect(observationInstant('2026-10-25T01:00:00Z')).toContain('02:00');
  });
});

import { describe, expect, it, vi } from "vitest";
import { meanAbsoluteDeltaC, qualifiedReliabilityNote, ReliabilityNotesSummary, VariableEvidenceSection } from "./ReliabilityEvidenceSections";
import { createElement } from "react";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";

describe("meanAbsoluteDeltaC", () => {
  it("calcule seulement les paires de températures réellement disponibles", () => {
    expect(meanAbsoluteDeltaC([
      { stationTemperature: 12, officialTemperature: 10 },
      { stationTemperature: null, officialTemperature: 7 },
      { stationTemperature: 5, officialTemperature: null },
      { stationTemperature: 6, officialTemperature: 9 },
    ])).toBe(2.5);
  });

  it("retourne indisponible lorsqu’aucune paire exploitable n’existe", () => {
    expect(meanAbsoluteDeltaC([
      { stationTemperature: null, officialTemperature: 8 },
      { stationTemperature: 7, officialTemperature: null },
      { stationTemperature: Number.NaN, officialTemperature: 4 },
    ])).toBeNull();
  });
});

describe("notes qualifiées", () => {
  const cell = {mae: 1, qualifiedCells: 1, comparisonCount: 30, evaluatedDays: 7};
  it("refuse une paire, les preuves partielles et les métriques invalides", () => {
    expect(qualifiedReliabilityNote({...cell,comparisonCount:1},true)).toBeNull();
    expect(qualifiedReliabilityNote({...cell,evaluatedDays:1},true)).toBeNull();
    expect(qualifiedReliabilityNote(cell,false)).toBeNull();
    expect(qualifiedReliabilityNote({...cell,mae:NaN},true)).toBeNull();
    expect(qualifiedReliabilityNote({...cell,qualifiedCells:0},true)).toBeNull();
    expect(qualifiedReliabilityNote({mae:1},true)).toBeNull();
    expect(qualifiedReliabilityNote(cell,true)).toBe(8);
    expect(qualifiedReliabilityNote({...cell,mae:20},true)).toBe(0);
  });
  it("le rendu ne prétend plus évaluer les cumuls ou une archive illisible", () => {
    vi.stubGlobal('React', React);
    try {
    const html=renderToStaticMarkup(createElement(ReliabilityNotesSummary,{data:{evidence:{status:'available',expectedModelCount:7},selectedHorizon:{exactWindow:true,label:'6–24 h'},period:{startDate:'2026-10-10',endDate:'2026-10-16'},notes:{hourly:{...cell,comparisonCount:1},daily:{...cell,evaluatedDays:1},complete:true}}}));
    expect(html).toContain('températures min/max');expect(html).not.toContain('min/max, cumul');
    expect(html).toContain('Aucune note n’est inventée');expect(html).not.toContain('Archive non lisible');
    expect(html).not.toContain('>Fiable<');
    } finally { vi.unstubAllGlobals(); }
  });
});

// Les identifiants des scores MSL et pluie liquide doivent atteindre les cartes visibles.
it('affiche les vraies cellules MSL et pluie horaire sans les confondre avec les anciennes variables',()=>{
 vi.stubGlobal('React',React);
 try{
  const values={mae:2,rmse:2,bias:2,comparisonCount:35,evaluatedDays:7};
  const rows=['pressure_msl','rain_liquid_1h'].map(variable=>({modelName:'AROME',modelId:'meteofrance_arome_france_hd',variable,variableLabel:variable,unit:variable==='pressure_msl'?'hPa':'mm',horizonId:'6-24h',status:'qualified',reason:null,metrics:values,rawMetrics:values,rawValidated:true,minimumComparisons:30,minimumComparableDays:7,firstScoreDate:null,latestScoreDate:null,latestComputedAt:null,incompleteMetricRows:0,legacyUnversionedRowCount:0,trend:null}));
  const html=renderToStaticMarkup(createElement(VariableEvidenceSection,{rows,expectedModelCount:7,horizonArchived:true,evidenceAvailable:true}));
  expect(html).toContain('Pression au niveau de la mer');expect(html).toContain('Pluie liquide');expect(html.match(/1\/7/g)?.length).toBe(2);expect(html).toMatch(/2\.0+ hPa/);expect(html).toMatch(/2\.0+ mm/);
 }finally{vi.unstubAllGlobals();}
});

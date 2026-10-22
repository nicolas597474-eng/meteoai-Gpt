import {describe,it,expect} from 'vitest';
import {collectionMomentLabel,physicalCollectionSummary} from './collectionSuccess';

describe('reçu serveur dans AI Lab',()=>{
 it('affiche la réception réelle sans la convertir en absence de station ni en score qualifié',()=>{
  const receipt={status:'capture_verified',collectedAt:'2026-10-20T17:07:36.948Z',stationCount:336};
  expect(collectionMomentLabel(receipt,'physical')).toContain('19:07');
  expect(collectionMomentLabel(receipt,'physical')).not.toContain('indisponible');
  expect(physicalCollectionSummary(receipt)).toContain('336 relevé(s)');
  expect(physicalCollectionSummary(receipt)).toContain('ne qualifie pas les scores');
  expect(physicalCollectionSummary(receipt)).not.toContain('aucune station');
 });
 it('garde distincts réception vérifiée, référence stockée et absence de station attestée',()=>{
  expect(physicalCollectionSummary({status:'stored',stationCount:3})).toContain('3 station(s) qualifiée(s)');
  expect(physicalCollectionSummary({status:'no_qualified_stations',stationCount:0})).toContain('Aucune station');
  expect(physicalCollectionSummary({status:'unknown'})).toContain('pas confirmé');
  expect(physicalCollectionSummary({status:'capture_verified',stationCount:0})).toContain('0 relevé(s)');
  expect(physicalCollectionSummary({status:'capture_verified'})).toContain('— relevé(s)');
 });
 it('conserve les anciens créneaux datés et les prévisions, sans créer de date absente',()=>{
  expect(collectionMomentLabel({status:'stored',date:'2026-10-20',hour:3},'physical')).toContain('03 h');
  expect(collectionMomentLabel({status:'capture_verified',collectedAt:'2026-10-20T17:07:00Z'},'forecast')).toContain('Mis à jour le');
  expect(collectionMomentLabel({status:'capture_verified'},'physical')).toBe('Horodatage indisponible');
 });
});

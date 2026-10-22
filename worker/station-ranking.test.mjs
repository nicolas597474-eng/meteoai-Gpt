import {test} from 'node:test';
import assert from 'node:assert/strict';
import worker from '../dist/server/index.js';

test('critères Stations raccordés sans requête fournisseur, coffre ou base privée', async t => {
  t.mock.method(globalThis, 'fetch', () => {throw Error('Réseau inattendu');});
  const env = {DB: {prepare() {throw Error('SQL inattendu');}}, BUCKET: {get() {throw Error('Coffre inattendu');}, put() {throw Error('Écriture inattendue');}}};
  const response = await worker.fetch(new Request('https://controle.example/api/trpc/weather.getStationRankingCriteria'), env, {waitUntil() {}});
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.ok(body.result, JSON.stringify(body.error));
  const contract = body.result.data.json;
  assert.deepEqual(contract.criteria.map(c => c.weight), [40, 30, 20, 10]);
  assert.deepEqual(contract.sources.map(s => [s.id, s.sourcePriorityScore]), [['netatmo', 72]]);
  assert.equal(contract.selection.maximumMeasurementAgeMinutes, 90);
  assert.equal(contract.rankingScore.freshnessCutoffMinutes, 180);
  assert.equal(contract.rankingScore.isProbability, false);
});

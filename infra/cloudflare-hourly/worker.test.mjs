import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import worker, {collectOnce, COLLECTION_URL} from './worker.mjs';

const now = Date.parse('2026-10-20T14:07:00Z');
const event = {scheduledTime: now};
const env = {COLLECTION_ENABLED: 'true', SITES_SERVICE_TOKEN: 'fixture-platform-token-'.repeat(3), METEOAI_COLLECTOR_KEY: 'a'.repeat(64)};
const receipt = (data = {}) => Response.json({version: 1, slot: '2026-10-20T14', status: 'complete', ...data});
const run = (fetcher, settings = env, scheduled = event) => collectOnce(scheduled, settings, {fetcher, now});

test('configuration livrée sans planning, sans endpoint public et désactivée', async () => {
  const config = JSON.parse(await readFile(new URL('./wrangler.json', import.meta.url), 'utf8'));
  assert.equal(config.vars.COLLECTION_ENABLED, 'false');
  assert.deepEqual(config.triggers.crons, []);
  assert.equal(config.workers_dev, false);
  assert.equal(config.preview_urls, false);
  assert.equal((await worker.fetch(new Request('https://example.invalid/'))).status, 404);
});

test('configuration de production : un seul cron horaire et aucun endpoint HTTP public',async()=>{
 const config=JSON.parse(await readFile(new URL('./wrangler.production.json',import.meta.url),'utf8'));
 assert.equal(config.name,'meteoai-collecte-horaire');assert.equal(config.main,'worker.mjs');
 assert.deepEqual(config.triggers.crons,['7 * * * *']);assert.equal(config.vars.COLLECTION_ENABLED,'true');
 assert.equal(config.workers_dev,false);assert.equal(config.preview_urls,false);
 assert(!('SITES_SERVICE_TOKEN' in config.vars));assert(!('METEOAI_COLLECTOR_KEY' in config.vars));
});

test('modèle de configuration : seuls des noms de secrets vides sont fournis',async()=>{
 const template=await readFile(new URL('./.dev.vars.example',import.meta.url),'utf8');
 const lines=template.split(/\r?\n/).filter(line=>line&&!line.startsWith('#'));
 assert.deepEqual(lines,['COLLECTION_ENABLED=false','SITES_SERVICE_TOKEN=','METEOAI_COLLECTOR_KEY=']);
});

test('aucun appel lorsque désactivé, même sans secrets ni événement', async () => {
  let calls = 0;
  for (const settings of [{}, {...env, COLLECTION_ENABLED: 'false'}, {...env, COLLECTION_ENABLED: true}]) {
    assert.deepEqual(await run(async () => {calls++; throw Error('unexpected');}, settings, undefined), {status: 'disabled'});
  }
  assert.equal(calls, 0);
});

test('refuse une configuration incomplète ou une injection dans les en-têtes', async () => {
  let calls = 0;
  for (const settings of [
    {...env, SITES_SERVICE_TOKEN: ''}, {...env, SITES_SERVICE_TOKEN: 'x'.repeat(9000)},
    {...env, SITES_SERVICE_TOKEN: env.SITES_SERVICE_TOKEN + '\r\nX-Test: bad'},
    {...env, METEOAI_COLLECTOR_KEY: ''}, {...env, METEOAI_COLLECTOR_KEY: 'not-a-key'},
  ]) await assert.rejects(run(async () => {calls++; return receipt();}, settings), /METEOAI_COLLECTOR_CONFIGURATION$/);
  assert.equal(calls, 0);
});

test('refuse les anciens événements, les dates futures et les dates invalides', async () => {
  let calls = 0;
  for (const scheduledTime of [now - 600001, now + 1, NaN, '2026-10-20', undefined]) {
    await assert.rejects(run(async () => {calls++; return receipt();}, env, {scheduledTime}), /STALE_EVENT$/);
  }
  assert.equal(calls, 0);
});

test('une seule demande vers le Site fixe, sans identité ni mesures clientes', async () => {
  let calls = 0;
  const answer = await run(async (url, options) => {
    calls++;
    assert.equal(url, COLLECTION_URL);
    assert.equal(options.method, 'POST');
    assert.equal(options.body, '{}');
    assert.equal(options.redirect, 'manual');
    assert(options.signal instanceof AbortSignal);
    assert.equal(options.headers['OAI-Sites-Authorization'], 'Bearer ' + env.SITES_SERVICE_TOKEN);
    assert.equal(options.headers['X-MeteoAI-Collector-Key'], env.METEOAI_COLLECTOR_KEY);
    assert(!Object.keys(options.headers).some(key => key.toLowerCase().startsWith('oai-authenticated-')));
    return receipt();
  });
  assert.equal(calls, 1);
  assert.deepEqual(answer, {status: 'complete', slot: '2026-10-20T14'});
});

test('une redirection ne provoque ni suivi ni second appel', async () => {
  let calls = 0;
  await assert.rejects(run(async (_, options) => {
    calls++; assert.equal(options.redirect, 'manual');
    return new Response(null, {status: 302, headers: {Location: 'https://intrus.invalid/'}});
  }), /HTTP_302$/);
  assert.equal(calls, 1);
});

test('401, 403, 429 et 503 sont des échecs sans relance ni contenu sensible dans l’erreur', async () => {
  for (const status of [401, 403, 429, 503]) {
    let calls = 0;
    await assert.rejects(run(async () => {calls++; return new Response(env.SITES_SERVICE_TOKEN, {status});}), error => {
      assert.equal(error.message, 'METEOAI_COLLECTOR_HTTP_' + status);
      return true;
    });
    assert.equal(calls, 1);
  }
});

test('une page de connexion avec HTTP 200 ne vaut pas un archivage réussi', async () => {
  await assert.rejects(run(async () => new Response('<html>Connexion</html>', {headers: {'Content-Type': 'text/html'}})), /FORMAT$/);
});

test('refuse les réponses JSON malformées et les créneaux différents', async () => {
  await assert.rejects(run(async () => new Response('{broken', {headers: {'Content-Type': 'application/json'}})), /FORMAT$/);
  for (const data of [{version: 2}, {slot: '2026-10-20T13'}, {status: 'partial'}, {status: 'busy'}, {status: 'accepted'}]) {
    await assert.rejects(run(async () => receipt(data)), /INCOMPLETE$/);
  }
});

test('réponse trop volumineuse refusée avant analyse', async () => {
  await assert.rejects(run(async () => receipt({privateDetails: 'x'.repeat(5000)})), /RESPONSE_TOO_LARGE$/);
});

test('réponse reçue par fragments correctement lue', async () => {
  const bytes = new TextEncoder().encode(JSON.stringify({version: 1, slot: '2026-10-20T14', status: 'duplicate'}));
  const body = new ReadableStream({start(controller) {controller.enqueue(bytes.slice(0, 13)); controller.enqueue(bytes.slice(13)); controller.close();}});
  assert.deepEqual(await run(async () => new Response(body, {headers: {'Content-Type': 'application/json; charset=utf-8'}})), {status: 'duplicate', slot: '2026-10-20T14'});
});

test('erreur réseau expurgée, sans nouvelle tentative', async () => {
  let calls = 0;
  await assert.rejects(run(async () => {calls++; throw Error('secret: ' + env.SITES_SERVICE_TOKEN);}), error => {
    assert.equal(error.message, 'METEOAI_COLLECTOR_NETWORK');
    return true;
  });
  assert.equal(calls, 1);
});

test('erreur de lecture expurgée, sans message distant dans les journaux', async () => {
  const body = new ReadableStream({start(controller) {controller.error(Error(env.SITES_SERVICE_TOKEN));}});
  await assert.rejects(run(async () => new Response(body, {headers: {'Content-Type': 'application/json'}})), /METEOAI_COLLECTOR_READ$/);
});

test('scheduled transmet les échecs à waitUntil et journalise seulement le résultat filtré', async t => {
  let pending;
  const logs = [];
  t.mock.method(Date, 'now', () => now);
  t.mock.method(globalThis, 'fetch', async () => receipt({privateDetails: env.SITES_SERVICE_TOKEN}));
  t.mock.method(console, 'log', text => logs.push(text));
  await worker.scheduled(event, env, {waitUntil(promise) {pending = promise;}});
  await pending;
  assert.deepEqual(JSON.parse(logs[0]), {event: 'meteoai_hourly', status: 'complete', slot: '2026-10-20T14'});
  assert(!logs.join('').includes(env.SITES_SERVICE_TOKEN));
  t.mock.method(globalThis, 'fetch', async () => new Response('private', {status: 503}));
  await worker.scheduled(event, env, {waitUntil(promise) {pending = promise;}});
  await assert.rejects(pending, /HTTP_503$/);
});

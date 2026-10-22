// Déclencheur uniquement : les mesures, les jetons Netatmo et les calculs restent dans le Site.
// Le Site fournit la route serveur protégée ; le minuteur ne fabrique aucune identité de visiteur.
export const SITE_ORIGIN = 'https://meteoai-restauree-controle.givingbay1.chatgpt.site';
export const COLLECTION_URL = SITE_ORIGIN + '/api/automation/hourly-collection';
const MAX_RESPONSE_BYTES = 4096;

function failure(code) { return new Error('METEOAI_COLLECTOR_' + code); }
function serviceToken(value) {
  return typeof value === 'string' && value.length >= 32 && value.length <= 8192 && !/[\s\x00-\x1f\x7f]/.test(value);
}

/** Réponse courte obligatoire : une page de connexion HTTP 200 ne signifie jamais réussite. */
async function readReceipt(response) {
  if (!/^application\/json(?:\s*;|$)/i.test(response.headers.get('Content-Type') ?? '')) throw failure('FORMAT');
  const reader = response.body?.getReader();
  if (!reader) throw failure('FORMAT');
  let bytes = 0;
  const chunks = [];
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      bytes += part.value.byteLength;
      if (bytes > MAX_RESPONSE_BYTES) { await reader.cancel(); throw failure('RESPONSE_TOO_LARGE'); }
      chunks.push(part.value);
    }
  } finally { reader.releaseLock(); }
  const buffer = new Uint8Array(bytes);
  let offset = 0;
  for (const chunk of chunks) { buffer.set(chunk, offset); offset += chunk.byteLength; }
  try { return JSON.parse(new TextDecoder('utf-8', {fatal: true, ignoreBOM: false}).decode(buffer)); }
  catch { throw failure('FORMAT'); }
}

/** Aucun rattrapage du passé : le Site devra horodater ses propres réceptions et dédupliquer. */
export async function collectOnce(event, env, {fetcher = fetch, now = Date.now()} = {}) {
  if (env.COLLECTION_ENABLED !== 'true') return {status: 'disabled'};
  if (!serviceToken(env.SITES_SERVICE_TOKEN) || !/^[a-f0-9]{64}$/.test(env.METEOAI_COLLECTOR_KEY ?? '')) throw failure('CONFIGURATION');
  if (!Number.isSafeInteger(event?.scheduledTime) || !Number.isSafeInteger(now) || event.scheduledTime > now || now - event.scheduledTime > 10 * 60 * 1000) throw failure('STALE_EVENT');
  const slot = new Date(now).toISOString().slice(0, 13);
  let response;
  try {
    response = await fetcher(COLLECTION_URL, {
      method: 'POST',
      // Ne jamais envoyer ces secrets vers une URL de redirection ou une cible configurable.
      redirect: 'manual',
      headers: {
        'Content-Type': 'application/json',
        'OAI-Sites-Authorization': 'Bearer ' + env.SITES_SERVICE_TOKEN,
        'X-MeteoAI-Collector-Key': env.METEOAI_COLLECTOR_KEY,
      },
      body: '{}',
      signal: AbortSignal.timeout(180000),
    });
  } catch { throw failure('NETWORK'); }
  // Ne pas journaliser les réponses brutes : elles pourraient contenir des informations privées.
  if (response.status !== 200) {
    await response.body?.cancel().catch(() => {});
    throw failure('HTTP_' + response.status);
  }
  let receipt;
  try { receipt = await readReceipt(response); }
  catch (error) { if (error instanceof Error && error.message.startsWith('METEOAI_COLLECTOR_')) throw error; throw failure('READ'); }
  if (receipt?.version !== 1 || receipt.slot !== slot || !['complete', 'duplicate'].includes(receipt.status)) throw failure('INCOMPLETE');
  // L'acquittement ne doit être émis par le Site qu'après lecture des données persistées.
  return {status: receipt.status, slot};
}

export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(collectOnce(event, env).then(result => {
      console.log(JSON.stringify({event: 'meteoai_hourly', ...result}));
    }));
  },
  // Aucune action HTTP publique ou route de déclenchement manuel.
  fetch() { return new Response('Introuvable', {status: 404}); },
};

export type ProviderRateLimit = {retryAt: number; period: 'minute'|'hour'|'day'|'unknown'};

/** Délai de prudence, pas une promesse de rétablissement du fournisseur.
 * Le corps n'est jamais conservé. Retry-After prime sur le délai local.
 */
export async function readProviderRateLimit(response: Response, now = Date.now()): Promise<ProviderRateLimit|null> {
  if (response.status !== 429) return null;
  let reason = '';
  try {const body = await response.clone().text(); if (body.length <= 2048) reason = String(JSON.parse(body).reason ?? '').toLowerCase();} catch {}
  const period: ProviderRateLimit['period'] = /daily|per day|tomorrow/.test(reason) ? 'day'
    : /hourly|per hour/.test(reason) ? 'hour' : /minutely|per minute/.test(reason) ? 'minute' : 'unknown';
  // Le code officiel efface les compteurs à la frontière UTC, dans son
  // callback minute. Une minute de marge couvre ce passage.
  // https://github.com/open-meteo/open-meteo/blob/main/Sources/App/Helper/Vapor/RateLimiter.swift
  const fallbackAt = period === 'day' ? (Math.floor(now / 86400000) + 1) * 86400000 + 60000
    : period === 'hour' ? (Math.floor(now / 3600000) + 1) * 3600000 + 60000
    : now + (period === 'minute' ? 60000 : 600000);
  const header = response.headers.get('Retry-After');
  const requested = header && /^\d+$/.test(header) ? now + Number(header) * 1000 : header ? Date.parse(header) : NaN;
  return {period, retryAt: Number.isSafeInteger(requested) && requested > now
    ? Math.min(now + 7 * 86400000, Math.max(now + 60000, requested)) : Math.max(now + 60000, fallbackAt)};
}

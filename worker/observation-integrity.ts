import type {PhysicalAuxiliary} from './physical-auxiliary';
/** Contrôle en lecture seule des lots Netatmo : aucun relevé n'est qualifié par ce contrôle. */
const HOUR = 3600000;
const source = 'netatmo_browser_bridge';
const hash = async (text: string) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))).map(v => v.toString(16).padStart(2, '0')).join('');
const time = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 && v <= 8640000000000000;

export type VerifiedObservation = {stationKey: string; measuredAt: number; receivedAt: number; temperature: number; humidity?:number|null;auxiliary?:PhysicalAuxiliary;flags: string[];distance:number;elevation:number|null};

/** Seules les lignes du lot effectivement indexées sont retenues (déduplication concurrente). */
export async function verifyObservationArchive(key: string, env: any, now = Date.now()): Promise<VerifiedObservation[]> {
 if (!/^history\/station-observations\/[a-f0-9]{64}\.json$/.test(key)) throw Error('Clé de mesures non conforme');
 const object = await env.BUCKET.get(key);
 if (!object || object.size > 500000) throw Error('Archive de mesures absente ou trop grande');
 const bytes = await object.arrayBuffer();
 if (bytes.byteLength > 500000) throw Error('Archive de mesures trop grande');
 const text = new TextDecoder().decode(bytes);
 if (key !== 'history/station-observations/' + await hash(text) + '.json') throw Error('Empreinte des mesures non conforme');
 const payload = JSON.parse(text);
 if (payload.version !== 1 || payload.kind !== 'station_observations' || payload.source !== source || payload.calibrationEligible !== false || !time(payload.receivedAt) || payload.receivedAt > now || !Array.isArray(payload.rows) || !payload.rows.length || payload.rows.length > 200) throw Error('Lot de mesures non conforme');
 const byId = new Map<string, any>();
 for (const row of payload.rows) {
  if (!row || typeof row.stationKey !== 'string' || !/^[a-f0-9]{64}$/.test(row.stationKey) || !time(row.measuredAt) || row.id !== row.stationKey + '/' + row.measuredAt || byId.has(row.id) || row.source !== source || row.calibrationEligible !== false || row.receivedAt !== payload.receivedAt || row.measuredAt < row.receivedAt - 90 * 60000 || row.measuredAt > row.receivedAt + 5 * 60000 || !Number.isFinite(row.temperature) || row.temperature < -45 || row.temperature > 55 || !Number.isFinite(row.distance) || row.distance < 0 || row.distance > 50 || (row.elevation !== null && !Number.isFinite(row.elevation))) throw Error('Mesure non conforme');
  if (!Array.isArray(row.flags) || row.flags.some((v: unknown) => v !== 'source_flagged' && v !== 'older_than_30_minutes') || new Set(row.flags).size !== row.flags.length || row.flags.includes('older_than_30_minutes') !== (row.receivedAt - row.measuredAt > 30 * 60000)) throw Error('Qualité de mesure non conforme');
  const measurement = {id: row.id, stationKey: row.stationKey, measuredAt: row.measuredAt, temperature: row.temperature, distance: row.distance, elevation: row.elevation, source};
  if (row.digest !== await hash(JSON.stringify(measurement))) throw Error('Empreinte de mesure non conforme');
  byId.set(row.id, row);
 }
 const indexed = await env.DB.prepare('SELECT id,station_key,measured_at,received_at,temperature,distance,elevation,source,quality_flags,payload_digest,calibration_eligible FROM weather_station_observations WHERE object_key=? LIMIT 201').bind(key).all();
 if (!Array.isArray(indexed?.results) || !indexed.results.length || indexed.results.length > 200) throw Error('Index des mesures non conforme');
 const seen = new Set<string>(), result: VerifiedObservation[] = [];
 for (const index of indexed.results) {
  const row = byId.get(index.id);
  if (!row || seen.has(index.id) || index.station_key !== row.stationKey || index.measured_at !== row.measuredAt || index.received_at !== row.receivedAt || index.temperature !== row.temperature || index.distance !== row.distance || index.elevation !== row.elevation || index.source !== source || index.quality_flags !== JSON.stringify(row.flags) || index.payload_digest !== row.digest || index.calibration_eligible !== 0) throw Error('Index des mesures non conforme');
  seen.add(index.id);
  result.push({stationKey: row.stationKey, measuredAt: row.measuredAt, receivedAt: row.receivedAt, temperature: row.temperature, flags: row.flags,distance:row.distance,elevation:row.elevation});
 }
 return result;
}

export async function readVerifiedObservations(env: any, now = Date.now(), windowHours = 48, maxArchives = 8) {
 if(!Number.isSafeInteger(windowHours)||windowHours<1||windowHours>720)throw Error('Fenêtre physique non conforme');
 if(!Number.isSafeInteger(maxArchives)||maxArchives<1||maxArchives>24)throw Error('Limite de lecture physique non conforme');
 const result = await env.DB.prepare('SELECT object_key,MAX(received_at) AS last_received FROM weather_station_observations WHERE measured_at>=? AND measured_at<=? AND received_at<=? AND source=? GROUP BY object_key ORDER BY last_received DESC,object_key ASC LIMIT '+(maxArchives+1)).bind(now - windowHours * HOUR, now, now, source).all();
 if (!Array.isArray(result?.results)) throw Error('Lecture des lots indisponible');
 const rows: VerifiedObservation[] = []; let rejectedArchives = 0;
 for (const item of result.results.slice(0, maxArchives)) {
  try { rows.push(...(await verifyObservationArchive(item.object_key, env, now)).filter(row => row.measuredAt >= now - windowHours * HOUR && row.measuredAt <= now)); }
  catch { rejectedArchives++; }
 }
 return {rows, checkedArchives: Math.min(result.results.length, maxArchives), rejectedArchives, boundedRead: result.results.length > maxArchives};
}

/** Créneaux UTC terminés communs, sans référence spatiale, MAE, score ni qualification. */
export function countOverlappingHours(rows: Pick<VerifiedObservation,'flags'|'measuredAt'>[], forecasts: {receivedAt: number; validAt: number}[], now: number) {
 const physicalHours = new Set(rows.filter(row => !row.flags.length && row.measuredAt <= now && Math.floor(row.measuredAt / HOUR) * HOUR + HOUR <= now).map(row => Math.floor(row.measuredAt / HOUR) * HOUR));
 return new Set(forecasts.filter(forecast => Number.isFinite(forecast.receivedAt) && forecast.receivedAt <= forecast.validAt && forecast.validAt % HOUR === 0 && physicalHours.has(forecast.validAt)).map(forecast => forecast.validAt)).size;
}

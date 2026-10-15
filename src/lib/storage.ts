import type { Forecast, Observation, Place, Prediction, Verification } from '../types';

// Le stockage reste local à cet appareil. Une saturation ne bloque jamais la météo.
export function read<T>(key: string, fallback: T): T {
  try { const value = localStorage.getItem(`atmosphere:${key}`); return value ? JSON.parse(value) as T : fallback; } catch { return fallback; }
}
export function write(key: string, value: unknown) {
  try { localStorage.setItem(`atmosphere:${key}`, JSON.stringify(value)); } catch { /* Navigation privée ou quota atteint. */ }
}
export const DEFAULT_PLACE: Place = { id: 'hondeghem', name: 'Hondeghem', region: 'Nord, Hauts-de-France', lat: 50.756, lon: 2.522, elevation: 31 };
export function cachedForecast(place: Place) { return read<Forecast | null>(`weather:${place.id}`, null); }
export function saveForecast(forecast: Forecast) {
  write(`weather:${forecast.place.id}`, forecast);
  const now = Date.now();
  const previous = read<Prediction[]>(`predictions:${forecast.place.id}`, []).filter(p => p.hour.time > now - 31 * 86400000);
  const keys = new Set(previous.map(p => `${p.modelId}:${p.hour.time}`));
  // Une seule capture par modèle et échéance : elle ne peut pas être réécrite après coup.
  for (const m of forecast.models) {
    if (m.error) continue;
    for (const hour of m.hours) {
      const key = `${m.model.id}:${hour.time}`;
      if (hour.time > now + 3600000 && !keys.has(key)) {
        previous.push({ placeId: forecast.place.id, modelId: m.model.id, issuedAt: forecast.fetchedAt, hour });
        keys.add(key);
      }
    }
  }
  write(`predictions:${forecast.place.id}`, previous.slice(-22000));
}
export function addObservation(observation: Observation) {
  const observations = read<Observation[]>(`observations:${observation.placeId}`, []);
  const bucket = Math.floor(observation.time / 3600000);
  // Pas de double comptage d'une même heure, même si la page est actualisée.
  const filtered = observations.filter(o => Math.floor(o.time / 3600000) !== bucket);
  write(`observations:${observation.placeId}`, [...filtered, observation].filter(o => o.time > Date.now() - 31 * 86400000));
}
export function verifications(placeId: string): Verification[] {
  const predictions = read<Prediction[]>(`predictions:${placeId}`, []);
  const observations = read<Observation[]>(`observations:${placeId}`, []);
  return predictions.flatMap(prediction => {
    const observation = observations.find(o => Math.abs(o.time - prediction.hour.time) < 30 * 60000 && prediction.issuedAt <= o.time - 3600000);
    return observation ? [{ prediction, observation }] : [];
  });
}

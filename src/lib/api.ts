import type { Forecast, Hour, ModelForecast, Place, Station } from '../types';
import { distance, MODELS } from '../engine/fusion';

const variables: Record<Exclude<keyof Hour, 'time'>, string> = { temp: 'temperature_2m', feels: 'apparent_temperature', rain: 'precipitation', pop: 'precipitation_probability', wind: 'wind_speed_10m', gust: 'wind_gusts_10m', direction: 'wind_direction_10m', humidity: 'relative_humidity_2m', cloud: 'cloud_cover', pressure: 'pressure_msl', uv: 'uv_index', code: 'weather_code' };
async function json<T>(url: string, signal?: AbortSignal, fresh=false): Promise<T> {
  const response = await fetch(url, { cache:fresh?'reload':'default',signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(25000)]) : AbortSignal.timeout(25000) });
  if (!response.ok) throw new Error(response.status === 429 ? 'Limite de requêtes atteinte. Réessayez dans quelques minutes.' : `Le fournisseur météo répond ${response.status}.`);
  const data=await response.json();
  const cachedAt=response.headers.get('X-MeteoAI-Fetched-At');
  if(cachedAt&&data&&typeof data==='object')data.__fetchedAt=Number(cachedAt);
  return data as T;
}
interface OpenMeteo { __fetchedAt?: number; elevation: number; hourly: { time: number[]; [key: string]: (number | null)[] }; daily?: { time: number[]; sunrise: number[]; sunset: number[]; uv_index_max: (number | null)[] } }
export async function fetchForecast(place: Place, signal?: AbortSignal, onProgress?: (count: number) => void): Promise<Forecast> {
  const fetchedAt = Date.now(), models: ModelForecast[] = []; let reference: OpenMeteo | undefined;
  // Deux requêtes à la fois, pour respecter les limites du service gratuit.
  for (let offset = 0; offset < MODELS.length; offset += 2) {
    const batch = await Promise.all(MODELS.slice(offset, offset + 2).map(async model => {
      const params = new URLSearchParams({ latitude: String(place.lat), longitude: String(place.lon), hourly: Object.values(variables).join(','), models: model.id, forecast_days: '16', timezone: 'Europe/Paris', timeformat: 'unixtime' });
      if (model.reference) params.set('daily', 'sunrise,sunset,uv_index_max');
      try {
        const data = await json<OpenMeteo>(`https://api.open-meteo.com/v1/forecast?${params}`, signal, true);
        if (!data.hourly?.time?.length) throw new Error('Aucune échéance retournée.');
        if (model.reference) reference = data;
        const hours: Hour[] = data.hourly.time.map((time, i) => ({ time: time! * 1000, ...Object.fromEntries(Object.entries(variables).map(([key, apiKey]) => {
          const value = data.hourly[apiKey]?.[i]; return [key, typeof value === 'number' && Number.isFinite(value) ? value : null];
        })) } as Hour));
        return { model, hours, elevation: data.elevation, fetchedAt: data.__fetchedAt ?? fetchedAt } satisfies ModelForecast;
      } catch (error) {
        if (signal?.aborted) throw error;
        return { model, hours: [], elevation: 0, fetchedAt, error: error instanceof Error ? error.message : 'Source indisponible' } satisfies ModelForecast;
      }
    }));
    models.push(...batch); onProgress?.(models.length);
  }
  if (models.every(m => m.error)) throw new Error('Les sources météo sont inaccessibles. Vérifiez votre connexion puis réessayez.');
  const solar = reference?.daily?.time.map((time, i) => ({ date: new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris' }).format(time * 1000), sunrise: reference!.daily!.sunrise[i] * 1000, sunset: reference!.daily!.sunset[i] * 1000, uv: reference!.daily!.uv_index_max[i] })) ?? [];
  const actualFetchedAt=Math.min(...models.filter(m=>!m.error).map(m=>m.fetchedAt));
  return { place, models, fetchedAt: actualFetchedAt, solar, cached:fetchedAt-actualFetchedAt>60000 };
}

export async function searchPlaces(query: string, signal?: AbortSignal): Promise<Place[]> {
  const data = await json<{ results?: { id: number; name: string; admin1?: string; country?: string; latitude: number; longitude: number; elevation?: number }[] }>(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(query)}&count=6&language=fr&format=json`, signal);
  return (data.results ?? []).map(p => ({ id: `geo-${p.id}`, name: p.name, region: [p.admin1, p.country].filter(Boolean).join(', '), lat: p.latitude, lon: p.longitude, elevation: p.elevation }));
}
interface SenseBox { _id: string; name: string; exposure?: string; currentLocation?: { coordinates: number[] }; sensors?: { title: string; unit: string; lastMeasurement?: { value: string; createdAt: string } }[] }
async function fetchCitizenStations(place: Place, signal?: AbortSignal): Promise<Station[]> {
  const latDelta = 20 / 111, lonDelta = 20 / (111 * Math.cos(place.lat * Math.PI / 180));
  const bbox = [place.lon-lonDelta, place.lat-latDelta, place.lon+lonDelta, place.lat+latDelta].join(',');
  const boxes = await json<SenseBox[]>(`https://api.opensensemap.org/boxes?bbox=${bbox}&exposure=outdoor`, signal);
  return boxes.flatMap(box => {
    const sensor = box.sensors?.find(s => /temperature|temperatur|température/i.test(s.title) && /°?c/i.test(s.unit) && s.lastMeasurement);
    const coordinates = box.currentLocation?.coordinates;
    if (!sensor?.lastMeasurement || !coordinates) return [];
    const temp = Number(sensor.lastMeasurement.value), time = Date.parse(sensor.lastMeasurement.createdAt), km = distance(place.lat, place.lon, coordinates[1], coordinates[0]);
    if (!Number.isFinite(temp) || !Number.isFinite(time) || km > 20) return [];
    const minutes = (Date.now()-time) / 60000;
    return [{ id: box._id, name: box.name, lat: coordinates[1], lon: coordinates[0], elevation: coordinates[2] ?? null, temp, time, distance: km, reliability: Math.max(0, Math.min(95, 95 - Math.max(0, minutes-10) * .5)), source: 'OpenSenseMap', anomaly: temp < -45 || temp > 55 || minutes > 90 || minutes < -5, interval: null }];
  }).sort((a,b) => a.distance-b.distance);
}

async function fetchSynopStations(place:Place,signal?:AbortSignal):Promise<Station[]>{
  const where=`latitude>${place.lat-.3} AND latitude<${place.lat+.3} AND longitude>${place.lon-.5} AND longitude<${place.lon+.5}`;
  const params=new URLSearchParams({select:'numer_sta,nom,latitude,longitude,altitude,t,date',where,order_by:'date desc',limit:'50',timezone:'UTC'});
  const data=await json<{results:Record<string,unknown>[]}>(`https://public.opendatasoft.com/api/explore/v2.1/catalog/datasets/donnees-synop-essentielles-omm/records?${params}`,signal);
  const seen=new Set<string>(),stations:Station[]=[];
  for(const r of data.results??[]){
    const id=`mf-${r.numer_sta}`;if(seen.has(id))continue;seen.add(id);
    if(r.latitude==null||r.longitude==null||r.t==null||typeof r.date!=='string')continue;
    const lat=Number(r.latitude),lon=Number(r.longitude),temp=Number(r.t)-273.15,time=Date.parse(r.date),km=distance(place.lat,place.lon,lat,lon),age=(Date.now()-time)/60000;
    if(![lat,lon,temp,time,km].every(Number.isFinite)||km>20)continue;
    stations.push({id,name:String(r.nom??id),lat,lon,temp,time,distance:km,elevation:r.altitude==null?null:Number(r.altitude),reliability:Math.max(0,Math.min(95,95-Math.max(0,age-20)*.4)),source:'Météo-France · SYNOP',interval:60,anomaly:temp< -60||temp>60||age>120||age<0});
  }
  return stations;
}

export async function fetchStations(place:Place,signal?:AbortSignal):Promise<Station[]>{
  const results=await Promise.allSettled([fetchCitizenStations(place,signal),fetchSynopStations(place,signal)]);
  if(signal?.aborted)throw new DOMException('Collecte annulée','AbortError');
  const successful=results.filter((r):r is PromiseFulfilledResult<Station[]>=>r.status==='fulfilled');
  if(!successful.length)throw new Error('Les réseaux OpenSenseMap et SYNOP sont momentanément inaccessibles.');
  return successful.flatMap(r=>r.value).sort((a,b)=>a.distance-b.distance);
}

export async function fetchArchive(place: Place, days: number, signal?: AbortSignal) {
  // Réanalyse explicitement séparée des observations de station et des prévisions capturées.
  const end = new Date(Date.now()-5*86400000), start = new Date(end.getTime()-(days-1)*86400000);
  const date = (d: Date) => d.toISOString().slice(0,10);
  const params = new URLSearchParams({ latitude: String(place.lat), longitude: String(place.lon), start_date: date(start), end_date: date(end), daily: 'temperature_2m_max,temperature_2m_min,precipitation_sum', timezone: 'Europe/Paris' });
  const data = await json<{ daily: { time: string[]; temperature_2m_max: (number|null)[]; temperature_2m_min: (number|null)[]; precipitation_sum: (number|null)[] } }>(`https://archive-api.open-meteo.com/v1/archive?${params}`, signal);
  return data.daily.time.map((time,i) => ({ date: time, max: data.daily.temperature_2m_max[i], min: data.daily.temperature_2m_min[i], rain: data.daily.precipitation_sum[i] }));
}

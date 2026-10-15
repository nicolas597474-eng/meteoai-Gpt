import type { DayForecast, Forecast, FusedHour, Hour, Metric, Model, Regime, Scores, Station, Verification, Mode } from '../types';

export const MODELS: Model[] = [
  { id: 'meteofrance_arome_france', name: 'AROME', provider: 'Météo-France', resolution: '1,3 km', color: '#f2c69c' },
  { id: 'meteofrance_arpege_europe', name: 'ARPEGE', provider: 'Météo-France', resolution: '10 km', color: '#dfa991' },
  { id: 'icon_seamless', name: 'ICON', provider: 'DWD · Allemagne', resolution: '2–13 km', color: '#9acbc1' },
  { id: 'ecmwf_ifs025', name: 'ECMWF IFS', provider: 'Centre européen', resolution: '25 km', color: '#a8bde0' },
  { id: 'gfs_seamless', name: 'GFS', provider: 'NOAA · États-Unis', resolution: '13–25 km', color: '#b6b0dc' },
  { id: 'gem_seamless', name: 'GEM', provider: 'ECCC · Canada', resolution: '15–25 km', color: '#b6c897' },
  { id: 'ukmo_seamless', name: 'UKMET', provider: 'Met Office', resolution: '2–10 km', color: '#d7b8ce' },
  { id: 'best_match', name: 'Best Match', provider: 'Open-Meteo · référence', resolution: 'Variable', color: '#8da8b9', reference: true },
];
export const METRICS: Metric[] = ['temp', 'rain', 'wind', 'code', 'humidity', 'pressure'];
export const METRIC_LABELS: Record<Metric, string> = { temp: 'Température', rain: 'Précipitations', wind: 'Vent', code: 'Conditions', humidity: 'Humidité', pressure: 'Pression' };
export const BASE_DIMENSIONS: Record<Metric, number> = { temp: .3, rain: .25, wind: .2, code: .1, humidity: .08, pressure: .07 };
export function horizonBucket(milliseconds:number){const hours=milliseconds/3600000;return hours<=6?'0–6 h':hours<=24?'6–24 h':hours<=72?'1–3 j':hours<=168?'4–7 j':'8–16 j';}
const finite = (n: number | null | undefined): n is number => typeof n === 'number' && Number.isFinite(n);
export const mean = (values: (number | null | undefined)[]): number | null => { const v = values.filter(finite); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
const clamp = (v: number, min = 0, max = 100) => Math.max(min, Math.min(max, v));

/** Erreurs signées prévu − observé. POD/FAR/CSI : événement pluvieux ≥ 0,1 mm/h. */
export function scoreModel(records: Verification[], modelId: string, metric: Metric = 'temp'): Scores {
  const matched = records.filter(r => r.prediction.modelId === modelId && finite(r.prediction.hour[metric]) && finite(r.observation.values[metric])).sort((a,b) => a.observation.time - b.observation.time);
  const errors = matched.map(r => r.prediction.hour[metric]! - r.observation.values[metric]!);
  const rain = records.filter(r => r.prediction.modelId === modelId && finite(r.prediction.hour.rain) && finite(r.observation.values.rain));
  const hit = rain.filter(r => r.prediction.hour.rain! >= .1 && r.observation.values.rain! >= .1).length;
  const miss = rain.filter(r => r.prediction.hour.rain! < .1 && r.observation.values.rain! >= .1).length;
  const falseAlarm = rain.filter(r => r.prediction.hour.rain! >= .1 && r.observation.values.rain! < .1).length;
  const middle = Math.floor(errors.length / 2);
  const older = mean(errors.slice(0, middle).map(Math.abs));
  const recent = mean(errors.slice(middle).map(Math.abs));
  return {
    n: errors.length, mae: mean(errors.map(Math.abs)), rmse: errors.length ? Math.sqrt(mean(errors.map(e => e * e))!) : null, bias: mean(errors),
    pod: hit + miss ? hit / (hit + miss) : null, far: hit + falseAlarm ? falseAlarm / (hit + falseAlarm) : null,
    csi: hit + miss + falseAlarm ? hit / (hit + miss + falseAlarm) : null,
    trend: errors.length >= 12 && older != null && recent != null ? recent - older : null,
  };
}

const regimeDefinitions = [
  ['fair', 'Éclaircies', 'sun', 'Air stable, alternance de soleil et de nuages.', { temp: .42, rain: .12, wind: .13, code: .14, humidity: .1, pressure: .09 }],
  ['overcast', 'Ciel couvert', 'cloud', 'Couverture nuageuse dominante et lumière diffuse.', { temp: .3, rain: .2, wind: .15, code: .2, humidity: .08, pressure: .07 }],
  ['oceanic', 'Flux océanique', 'waves', 'Air humide porté par un vent d’ouest.', { temp: .22, rain: .26, wind: .26, code: .1, humidity: .08, pressure: .08 }],
  ['rain', 'Pluie continue', 'rain', 'Précipitations installées sur plusieurs heures.', { temp: .15, rain: .4, wind: .16, code: .12, humidity: .1, pressure: .07 }],
  ['showers', 'Averses', 'rain', 'Pluie intermittente : fortes variations locales possibles.', { temp: .18, rain: .4, wind: .2, code: .1, humidity: .07, pressure: .05 }],
  ['storm', 'Orageux', 'storm', 'Convection orageuse et rafales possibles.', { temp: .12, rain: .32, wind: .28, code: .18, humidity: .05, pressure: .05 }],
  ['wind', 'Venteux', 'wind', 'Le vent et ses rafales deviennent déterminants.', { temp: .15, rain: .17, wind: .42, code: .1, humidity: .06, pressure: .1 }],
  ['fog', 'Brume & brouillard', 'fog', 'Humidité élevée et faible brassage de l’air.', { temp: .25, rain: .08, wind: .18, code: .2, humidity: .24, pressure: .05 }],
  ['frost', 'Gel', 'snow', 'Températures proches ou sous zéro.', { temp: .5, rain: .12, wind: .12, code: .08, humidity: .12, pressure: .06 }],
  ['snow', 'Neige', 'snow', 'La limite pluie-neige impose une vigilance thermique.', { temp: .35, rain: .32, wind: .12, code: .12, humidity: .05, pressure: .04 }],
  ['heat', 'Chaleur', 'sun', 'Chaleur marquée et exposition solaire.', { temp: .5, rain: .1, wind: .13, code: .12, humidity: .1, pressure: .05 }],
  ['continental', 'Flux continental', 'compass', 'Air d’est, souvent plus sec et contrasté.', { temp: .4, rain: .12, wind: .2, code: .1, humidity: .1, pressure: .08 }],
] as const;

/** Détecteur explicable : influences simultanées, normalisées à 100 %. */
export function detectRegimes(hour: Hour): Regime[] {
  const t = hour.temp ?? 12, p = hour.rain ?? 0, w = hour.wind ?? 0, c = hour.cloud ?? 50, h = hour.humidity ?? 70, code = hour.code ?? 3, d = hour.direction ?? 180;
  const strengths = [
    Math.max(.05, (100 - c) / 100) * (p < .1 ? 1 : .1), c / 100 * (p < .3 ? .8 : .3),
    d > 210 && d < 310 ? Math.min(1, w / 25) * h / 100 : .02,
    p >= .2 && code >= 51 && code <= 67 ? Math.min(1.8, p / 2) : 0,
    code >= 80 && code <= 82 ? 1.6 : p > .1 ? .15 : 0,
    code >= 95 ? 2 : 0, w > 18 ? Math.min(2, (w - 18) / 25) : 0,
    code === 45 || code === 48 ? 1.8 : h > 94 && w < 8 ? .8 : 0,
    t < 3 ? Math.min(2, (3 - t) / 5) : 0,
    code >= 71 && code <= 77 || code === 85 || code === 86 ? 2 : 0,
    t > 26 ? Math.min(2, (t - 26) / 7) : 0,
    d >= 35 && d <= 120 ? .6 * (1 - h / 150) : .02,
  ];
  const total = strengths.reduce((a, b) => a + b, 0) || 1;
  return regimeDefinitions.map((r, i) => ({ id: r[0], name: r[1], icon: r[2], description: r[3], dimensions: { ...r[4] }, influence: strengths[i] / total * 100 })).sort((a, b) => b.influence - a.influence);
}
export function blendedDimensions(regimes: Regime[]): Record<Metric, number> {
  return Object.fromEntries(METRICS.map(key => [key, regimes.reduce((sum, r) => sum + r.dimensions[key] * r.influence / 100, 0)])) as Record<Metric, number>;
}

export function modelWeights(modelIds: string[], records: Verification[], regimes: Regime[]): Record<string, Record<Metric, number>> {
  const weights: Record<string, Record<Metric, number>> = Object.fromEntries(modelIds.map(id => [id, { ...BASE_DIMENSIONS }]));
  const dimensions = blendedDimensions(regimes);
  for (const metric of METRICS) {
    const metrics = modelIds.map(id => scoreModel(records, id, metric));
    // Une comparaison fiable demande des observations pour TOUS les modèles présents.
    const calibrated = metrics.every((s,i) => {
      const matched=records.filter(r=>r.prediction.modelId===modelIds[i]&&finite(r.observation.values[metric])&&finite(r.prediction.hour[metric]));
      const days=new Set(matched.map(r=>parisDate(r.observation.time)));
      const latest=Math.max(0,...matched.map(r=>r.observation.time));
      return s.n>=30&&days.size>=30&&s.mae!=null&&Date.now()-latest<=7*86400000;
    });
    const raw = metrics.map(s => calibrated ? 1 / Math.max(s.mae!, .05) : 1);
    const total = raw.reduce((a,b) => a+b, 0) || 1;
    const normalized=raw.map(r=>r/total),cap=Math.max(.35,1/Math.max(1,modelIds.length));
    if(calibrated){
      const locked=new Set<number>();
      for(let pass=0;pass<modelIds.length;pass++){
        const excessive=normalized.map((v,i)=>v>cap+1e-10&&!locked.has(i)?i:-1).filter(i=>i>=0);
        if(!excessive.length)break;
        excessive.forEach(i=>{normalized[i]=cap;locked.add(i);});
        const remaining=1-locked.size*cap,freeTotal=normalized.reduce((sum,v,i)=>sum+(locked.has(i)?0:v),0);
        normalized.forEach((_,i)=>{if(!locked.has(i))normalized[i]=freeTotal?normalized[i]/freeTotal*remaining:remaining/(modelIds.length-locked.size);});
      }
    }
    modelIds.forEach((id, i) => { weights[id][metric] = normalized[i]; });
  }
  // Les dimensions servent au classement blended ; les variables gardent leurs propres poids.
  void dimensions;
  return weights;
}

export function fuseForecast(forecast: Forecast, records: Verification[]): FusedHour[] {
  const reference = forecast.models.find(m => m.model.reference && !m.error);
  const times = [...new Set(forecast.models.flatMap(m => m.hours.map(h => h.time)))].sort((a,b) => a-b);
  const lookup = new Map(forecast.models.map(m => [m.model.id, new Map(m.hours.map(h => [h.time, h]))]));
  const weightCache=new Map<string,Record<string,Record<Metric,number>>>();
  return times.map(time => {
    const available = forecast.models.filter(m => !m.model.reference && !m.error && finite(lookup.get(m.model.id)?.get(time)?.temp));
    const models = available.length ? available : reference ? [reference] : [];
    const initial: Hour = reference ? lookup.get(reference.model.id)?.get(time) ?? emptyHour(time) : models.length ? lookup.get(models[0].model.id)!.get(time)! : emptyHour(time);
    const regimes = detectRegimes(initial);
    const horizonBand=horizonBucket(Math.max(0,time-forecast.fetchedAt));
    const weightKey=models.map(m=>m.model.id).join(',')+horizonBand;
    let weights=weightCache.get(weightKey);
    if(!weights){weights=modelWeights(models.map(m=>m.model.id),records.filter(r=>horizonBucket(r.prediction.hour.time-r.prediction.issuedAt)===horizonBand),regimes);weightCache.set(weightKey,weights);}
    const values = models.map(m => ({ id: m.model.id, hour: lookup.get(m.model.id)!.get(time)! }));
    const weighted = (field: keyof Omit<Hour,'time'>, metric: Metric) => {
      const valid = values.filter(v => finite(v.hour[field]));
      const total = valid.reduce((s,v) => s + weights[v.id][metric], 0);
      return total ? valid.reduce((s,v) => s + v.hour[field]! * weights[v.id][metric], 0) / total : initial[field] ?? null;
    };
    const temp = weighted('temp','temp');
    const temperatures = values.map(v => v.hour.temp).filter(finite);
    const spread = temperatures.length >= 2 ? Math.max(...temperatures) - Math.min(...temperatures) : null;
    // Moyenne circulaire : 359° et 1° donnent 0°, jamais 180°.
    const directionValues = values.filter(v => finite(v.hour.direction));
    const direction = directionValues.length ? (Math.atan2(directionValues.reduce((s,v) => s + Math.sin(v.hour.direction! * Math.PI / 180) * weights[v.id].wind, 0), directionValues.reduce((s,v) => s + Math.cos(v.hour.direction! * Math.PI / 180) * weights[v.id].wind, 0)) * 180 / Math.PI + 360) % 360 : initial.direction;
    const codes = new Map<number, number>();
    values.forEach(v => { if (finite(v.hour.code)) codes.set(v.hour.code, (codes.get(v.hour.code) ?? 0) + weights[v.id].code); });
    const code = [...codes.entries()].sort((a,b) => b[1]-a[1])[0]?.[0] ?? initial.code;
    const horizon = Math.max(0, (time - forecast.fetchedAt) / 86400000);
    const stability = spread == null ? 0 : clamp(100 - spread * 12);
    const confidence = clamp((spread == null ? 35 : 95 - spread * 8) * Math.min(1, available.length / 5) - horizon * 2, available.length ? 10 : 5, 98);
    return { time, temp, feels: weighted('feels','temp'), rain: weighted('rain','rain'), pop: weighted('pop','rain'), wind: weighted('wind','wind'), gust: weighted('gust','wind'), direction, humidity: weighted('humidity','humidity'), cloud: weighted('cloud','code'), pressure: weighted('pressure','pressure'), uv: weighted('uv','code'), code, tempSpread: spread, contributors: available.length, confidence, stability, weights };
  });
}
export function emptyHour(time: number): Hour { return { time, temp: null, feels: null, rain: null, pop: null, wind: null, gust: null, direction: null, humidity: null, cloud: null, pressure: null, uv: null, code: null }; }

const parisDateFormatter=new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit' });
export function parisDate(time: number) { return parisDateFormatter.format(time); }
export function dailyForecast(hours: FusedHour[], forecast: Forecast): DayForecast[] {
  const grouped=new Map<string,FusedHour[]>();
  for(const hour of hours){const date=parisDate(hour.time);if(!grouped.has(date))grouped.set(date,[]);grouped.get(date)!.push(hour);}
  return [...grouped.entries()].map(([date,data]) => {
    const temps = data.map(h => h.temp).filter(finite), rains = data.map(h => h.rain).filter(finite), winds = data.map(h => h.wind).filter(finite), uvs = data.map(h => h.uv).filter(finite);
    const solar = forecast.solar.find(s => s.date === date);
    const codes = data.map(h => h.code).filter(finite);
    const freq = new Map<number, number>(); codes.forEach(c => freq.set(c, (freq.get(c) ?? 0) + 1));
    return { date, max: temps.length ? Math.max(...temps) : null, min: temps.length ? Math.min(...temps) : null, rain: rains.length ? rains.reduce((a,b) => a+b,0) : null, wind: winds.length ? Math.max(...winds) : null, humidity: mean(data.map(h => h.humidity)), uv: solar?.uv ?? (uvs.length ? Math.max(...uvs) : null), code: [...freq.entries()].sort((a,b) => b[1]-a[1])[0]?.[0] ?? null, stability: mean(data.map(h => h.stability)) ?? 0, contributors: Math.round(mean(data.map(h => h.contributors)) ?? 0), sunrise: solar?.sunrise ?? null, sunset: solar?.sunset ?? null };
  });
}

/** Distances orthodromiques en km, utiles aux quatre bandes ultra-locales. */
export function distance(lat1: number, lon1: number, lat2: number, lon2: number) {
  const r = Math.PI / 180, a = Math.sin((lat2-lat1)*r/2)**2 + Math.cos(lat1*r)*Math.cos(lat2*r)*Math.sin((lon2-lon1)*r/2)**2;
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}
export const BANDS = [{ label: '< 2 km', min: 0, max: 2, factor: 1 }, { label: '2–5 km', min: 2, max: 5, factor: .65 }, { label: '5–10 km', min: 5, max: 10, factor: .35 }, { label: '10–20 km', min: 10, max: 20, factor: .15 }];
export function localAdjustment(stations: Station[], current: Hour, mode: Mode, elevation?: number) {
  const sorted=stations.filter(s=>!s.anomaly).map(s=>s.temp).sort((a,b)=>a-b),median=sorted.length?sorted[Math.floor(sorted.length/2)]:null;
  const deviations=median==null?[]:sorted.map(t=>Math.abs(t-median)).sort((a,b)=>a-b),mad=deviations.length?deviations[Math.floor(deviations.length/2)]:0;
  const freshness=mode==='ultra-local'?30:60;
  const accepted = mode==='standard'?[]:stations.filter(s => !s.anomaly && s.distance <= 20 && Date.now()>=s.time && Date.now() - s.time < freshness * 60000 && (median==null||Math.abs(s.temp-median)<=Math.max(3,3*mad)));
  const inverseDistance=accepted.map(s=>1/Math.max(.5,s.distance)**2),idwSum=inverseDistance.reduce((a,b)=>a+b,0)||1;
  const raw = accepted.map((s,i) => ({ station: s, weight: (BANDS.find(b => s.distance >= b.min && s.distance < b.max)?.factor ?? .15) * (.5*inverseDistance[i]/idwSum+.3*s.reliability/100+.2*Math.exp(-(Date.now()-s.time)/3600000)) }));
  const total = raw.reduce((sum,s) => sum+s.weight,0);
  const contributors = raw.map(s => ({ ...s, weight: s.weight / (total || 1), corrected: s.station.temp + (elevation != null && s.station.elevation != null ? -.0065 * (elevation-s.station.elevation) : 0) }));
  const stationTemp = contributors.length ? contributors.reduce((sum,s) => sum+s.corrected*s.weight,0) : null;
  const correction = mode === 'standard' || stationTemp == null || current.temp == null ? 0 : clamp((stationTemp-current.temp) * (mode === 'ultra-local' ? .7 : .4), -3, 3);
  return { correction, stationTemp, contributors, altitudeKnown: elevation != null, applied: mode !== 'standard' && contributors.length > 0 };
}

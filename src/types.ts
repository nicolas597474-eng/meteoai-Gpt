export type Metric = 'temp' | 'rain' | 'wind' | 'humidity' | 'pressure' | 'code';
export type Mode = 'standard' | 'local' | 'ultra-local';
export type Page = 'weather' | 'forecast' | 'ranking' | 'lab' | 'history' | 'stations';
export interface Place { id: string; name: string; region: string; lat: number; lon: number; elevation?: number }
export interface Hour { time: number; temp: number | null; feels: number | null; rain: number | null; pop: number | null; wind: number | null; gust: number | null; direction: number | null; humidity: number | null; cloud: number | null; pressure: number | null; uv: number | null; code: number | null }
export interface Model { id: string; name: string; provider: string; resolution: string; color: string; reference?: boolean }
export interface ModelForecast { model: Model; hours: Hour[]; elevation: number; fetchedAt: number; error?: string }
export interface Forecast { place: Place; models: ModelForecast[]; fetchedAt: number; solar: { date: string; sunrise: number; sunset: number; uv: number | null }[]; cached?: boolean }
export interface Scores { n: number; mae: number | null; rmse: number | null; bias: number | null; pod: number | null; far: number | null; csi: number | null; trend: number | null }
export interface Regime { id: string; name: string; icon: string; description: string; influence: number; dimensions: Record<Metric, number> }
export interface FusedHour extends Hour { tempSpread: number | null; contributors: number; confidence: number; stability: number; weights: Record<string, Record<Metric, number>> }
export interface Station { id: string; name: string; lat: number; lon: number; elevation: number | null; temp: number; time: number; distance: number; reliability: number; source: string; anomaly: boolean; interval: number | null }
export interface Prediction { placeId: string; modelId: string; issuedAt: number; hour: Hour }
export interface Observation { id: string; placeId: string; time: number; values: Partial<Record<Metric, number>>; source: string }
export interface Verification { prediction: Prediction; observation: Observation }
export interface DayForecast { date: string; max: number | null; min: number | null; rain: number | null; wind: number | null; humidity: number | null; uv: number | null; code: number | null; stability: number; contributors: number; sunrise: number | null; sunset: number | null }

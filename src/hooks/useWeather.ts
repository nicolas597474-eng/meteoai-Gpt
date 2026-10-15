import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Forecast, Mode, Place, Station } from '../types';
import { fetchForecast, fetchStations } from '../lib/api';
import { addObservation, cachedForecast, read, saveForecast, verifications, write } from '../lib/storage';
import { dailyForecast, fuseForecast, localAdjustment, mean } from '../engine/fusion';

export function useWeather(place: Place, mode: Mode) {
  const [forecast, setForecast] = useState<Forecast|null>(() => cachedForecast(place));
  const [loading, setLoading] = useState(false), [progress,setProgress] = useState(0), [error,setError] = useState('');
  const [stationState,setStationState] = useState<{placeId:string;items:Station[];error:string;loading:boolean}>({placeId:place.id,items:[],error:'',loading:true});
  const [revision,setRevision] = useState(0), [refresh,setRefresh] = useState(0), [online,setOnline] = useState(navigator.onLine);
  useEffect(() => { const on = () => {setOnline(true);setRefresh(r=>r+1);}, off = () => setOnline(false); window.addEventListener('online',on); window.addEventListener('offline',off); return () => {window.removeEventListener('online',on);window.removeEventListener('offline',off);}; },[]);
  useEffect(() => {
    const controller = new AbortController(); const cached = cachedForecast(place); setForecast(cached); setError('');setProgress(0);
    const load = async () => {
      if (!navigator.onLine) {setLoading(false);return;}
      if (cached && Date.now()-cached.fetchedAt < 15*60000 && !refresh) return;
      setLoading(true);
      try { const data = await fetchForecast(place,controller.signal,setProgress); if (!controller.signal.aborted) {saveForecast(data);setForecast(data);setRevision(r=>r+1);} }
      catch(e) { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : 'Connexion impossible.'); }
      finally {if (!controller.signal.aborted) setLoading(false);}
    };
    void load(); const timer = setInterval(() => setRefresh(r=>r+1),30*60000);
    return () => {controller.abort();clearInterval(timer);};
  },[place.id,refresh]);
  useEffect(() => {
    const controller = new AbortController();
    setStationState({placeId:place.id,items:read<Station[]>(`stations:${place.id}`,[]),error:'',loading:true});
    if (!online) {setStationState(s=>({...s,loading:false}));return;}
    fetchStations(place,controller.signal).then(items => {
      if (controller.signal.aborted) return;
      write(`stations:${place.id}`,items);setStationState({placeId:place.id,items,error:'',loading:false});
      const nearby = items.filter(s=>!s.anomaly&&s.distance<2&&Date.now()-s.time<30*60000&&s.time<=Date.now());
      if (nearby.length) {
        // Une seule vérité terrain agrégée pour l'heure ; stations éloignées exclues.
        const temp = mean(nearby.map(s=>s.temp));
        if (temp != null) {addObservation({id:`station-${Math.floor(Date.now()/3600000)}`,placeId:place.id,time:Math.max(...nearby.map(s=>s.time)),values:{temp},source:`Stations OpenSenseMap < 2 km (${nearby.length})`});setRevision(r=>r+1);}
      }
    }).catch(e=> {if(!controller.signal.aborted)setStationState(s=>({...s,error:e instanceof Error?e.message:'Stations indisponibles',loading:false}));});
    return ()=>controller.abort();
  },[place.id,online,refresh]);
  const records = useMemo(()=>verifications(place.id),[place.id,revision]);
  const validForecast = forecast?.place.id === place.id ? forecast : null;
  const hours = useMemo(()=>validForecast?fuseForecast(validForecast,records):[],[validForecast,records]);
  const now = Date.now();
  const currentIndex = hours.findIndex(h=>h.time>=now-30*60000), current = hours[Math.max(0,currentIndex)] ?? null;
  const next24 = hours.slice(Math.max(0,currentIndex),Math.max(0,currentIndex)+24);
  const stations = stationState.placeId===place.id?stationState.items:[];
  const adjustment = useMemo(()=>current?localAdjustment(stations,current,mode,place.elevation):null,[stations,current,mode,place.elevation]);
  const localCurrent = current && adjustment ? {...current,temp:current.temp==null?null:current.temp+adjustment.correction,feels:current.feels==null?null:current.feels+adjustment.correction}:current;
  const days = useMemo(()=>validForecast?dailyForecast(hours,validForecast):[],[hours,validForecast]);
  const refreshData=useCallback(()=>setRefresh(r=>r+1),[]);
  const refreshRecords=useCallback(()=>setRevision(r=>r+1),[]);
  return {forecast:validForecast,current:localCurrent,modelCurrent:current,hours,next24,days,records,stations,stationError:stationState.error,stationLoading:stationState.loading,adjustment,loading,progress,error,online,refreshData,refreshRecords};
}
export type WeatherState = ReturnType<typeof useWeather>;

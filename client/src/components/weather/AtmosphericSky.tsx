import {useEffect} from 'react';
import './AtmosphericSky.css';

/** Ciel fixe partagé : aucun canvas, calcul météo ou travail d'animation. */
export function AtmosphericSky(){
 useEffect(()=>{
  document.documentElement.dataset.liveWeatherSky='true';
  return ()=>{delete document.documentElement.dataset.liveWeatherSky;};
 },[]);
 return <div className="atmospheric-sky" aria-hidden="true" data-motion="static" />;
}

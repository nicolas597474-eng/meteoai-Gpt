import {getLocalEclipseCircumstances} from '../../../server/eclipseVisibility';
import {getEnvironmentalSnapshot,getApparentAstronomyPosition,getTerrainHorizonProfile} from '../../../server/environmentalData';
import {publicEnvironmentalCache} from './publicEnvironmentalCache';
/** Calculs et collecte publics hors du fil d’interface ; aucun secret ni donnée Netatmo. */
self.onmessage=async(event:MessageEvent<{id:number;coords:{lat:number;lon:number};online:boolean;method?:string;eventId?:string}>)=>{
 const {id,coords,online,method,eventId}=event.data;
 try{const data=method==='position'?getApparentAstronomyPosition(coords):method==='terrain'?await getTerrainHorizonProfile(coords):method==='eclipse'?getLocalEclipseCircumstances({...coords,eventId:eventId??''}):await getEnvironmentalSnapshot(coords,{online,jsonCache:publicEnvironmentalCache});self.postMessage({id,data});}
 catch(error){self.postMessage({id,error:error instanceof Error?error.message:'Données environnementales indisponibles.'});}
};

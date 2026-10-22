import {useEffect,useState} from 'react';
import {nearestPopulation,type LandscapeLocation} from '@/lib/landscapeScene';
import {publicGeography} from '@/lib/publicGeography';
const cache=new Map<string,{until:number;value:number|null}>(),pending=new Map<string,Promise<number|null>>();
/** Métadonnée de décor uniquement : recherche publique conservée sept jours sur l'appareil. */
export function useLandscapePopulation(location:LandscapeLocation){
 const key=`${location.name}/${location.lat}/${location.lon}`;
 const [result,setResult]=useState<{key:string;value:number|null}|null>(null);
 useEffect(()=>{
  if(location.name.length<2)return;
  let mounted=true;const cached=cache.get(key);
  if(cached&&cached.until>Date.now()){setResult({key,value:cached.value});return;}
  let task=pending.get(key);
  if(!task){task=(async()=>{
   let value:number|null=null,success=false;
   try{value=nearestPopulation(await publicGeography.search(location.name,10),location);success=true;}catch{}
   if(cache.size>=64)cache.delete(cache.keys().next().value!);cache.set(key,{value,until:Date.now()+(success?86400000:300000)});return value;
  })();pending.set(key,task);void task.finally(()=>pending.delete(key));}
  void task.then(value=>{if(mounted)setResult({key,value});});return()=>{mounted=false;};
 },[key,location.name,location.lat,location.lon]);
 return result?.key===key?result.value:null;
}

import {useEffect,useState} from 'react';
/** Actualise les âges sans réseau ; aucun minuteur ne tourne dans un onglet masqué. */
export function useVisibleClock(){
 const [now,setNow]=useState(Date.now);
 useEffect(()=>{
  let timer:ReturnType<typeof setInterval>|undefined;
  const update=()=>{if(timer)clearInterval(timer);timer=undefined;if(document.visibilityState==='visible'){setNow(Date.now());timer=setInterval(()=>setNow(Date.now()),60000);}};
  update();document.addEventListener('visibilitychange',update);
  return ()=>{if(timer)clearInterval(timer);document.removeEventListener('visibilitychange',update);};
 },[]);
 return now;
}

import {useCallback,useEffect,useRef,useState} from 'react';
import {createVoiceDictation,voiceConstructor,type VoiceState} from './voice';
export function useVoiceQuestion(onText:(text:string)=>void){
 const [available,setAvailable]=useState(false),[state,setState]=useState<VoiceState>({listening:false,interim:'',message:''});
 const control=useRef<ReturnType<typeof createVoiceDictation>|null>(null);
 useEffect(()=>{
  const Constructor=voiceConstructor(window);setAvailable(!!Constructor);
  if(!Constructor)return;
  let mounted=true;
  const dictation=createVoiceDictation(Constructor,onText,value=>{if(mounted)setState(value);});control.current=dictation;
  const onVisibility=()=>{if(document.hidden)dictation.cancel();};
  document.addEventListener('visibilitychange',onVisibility);
  return()=>{mounted=false;dictation.cancel();control.current=null;document.removeEventListener('visibilitychange',onVisibility);};
 },[onText]);
 const start=useCallback(()=>control.current?.start(),[]),stop=useCallback(()=>control.current?.stop(),[]),cancel=useCallback(()=>control.current?.cancel(),[]);
 return {...state,available,start,stop,cancel};
}

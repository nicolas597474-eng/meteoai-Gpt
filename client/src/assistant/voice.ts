export type VoiceState={listening:boolean;interim:string;message:string};
type Result={isFinal:boolean;0:{transcript:string}};
export type Recognition={lang:string;continuous:boolean;interimResults:boolean;maxAlternatives:number;onresult:((event:{results:ArrayLike<Result>})=>void)|null;onerror:((event:{error:string})=>void)|null;onend:(()=>void)|null;start:()=>void;stop:()=>void;abort:()=>void};
export type RecognitionConstructor=new()=>Recognition;
export function voiceConstructor(host:unknown):RecognitionConstructor|null{
 const value=host as {SpeechRecognition?:RecognitionConstructor;webkitSpeechRecognition?:RecognitionConstructor}|null;
 const constructor=value?.SpeechRecognition??value?.webkitSpeechRecognition;
 return typeof constructor==='function'?constructor:null;
}
const idle:VoiceState={listening:false,interim:'',message:''};
const errors:Record<string,string>={
 'not-allowed':'L’accès au micro a été refusé. Vous pouvez l’autoriser dans votre navigateur ou saisir votre question.',
 'service-not-allowed':'La dictée n’est pas autorisée par ce navigateur. Vous pouvez utiliser le micro de votre clavier.',
 'audio-capture':'Aucun microphone accessible. Vérifiez le micro ou saisissez votre question.',
 'no-speech':'Je n’ai pas entendu de question. Vous pouvez recommencer ou écrire votre question.',
 network:'La reconnaissance vocale n’a pas abouti. Vérifiez la connexion ou utilisez le clavier.',
};
/** Dictée seulement : aucun envoi de question, aucun appel météo ou Gemini. */
export function createVoiceDictation(Constructor:RecognitionConstructor,onText:(text:string)=>void,onState:(state:VoiceState)=>void){
 let active:Recognition|null=null,timer:ReturnType<typeof setTimeout>|undefined,stopTimer:ReturnType<typeof setTimeout>|undefined,heard=false;
 function release(abort=false){const previous=active;active=null;clearTimeout(timer);clearTimeout(stopTimer);if(previous){previous.onresult=null;previous.onerror=null;previous.onend=null;if(abort)try{previous.abort();}catch{/* Déjà arrêté par le navigateur. */}}}
 function cancel(){release(true);onState({...idle});}
 function stop(){const recognition=active;if(!recognition)return;try{recognition.stop();clearTimeout(stopTimer);if(active===recognition)stopTimer=setTimeout(()=>{release(true);onState({...idle,message:heard?'Question dictée. Relisez-la puis envoyez-la.':'Dictée arrêtée. Vous pouvez écrire votre question.'});},2000);}catch{cancel();}}
 function start(){
  if(active)return;
  heard=false;
  try{
   const recognition=new Constructor();active=recognition;
   recognition.lang='fr-FR';recognition.continuous=false;recognition.interimResults=true;recognition.maxAlternatives=1;
   recognition.onresult=event=>{
    if(active!==recognition)return;
    const results=Array.from(event.results),final=results.filter(r=>r.isFinal).map(r=>r[0]?.transcript??'').join(' ').trim(),interim=results.filter(r=>!r.isFinal).map(r=>r[0]?.transcript??'').join(' ').trim();
    if(final){heard=true;onText(final.slice(0,600));}
    onState({listening:true,interim:interim.slice(0,600),message:'Je vous écoute…'});
    if(final.length>=600)stop();
   };
   recognition.onerror=event=>{if(active!==recognition)return;release(true);onState({...idle,message:errors[event.error]??'La dictée s’est interrompue. Vous pouvez recommencer ou écrire votre question.'});};
   recognition.onend=()=>{if(active!==recognition)return;release();onState({...idle,message:heard?'Question dictée. Relisez-la puis envoyez-la.':'Aucune question reconnue. Vous pouvez recommencer ou utiliser le clavier.'});};
   onState({...idle,listening:true,message:'Autorisez le micro si votre navigateur le demande, puis parlez.'});
   recognition.start();
   if(active===recognition)timer=setTimeout(stop,45000);
  }catch{release(true);onState({...idle,message:'Impossible de démarrer la dictée dans ce navigateur. Vous pouvez utiliser le micro du clavier ou écrire votre question.'});}
 }
 return {start,stop,cancel};
}

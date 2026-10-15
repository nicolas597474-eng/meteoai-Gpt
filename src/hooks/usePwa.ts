import { useEffect, useState } from 'react';
interface InstallEvent extends Event { prompt: () => Promise<void>; userChoice: Promise<{outcome:string}> }
export function usePwa() {
  const [install,setInstall]=useState<InstallEvent|null>(null), [update,setUpdate]=useState<ServiceWorker|null>(null), [standalone,setStandalone]=useState(matchMedia('(display-mode: standalone)').matches);
  useEffect(()=>{
    const capture=(e:Event)=>{e.preventDefault();setInstall(e as InstallEvent);};
    const installed=()=>{setInstall(null);setStandalone(true);};
    window.addEventListener('beforeinstallprompt',capture);window.addEventListener('appinstalled',installed);
    if(import.meta.env.PROD&&'serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').then(reg=>{
      if(reg.waiting)setUpdate(reg.waiting);
      reg.addEventListener('updatefound',()=>{const worker=reg.installing;worker?.addEventListener('statechange',()=>{if(worker.state==='installed'&&navigator.serviceWorker.controller)setUpdate(worker);});});
    }).catch(()=>{});
    return()=>{window.removeEventListener('beforeinstallprompt',capture);window.removeEventListener('appinstalled',installed);};
  },[]);
  const installApp=async()=>{if(install){await install.prompt();if((await install.userChoice).outcome==='accepted')setInstall(null);return true;}return false;};
  const applyUpdate=()=>{if(!update)return;navigator.serviceWorker.addEventListener('controllerchange',()=>location.reload(),{once:true});update.postMessage({type:'SKIP_WAITING'});};
  return {canInstall:!!install,standalone,installApp,update,applyUpdate};
}

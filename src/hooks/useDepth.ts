import { useEffect } from 'react';
// Déplacement borné et calculé une fois par frame, uniquement avec une souris.
export function useDepth(){
  useEffect(()=>{
    if(!matchMedia('(hover: hover) and (pointer: fine)').matches||matchMedia('(prefers-reduced-motion: reduce)').matches)return;
    let card:HTMLElement|null=null,frame=0;
    const clear=()=>{if(card){card.style.removeProperty('--tilt-x');card.style.removeProperty('--tilt-y');}card=null;};
    const move=(e:PointerEvent)=>{cancelAnimationFrame(frame);const target=e.target instanceof Element?e.target.closest<HTMLElement>('.hero-panel,.intelligence-panel,.metric-card'):null;if(card!==target)clear();card=target;if(!target)return;const x=e.clientX,y=e.clientY;frame=requestAnimationFrame(()=>{const r=target.getBoundingClientRect();target.style.setProperty('--tilt-x',`${-(y-r.top-r.height/2)/r.height*.7}deg`);target.style.setProperty('--tilt-y',`${(x-r.left-r.width/2)/r.width*.7}deg`);});};
    const leave=()=>{cancelAnimationFrame(frame);clear();};
    window.addEventListener('pointermove',move,{passive:true});document.addEventListener('pointerleave',leave);
    return()=>{cancelAnimationFrame(frame);clear();window.removeEventListener('pointermove',move);document.removeEventListener('pointerleave',leave);};
  },[]);
}

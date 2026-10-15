import { useEffect, useRef } from 'react';
import type { FusedHour } from '../types';
import { weatherKind } from '../lib/format';

export function Atmosphere({current}:{current:FusedHour|null}) {
  const canvas=useRef<HTMLCanvasElement>(null);
  const parisHour=Number(new Intl.DateTimeFormat('en-GB',{hour:'2-digit',hourCycle:'h23',timeZone:'Europe/Paris'}).format(Date.now()));
  const period=parisHour<6||parisHour>=21?'night':parisHour<9?'dawn':parisHour>=18?'dusk':'day';
  const kind=weatherKind(current?.code??null);
  const season=Math.floor(((new Date().getMonth()+1)%12)/3);
  useEffect(()=>{
    const target=canvas.current;if(!target)return;
    const ctx=target.getContext('2d');if(!ctx)return;
    const reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;let frame=0,active=true,previous=0;
    const resize=()=>{target.width=innerWidth;target.height=innerHeight;};resize();window.addEventListener('resize',resize);
    const rain=kind==='rain'||kind==='storm';
    const particles=Array.from({length:rain?55:42},(_,i)=>({x:((i*761)%1000)/1000,y:((i*479)%1000)/1000,size:.5+(i%3)*.4,speed:.00002+(i%5)*.000008}));
    const draw=(time:number)=>{
      if(!active)return;
      if(time-previous>32){ctx.clearRect(0,0,target.width,target.height);previous=time;
        if(period==='night'&&!rain){for(const p of particles){ctx.globalAlpha=.18+(Math.sin(time*.0004+p.x*10)+1)*.2;ctx.fillStyle='#e1ebed';ctx.beginPath();ctx.arc(p.x*target.width,p.y*target.height*.7,p.size,0,Math.PI*2);ctx.fill();}}
        if(rain){ctx.strokeStyle='rgba(180,207,218,.17)';ctx.lineWidth=1;ctx.globalAlpha=1;for(const p of particles){const x=p.x*target.width,y=((p.y+time*p.speed)%1)*target.height;ctx.beginPath();ctx.moveTo(x,y);ctx.lineTo(x-5,y+16);ctx.stroke();}}
      }
      if(!reduced)frame=requestAnimationFrame(draw);
    };
    frame=requestAnimationFrame(draw);const visible=()=>{active=!document.hidden;if(active&&!reduced)frame=requestAnimationFrame(draw);else cancelAnimationFrame(frame);};document.addEventListener('visibilitychange',visible);
    return()=>{active=false;cancelAnimationFrame(frame);window.removeEventListener('resize',resize);document.removeEventListener('visibilitychange',visible);};
  },[period,kind]);
  return <div className={`atmosphere atmosphere--${period} atmosphere--${kind} atmosphere--season-${season}`} aria-hidden="true"><div className="sky-light"/><div className="sky-cloud sky-cloud--one"/><div className="sky-cloud sky-cloud--two"/><div className="sky-horizon"/><div className="sky-land sky-land--far"/><div className="sky-land sky-land--near"/><div className="sky-grain"/><canvas ref={canvas}/></div>;
}

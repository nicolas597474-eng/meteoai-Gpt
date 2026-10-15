import { useEffect, useRef, useState, type CSSProperties } from 'react';
import type { FusedHour } from '../types';
import { weatherKind } from '../lib/format';
/** Le ciel suit le code WMO et les éphémérides. */
export function Atmosphere({current,sunrise,sunset}:{current:FusedHour|null;sunrise?:number|null;sunset?:number|null}) {
  const canvas=useRef<HTMLCanvasElement>(null),[now,setNow]=useState(Date.now());
  useEffect(()=>{const timer=setInterval(()=>setNow(Date.now()),60000);return()=>clearInterval(timer);},[]);
  const parisHour=Number(new Intl.DateTimeFormat('en-GB',{hour:'2-digit',hourCycle:'h23',timeZone:'Europe/Paris'}).format(now));
  const rise=sunrise??new Date(new Date(now).toISOString().slice(0,10)+'T06:00:00Z').getTime(),set=sunset??new Date(new Date(now).toISOString().slice(0,10)+'T17:00:00Z').getTime();
  const period=sunrise&&sunset?(now<rise-1800000||now>set+1800000?'night':Math.abs(now-rise)<2700000?'dawn':Math.abs(now-set)<2700000?'dusk':'day'):(parisHour<7||parisHour>=20?'night':parisHour<9?'dawn':parisHour>=18?'dusk':'day');
  const kind=weatherKind(current?.code??null);
  const coverage=current?.cloud??(kind==='sun'?5:kind==='partly'?40:90);
  useEffect(()=>{
    const target=canvas.current,ctx=target?.getContext('2d');if(!target||!ctx)return;
    const reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;let frame=0,active=true,previous=0;
    const resize=()=>{target.width=innerWidth;target.height=innerHeight;};resize();window.addEventListener('resize',resize);
    const wet=kind==='rain'||kind==='storm',snow=kind==='snow';
    const particles=Array.from({length:wet?70:snow?50:40},(_,i)=>({x:((i*761)%1000)/1000,y:((i*479)%1000)/1000,size:.7+i%3,speed:.00003+(i%5)*.000008}));
    const draw=(time:number)=>{if(!active)return;if(time-previous>32){previous=time;ctx.clearRect(0,0,target.width,target.height);ctx.globalAlpha=1;
      if(period==='night'&&coverage<55){for(const p of particles){ctx.fillStyle='rgba(245,250,255,.65)';ctx.beginPath();ctx.arc(p.x*target.width,p.y*target.height*.7,p.size/2,0,Math.PI*2);ctx.fill();}}
      if(wet){ctx.strokeStyle='rgba(218,238,249,.45)';ctx.lineWidth=1;for(const p of particles){const y=((p.y+time*p.speed)%1)*target.height;ctx.beginPath();ctx.moveTo(p.x*target.width,y);ctx.lineTo(p.x*target.width-6,y+22);ctx.stroke();}}
      if(snow){ctx.fillStyle='rgba(255,255,255,.8)';for(const p of particles){ctx.beginPath();ctx.arc(p.x*target.width+Math.sin(time*.0005+p.x)*15,((p.y+time*p.speed*.18)%1)*target.height,p.size,0,Math.PI*2);ctx.fill();}}
    }if(!reduced)frame=requestAnimationFrame(draw);};
    frame=requestAnimationFrame(draw);const visibility=()=>{active=!document.hidden;cancelAnimationFrame(frame);if(active&&!reduced)frame=requestAnimationFrame(draw);};document.addEventListener('visibilitychange',visibility);
    return()=>{active=false;cancelAnimationFrame(frame);window.removeEventListener('resize',resize);document.removeEventListener('visibilitychange',visibility);};
  },[kind,period,coverage]);
  return <div className={`atmosphere atmosphere--${period} atmosphere--${kind}`} style={{'--cloud-opacity':Math.max(.1,coverage/100)} as CSSProperties} aria-hidden="true"><div className="sky-disc"/><div className="sky-cloud sky-cloud--one"/><div className="sky-cloud sky-cloud--two"/><div className="sky-cloud sky-cloud--three"/><div className="sky-fog"/><div className="landscape-horizon"/><canvas ref={canvas}/></div>;
}

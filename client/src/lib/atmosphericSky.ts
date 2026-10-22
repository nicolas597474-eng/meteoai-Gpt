export type SkyWeather={cloudCover?:number|null;windSpeed?:number|null;weatherCode?:number|null;precipitation?:number|null;capturedAt?:string|null};
const clamp=(n:number,a=0,b=1)=>Math.max(a,Math.min(b,n));
const finite=(v:unknown):v is number=>typeof v==='number'&&Number.isFinite(v);
/** Position solaire approchée pour l'éclairage décoratif, sans service externe.
 * Calcul en UTC et au point choisi, y compris hors Europe/Paris. */
export function skySunPosition(now:number,lat:number,lon:number){
 const d=new Date(now),start=Date.UTC(d.getUTCFullYear(),0,0),day=(now-start)/86400000;
 const gamma=2*Math.PI/365*(day-1),decl=.006918-.399912*Math.cos(gamma)+.070257*Math.sin(gamma)-.006758*Math.cos(2*gamma)+.000907*Math.sin(2*gamma)-.002697*Math.cos(3*gamma)+.00148*Math.sin(3*gamma);
 const equation=229.18*(.000075+.001868*Math.cos(gamma)-.032077*Math.sin(gamma)-.014615*Math.cos(2*gamma)-.040849*Math.sin(2*gamma));
 const minutes=d.getUTCHours()*60+d.getUTCMinutes()+d.getUTCSeconds()/60;
 const solarMinutes=((minutes+equation+4*lon)%1440+1440)%1440,angle=(solarMinutes/4-180)*Math.PI/180,latitude=lat*Math.PI/180;
 return {elevation:Math.asin(clamp(Math.sin(latitude)*Math.sin(decl)+Math.cos(latitude)*Math.cos(decl)*Math.cos(angle),-1,1))*180/Math.PI,morning:solarMinutes<720};
}
export function makeSkyScene(weather:SkyWeather|null|undefined,lat:number,lon:number,now=Date.now()){
 const at=Date.parse(weather?.capturedAt??''),fresh=Number.isFinite(at)&&at<=now+60000&&now-at<=30*60000;
 const w=fresh?weather:null,code=finite(w?.weatherCode)?w.weatherCode:null;
 const inferredCover=code===0?0:code===1?22:code===2?58:code!==null?96:0;
 const coverage=finite(w?.cloudCover)?clamp(w.cloudCover/100):inferredCover/100;
 const wind=finite(w?.windSpeed)?clamp(w.windSpeed,0,120):0;
 const wetCode=code!==null&&([51,53,55,56,57,61,63,65,66,67,80,81,82,95,96,99].includes(code));
 const snow=code!==null&&[71,73,75,77,85,86].includes(code);
 const rain=snow?0:Math.max(finite(w?.precipitation)?clamp(w.precipitation/3):0,wetCode ? .18 : 0);
 const sun=skySunPosition(now,lat,lon),daylight=clamp((sun.elevation+8)/22),twilight=clamp(1-Math.abs(sun.elevation-1)/10);
 return {coverage,wind,drift:wind*.055,rain,daylight,twilight,morning:sun.morning,elevation:sun.elevation,fresh};
}
export type SkyScene=ReturnType<typeof makeSkyScene>;
export function skyQuality(width:number,reduced=false){
 return {maxClouds:width<640?(reduced?6:10):(reduced?10:18),maxDrops:width<640?18:32,fps:reduced?15:width<640?24:30,dpr:width<640?1.25:1.5};
}

type LoopOptions={document:{hidden:boolean;addEventListener:(name:string,fn:()=>void)=>void;removeEventListener:(name:string,fn:()=>void)=>void};request:(fn:(t:number)=>void)=>number;cancel:(id:number)=>void;draw:(dt:number)=>void;fps:number;animate:boolean};
/** Aucun rAF en onglet masqué ou en mode statique ; reprise sans saut temporel. */
export function bindSkyAnimation(o:LoopOptions){
 let frame:number|null=null,last:number|null=null,disposed=false,animated=o.animate;
 const tick=(now:number)=>{
  frame=null;if(disposed||o.document.hidden)return;
  if(last===null)last=now;
  if(now-last>=1000/o.fps){o.draw(Math.min((now-last)/1000,.1));last=now;}
  frame=o.request(tick);
 };
 const sync=()=>{if(frame!==null)o.cancel(frame);frame=null;last=null;if(!disposed&&!o.document.hidden){o.draw(0);if(animated)frame=o.request(tick);}};
 o.document.addEventListener('visibilitychange',sync);sync();
 return {invalidate:()=>{if(!disposed&&!o.document.hidden)o.draw(0);},setAnimated:(value:boolean)=>{if(value!==animated){animated=value;sync();}},dispose:()=>{disposed=true;if(frame!==null)o.cancel(frame);frame=null;o.document.removeEventListener('visibilitychange',sync);}};
}

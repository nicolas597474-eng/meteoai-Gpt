import {finite,number,type Activity,type Hour} from './contracts';
/** Critères de confort explicites, indépendants du moteur de prévision.
 * Aucune fenêtre incomplète ni heure passée n'est présentée comme favorable. */
export const ACTIVITY_CRITERIA:Record<Activity,{wind:number;gust:number;rain:number;minTemp:number;maxTemp:number}>={
 kayak:{wind:15,gust:25,rain:0.2,minTemp:10,maxTemp:30},randonnée:{wind:25,gust:40,rain:0.2,minTemp:5,maxTemp:28},vélo:{wind:20,gust:35,rain:0.1,minTemp:5,maxTemp:28},jardinage:{wind:20,gust:35,rain:0.1,minTemp:5,maxTemp:30},tonte:{wind:20,gust:35,rain:0,minTemp:8,maxTemp:28},promenade:{wind:25,gust:40,rain:0.2,minTemp:5,maxTemp:30},plage:{wind:20,gust:30,rain:0,minTemp:20,maxTemp:30},
};
export function activityWindows(hours:Hour[],activity:Activity,now:number){
 const c=ACTIVITY_CRITERIA[activity];
 const eligible=hours.filter(h=>h.validAt>=now).sort((a,b)=>a.validAt-b.validAt),windows:Array<{start:number;end:number;wind:number;gust:number;rain:number}>=[];
 let missing=0,bad=0;
 const good=(h:Hour)=>{
  if(![h.temp,h.windSpeed,h.windGust,h.precipitation,h.weatherCode].every(finite)){missing++;return false;}
  const ok=h.temp!>=c.minTemp&&h.temp!<=c.maxTemp&&h.windSpeed!<=c.wind&&h.windGust!<=c.gust&&h.precipitation!<=c.rain&&!([45,48,56,57,66,67,71,73,75,77,85,86,95,96,99].includes(h.weatherCode!));if(!ok)bad++;return ok;
 };
 const suitability=new Map(eligible.map(h=>[h.validAt,good(h)]));
 for(let i=0;i<eligible.length-1;i++){const a=eligible[i],b=eligible[i+1];if(b.validAt-a.validAt!==3600000||!suitability.get(a.validAt)||!suitability.get(b.validAt))continue;
  windows.push({start:a.validAt,end:b.validAt,wind:Math.max(a.windSpeed!,b.windSpeed!),gust:Math.max(a.windGust!,b.windGust!),rain:Math.max(a.precipitation!,b.precipitation!)});
 }
 return {windows:windows.slice(0,3),missing,bad,examined:eligible.length,criteria:`Vent ≤ ${c.wind} km/h, rafales ≤ ${c.gust} km/h, précipitations ≤ ${number(c.rain)} mm par heure, température de ${c.minTemp} à ${c.maxTemp} °C, sans code de brouillard, neige, verglas ou orage.`};
}

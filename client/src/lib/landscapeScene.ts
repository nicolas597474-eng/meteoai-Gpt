import {buildTerrainPath,type TerrainHorizonPathPoint} from './celestialSvgPaths';
export type LandscapeKind='mountain'|'city'|'countryside';
export const LANDSCAPE_PHOTOS={
 mountain:{src:'/assets/astronomy/snowy-alps.jpg',position:'50% 48%',credit:'Willian Justen de Vasconcellos / Unsplash',url:'https://unsplash.com/photos/WStW2U7iLPY'},
 city:{src:'/assets/astronomy/lille-city.jpg',position:'50% 16%',credit:'Max Zed / Unsplash',url:'https://unsplash.com/photos/xLgENq9t8OM'},
 countryside:{src:'/assets/astronomy/countryside.jpg',position:'50% 46%',credit:'Annie Spratt / Unsplash',url:'https://unsplash.com/photos/_AayFhX1VSo'},
} as const;
export type LandscapeLocation={name:string;lat:number;lon:number};
export function landscapeKind(location:LandscapeLocation,terrain:readonly TerrainHorizonPathPoint[],population:number|null):LandscapeKind{
 const name=location.name.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
 const near=(lat:number,lon:number)=>Math.abs(location.lat-lat)<.12&&Math.abs(location.lon-lon)<.17;
 if(name.includes('chamonix')&&near(45.924,6.869))return 'mountain';
 if(name.includes('lille')&&near(50.63,3.057))return 'city';
 if(name.includes('hondeghem')&&near(50.757,2.52))return 'countryside';
 if(terrain.some(p=>Number.isFinite(p.elevationDeg)&&p.elevationDeg>=6))return 'mountain';
 return population!==null&&population>=20000?'city':'countryside';
}
/** La photo est découpée SOUS le même horizon que le tracé SVG, dans une scène de 192 px.
 * Les 32 pixels de sol ajoutés ne modifient ni la hauteur du ciel ni les positions astronomiques. */
export function landscapeTerrainClip(points:readonly TerrainHorizonPathPoint[]){
 const path=buildTerrainPath(points,192);if(!path)return null;
 const pairs=[...path.matchAll(/[ML]([\d.-]+) ([\d.-]+)/g)].map(match=>`${Number(match[1]).toFixed(2)}% ${(Number(match[2])/192*100).toFixed(4)}%`);
 return `polygon(${pairs.join(',')})`;
}
export function nearestPopulation(results:unknown,location:LandscapeLocation):number|null{
 if(!Array.isArray(results))return null;
 const candidates=results.filter(p=>p&&Number.isFinite(p.latitude)&&Number.isFinite(p.longitude)&&Number.isFinite(p.population)&&p.population>=0)
 .map(p=>({population:p.population,distance:Math.hypot((p.latitude-location.lat)*111,(p.longitude-location.lon)*111*Math.cos(location.lat*Math.PI/180))})).filter(p=>p.distance<5).sort((a,b)=>a.distance-b.distance);
 return candidates[0]?.population??null;
}

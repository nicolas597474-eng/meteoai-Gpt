const requests=new Set<string>();
const key=(lat:number,lon:number,extended:boolean)=>JSON.stringify([lat,lon,extended]);
/** Un essai manuel par variante, sans purger les prévisions hors ligne ni Netatmo. */
export function requestForecastReload(lat:number,lon:number){
 if(requests.size>16)requests.clear();
 for(const extended of [false,true])requests.add(key(lat,lon,extended));
}
export function takeForecastReload(lat:number,lon:number,extended:boolean){
 return requests.delete(key(lat,lon,extended));
}

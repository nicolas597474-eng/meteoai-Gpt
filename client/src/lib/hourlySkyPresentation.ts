import {Body,Equator,Horizon,Observer} from 'astronomy-engine';
import {getOfficialHourlyCondition,type OfficialHourlyConditionPoint} from './officialHourlyCard';
/** Le jour/nuit dépend de l’échéance UTC et du lieu, jamais de l’heure du téléphone. */
export function hourlySkyCondition(point:OfficialHourlyConditionPoint|null|undefined,lat:number,lon:number){
 const condition=getOfficialHourlyCondition(point);
 if(!condition||!Number.isFinite(point?.validAt)||!Number.isFinite(lat)||!Number.isFinite(lon)||Math.abs(lat)>90||Math.abs(lon)>180)return condition;
 const key=condition.toLowerCase();
 const clear=['sunny','stable','summer_heat','clear','ensoleillé','ciel dégagé','dégagé','clear_night'].includes(key);
 const partlyCloudy=['few_clouds','partly_cloudy','peu nuageux','partiellement nuageux','éclaircies','eclaircies','partly_cloudy_night'].includes(key);
 if(!clear&&!partlyCloudy)return condition;
 const at=new Date(point!.validAt!);
 if(!Number.isFinite(at.getTime()))return condition;
 const observer=new Observer(lat,lon,0),sun=Equator(Body.Sun,at,observer,true,true);
 const night=Horizon(at,observer,sun.ra,sun.dec).altitude< -0.833;
 if(night)return partlyCloudy?'partly_cloudy_night':'clear_night';
 return key==='clear_night'?'sunny':key==='partly_cloudy_night'?'partly_cloudy':condition;
}

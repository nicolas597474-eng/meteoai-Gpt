import {getIconNameFromCondition} from '@/components/MeteoIcon';
import {hourlySkyCondition} from './hourlySkyPresentation';
/** Visual day/night variant only; the condition and its provenance remain unchanged. */
export function dashboardCurrentIcon(condition:string,coords:{lat:number;lon:number},now:number){
 return getIconNameFromCondition(hourlySkyCondition({condition,validAt:now},coords.lat,coords.lon));
}

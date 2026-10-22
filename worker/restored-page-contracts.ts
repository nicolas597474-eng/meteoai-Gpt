import {OFFICIAL_HOURLY_MODELS} from '../server/officialModels';
import {EXTENDED_REGIME_INFO} from '../server/fusionEngine';
import {summarizeDailyModelAgreement} from '../shared/modelAgreement';
import {summarizePrecipitationModels} from '../shared/precipitationConsensus';
import {coordinates} from './weather';

/** Contrats de présentation : aucune donnée de démonstration, aucune écriture.
 * Les composants originaux restent complets ; un champ non raccordé reste null.
 */
const names=OFFICIAL_HOURLY_MODELS.map(m=>m.name);
const note='Visuel original restauré. Données en cours de raccordement, aucune valeur simulée.';
const date=(time:number)=>new Date(time).toLocaleDateString('en-CA',{timeZone:'Europe/Paris'});
export const RESTORED_PAGE_READS=new Set(['weather.getForecastProvenance','weather.getLocalOfficialDeltaHistory','personalObservations.dashboardState','personalObservations.personalizedHourly']);
export function restoredPageRead(name:string,input:any,now=Date.now()):any{
 const coords=coordinates(input),today=date(now),expected=names.length;
 switch(name){
 case 'weather.getLocalOfficialDeltaHistory':return [];
 default:return null;
 }
}

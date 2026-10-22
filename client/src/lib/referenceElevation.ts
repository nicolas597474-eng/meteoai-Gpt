import {publicGeography,type ReferenceElevation} from './publicGeography';
/** L'altitude du lieu est un relief DEM déclaré, jamais une mesure météo. */
export async function getReferenceElevation(lat:number,lon:number):Promise<ReferenceElevation|null>{
 const verified=VERIFIED_REFERENCE_ELEVATIONS.find(point=>point.lat===lat&&point.lon===lon);
 if(verified)return verified;
 return publicGeography.elevation(lat,lon);
}
import {VERIFIED_REFERENCE_ELEVATIONS} from '../../../shared/verifiedReferenceElevations';

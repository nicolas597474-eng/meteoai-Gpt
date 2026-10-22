import {z} from 'zod';
import {PERSONAL_CONDITIONS} from '../server/personalCalibration';
import {makeLocationKey} from './history-bridge';
import {ApiError} from './api-error';

const id=z.number().int().positive();
const values=z.object({temperature:z.number().finite().min(-60).max(60).nullable(),condition:z.enum(PERSONAL_CONDITIONS),windSpeed:z.number().finite().min(0).max(250).nullable(),precipitation:z.number().finite().min(0).max(500).nullable()}).strict();
const coordinates=z.object({lat:z.number().finite().min(-90).max(90),lon:z.number().finite().min(-180).max(180),radiusKm:z.number().min(5).max(50).optional(),localMode:z.enum(['standard','local','ultra-local']).optional()}).strict();
const submission=coordinates.extend(values.shape).strict();
export const PERSONAL_JOURNAL_MUTATIONS=new Set(['personalObservations.submit','personalObservations.update','personalObservations.delete']);
/** Carnet déclaratif privé : aucune écriture dans les mesures physiques ni les scores. */
export async function personalJournal(method:string,input:unknown,owner:number|undefined,db:any,now=Date.now()){
 if(!owner)throw new ApiError('Connexion ChatGPT requise',401);
 if(method!=='personalObservations.history'&&!PERSONAL_JOURNAL_MUTATIONS.has(method))throw new ApiError('Fonction indisponible.',404);
 const schema=method==='personalObservations.history'?coordinates:method==='personalObservations.submit'?submission:method==='personalObservations.update'?z.object({id,observation:values}).strict():z.object({id}).strict();
 const parsed=schema.safeParse(input);
 if(!parsed.success)throw new ApiError('Valeurs invalides : température de −60 à 60 °C, vent de 0 à 250 km/h, pluie de 0 à 500 mm. Les valeurs non renseignées restent vides.');
 const data:any=parsed.data;
 if(method==='personalObservations.history'){
  const rows=await db.prepare('SELECT id,lat,lon,observed_at AS observedAt,updated_at AS updatedAt,temperature,condition,wind_speed AS windSpeed,precipitation,source FROM site_personal_observations WHERE user_id=? AND location_key=? ORDER BY observed_at DESC,id DESC LIMIT 200').bind(owner,makeLocationKey(data.lat,data.lon)).all();
  return rows.results.reverse();
 }
 if(method==='personalObservations.submit'){
  const row=await db.prepare("INSERT INTO site_personal_observations(user_id,location_key,lat,lon,observed_at,updated_at,temperature,condition,wind_speed,precipitation,source) VALUES (?,?,?,?,?,?,?,?,?,?, 'personal_declaration') RETURNING id").bind(owner,makeLocationKey(data.lat,data.lon),data.lat,data.lon,now,now,data.temperature,data.condition,data.windSpeed,data.precipitation).first();
  if(!row)throw new Error('Enregistrement impossible');
  return {observationId:row.id,matchedModelCount:0,scoredModelCount:0,calibration:'not_active',notice:'Observation enregistrée dans votre carnet privé. La comparaison aux prévisions archivées reste à migrer ; aucun score ni poids de modèle n’a été modifié.'};
 }
 if(method==='personalObservations.update'){
  const row=await db.prepare('UPDATE site_personal_observations SET temperature=?,condition=?,wind_speed=?,precipitation=?,updated_at=? WHERE user_id=? AND id=? RETURNING id').bind(data.observation.temperature,data.observation.condition,data.observation.windSpeed,data.observation.precipitation,now,owner,data.id).first();
  if(!row)throw new ApiError('Observation introuvable.',404);
 }else{
  const row=await db.prepare('DELETE FROM site_personal_observations WHERE user_id=? AND id=? RETURNING id').bind(owner,data.id).first();
  if(!row)throw new ApiError('Observation introuvable.',404);
 }
 return {success:true,calibration:'not_active'};
}

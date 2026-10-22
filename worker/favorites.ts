import {z} from 'zod';
import {ApiError} from './api-error';

/** Favoris du compte Sites courant uniquement ; aucun ancien compte importé. */
export class FavoriteError extends ApiError {}
const id=z.number().int().positive();
const name=z.string().trim().min(1).max(256);
const add=z.object({name,customName:name.optional(),lat:z.number().finite().min(-90).max(90),lon:z.number().finite().min(-180).max(180),position:z.number().int().min(0).max(4).optional(),radiusKm:z.union([z.literal(5),z.literal(10),z.literal(20),z.literal(30),z.literal(50)]).optional(),tempUnit:z.literal('celsius').optional(),localMode:z.enum(['standard','local','ultra-local']).optional()}).strict();
const update=z.object({id,customName:name.optional(),position:z.number().int().min(0).max(4).optional(),isDefault:z.boolean().optional(),radiusKm:z.union([z.literal(5),z.literal(10),z.literal(20),z.literal(30),z.literal(50)]).optional(),tempUnit:z.literal('celsius').optional(),localMode:z.enum(['standard','local','ultra-local']).optional()}).strict();
const columns='id,name,custom_name AS customName,lat,lon,is_default AS isDefault,position,radius_km AS radiusKm,\'celsius\' AS tempUnit,local_mode AS localMode';
export const FAVORITE_MUTATIONS=new Set(['favorites.add','favorites.update','favorites.delete','favorites.setDefault']);
export async function favoriteProcedure(method:string,input:unknown,owner:number|undefined,db:any){
 if(!owner)throw new FavoriteError('Connexion ChatGPT requise',401);
 if(method==='favorites.list')return (await db.prepare(`SELECT ${columns} FROM site_favorites WHERE user_id=? ORDER BY position,id`).bind(owner).all()).results;
 const schema=method==='favorites.add'?add:method==='favorites.update'?update:z.object({id}).strict();
 const parsed=schema.safeParse(input);
 if(!parsed.success)throw new FavoriteError('Lieu ou paramètres invalides. Rayon de 5 à 50 km, mode Standard, Local ou Ultra-local et affichage en °C.');
 const value:any=parsed.data;
 if(method==='favorites.add'){
  // Une seule instruction : limite et insertion atomiques, même sur deux appareils.
  const duplicate=await db.prepare('SELECT id FROM site_favorites WHERE user_id=? AND lat=? AND lon=?').bind(owner,value.lat,value.lon).first();
  if(duplicate)throw new FavoriteError('Ce lieu est déjà dans vos favoris.',409);
  try{
   const row=await db.prepare(`INSERT INTO site_favorites(user_id,name,custom_name,lat,lon,position,is_default,radius_km,local_mode,created_at)
    SELECT ?,?,?,?,?,COALESCE((SELECT MAX(position)+1 FROM site_favorites WHERE user_id=?),0),CASE WHEN EXISTS(SELECT 1 FROM site_favorites WHERE user_id=?) THEN 0 ELSE 1 END,?,?,?
    WHERE (SELECT COUNT(*) FROM site_favorites WHERE user_id=?)<5 RETURNING id`).bind(owner,value.name,value.customName??null,value.lat,value.lon,owner,owner,value.radiusKm??20,value.localMode??'standard',new Date().toISOString(),owner).first();
   if(!row)throw new FavoriteError('Maximum de cinq lieux favoris atteint.',409);
   return {id:row.id};
  }catch(error){if(error instanceof FavoriteError)throw error;if(String(error).includes('UNIQUE'))throw new FavoriteError('Ce lieu est déjà dans vos favoris.',409);throw error;}
 }
 if(!await db.prepare('SELECT id FROM site_favorites WHERE user_id=? AND id=?').bind(owner,value.id).first())throw new FavoriteError('Favori introuvable.',404);
 if(method==='favorites.delete'){
  await db.batch([
   db.prepare('DELETE FROM site_favorites WHERE user_id=? AND id=?').bind(owner,value.id),
   db.prepare('UPDATE site_favorites SET is_default=1 WHERE user_id=? AND id=(SELECT id FROM site_favorites WHERE user_id=? ORDER BY position,id LIMIT 1) AND NOT EXISTS(SELECT 1 FROM site_favorites WHERE user_id=? AND is_default=1)').bind(owner,owner,owner),
  ]);
 }else if(method==='favorites.setDefault'||value.isDefault===true){
  // Le test d’appartenance reste dans l’écriture, y compris après une suppression concurrente.
  await db.prepare('UPDATE site_favorites SET is_default=CASE WHEN id=? THEN 1 ELSE 0 END WHERE user_id=? AND EXISTS(SELECT 1 FROM site_favorites WHERE user_id=? AND id=?)').bind(value.id,owner,owner,value.id).run();
 }
 if(method==='favorites.update'){
  if(value.customName!==undefined)await db.prepare('UPDATE site_favorites SET custom_name=? WHERE user_id=? AND id=?').bind(value.customName,owner,value.id).run();
  if(value.radiusKm!==undefined)await db.prepare('UPDATE site_favorites SET radius_km=? WHERE user_id=? AND id=?').bind(value.radiusKm,owner,value.id).run();
  if(value.localMode!==undefined)await db.prepare('UPDATE site_favorites SET local_mode=? WHERE user_id=? AND id=?').bind(value.localMode,owner,value.id).run();
  if(value.position!==undefined)await db.prepare('UPDATE site_favorites SET position=? WHERE user_id=? AND id=?').bind(value.position,owner,value.id).run();
 }
 return {success:true};
}

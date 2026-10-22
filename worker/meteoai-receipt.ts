import {recordMeteoAIForecast} from './meteoai-history';
/** Future outputs received from the signed-in application. The server stamps
 * reception; this descriptive history never enters model calibration. */
export async function receiveMeteoAIForecast(request:Request,env:any,now=Date.now()){
 const json=(body:any,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'no-store'}});
 if(request.method!=='POST')return json({error:'Méthode non autorisée'},405);
 if(!request.headers.get('oai-authenticated-user-id'))return json({error:'Connexion requise'},401);
 if(request.headers.get('Origin')!==new URL(request.url).origin||!request.headers.get('Content-Type')?.startsWith('application/json'))return json({error:'Origine ou format non autorisé'},403);
 if(Number(request.headers.get('Content-Length')??0)>80000)return json({error:'Capture trop grande'},413);
 const text=await request.text();if(text.length>80000)return json({error:'Capture trop grande'},413);
 let p:any;try{p=JSON.parse(text);}catch{return json({error:'JSON invalide'},400);}
 const computed=Date.parse(p?.computedAt??'');
 if(!p||p.lat!==50.7567||p.lon!==2.5204||!['hourly','daily'].includes(p.kind)||!Number.isSafeInteger(computed)||computed>now+5000||computed<now-300000||!Array.isArray(p.points)||!p.points.length||p.points.length>(p.kind==='hourly'?361:16))return json({error:'Capture invalide ou expirée'},400);
 const seen=new Set();for(const r of p.points){
  if(!r||['temp','tempMin','tempMax'].some(k=>r[k]!=null&&(typeof r[k]!=='number'||!Number.isFinite(r[k])||r[k]<-100||r[k]>70)))return json({error:'Température invalide'},400);
  const key=p.kind==='hourly'?r.validAt:r.date;
  if(seen.has(key)||p.kind==='hourly'&&(!Number.isSafeInteger(key)||key%3600000!==0)||p.kind==='daily'&&(typeof key!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(key)||!Number.isFinite(Date.parse(key+'T12:00:00Z'))||new Date(key+'T12:00:00Z').toISOString().slice(0,10)!==key))return json({error:'Échéance invalide'},400);seen.add(key);
  if(p.kind==='daily'&&r.tempMax!=null&&r.tempMin!=null&&r.tempMax<r.tempMin)return json({error:'Extrema inversés'},400);
 }
 try{
  // Shared durable limit: at most one application receipt per minute and kind.
  const lease=await env.DB.prepare('INSERT INTO weather_collection_status(channel,attempted_at,status,message) VALUES (?,?,?,?) ON CONFLICT(channel) DO UPDATE SET attempted_at=excluded.attempted_at,status=excluded.status,message=excluded.message WHERE weather_collection_status.attempted_at<=? RETURNING channel').bind('meteoai_application_'+p.kind,new Date(now).toISOString(),'received','Prévision future reçue de l’application',new Date(now-60000).toISOString()).first();
  if(!lease)return json({stored:false,status:'rate_limited'},429);
  return json({...await recordMeteoAIForecast(p.kind,p.points,{lat:p.lat,lon:p.lon},env,now,'application'),origin:'application',calibrationEligible:false});
 }
 catch{return json({error:'Archivage momentanément indisponible'},503);}
}

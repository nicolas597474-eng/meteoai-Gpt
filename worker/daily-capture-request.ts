import {normalizeDailyCapture,recordDailyCapture} from './daily-archive';
import {normalizeFusionSnapshot,recordFusionSnapshot} from './fusion-snapshots';

/** La capture et sa trace facultative ont des reçus indépendants, sans recalcul météo. */
export async function recordDailyCaptureRequest(input:any,env:any,now=Date.now()){
 try{normalizeDailyCapture(input,now);}catch{
  return {status:400,body:{error:'Contenu de la capture quotidienne invalide.',code:'daily_capture_invalid'}};
 }
 let capture:Awaited<ReturnType<typeof recordDailyCapture>>;
 try{capture=await recordDailyCapture(input,env,'browser',now);}catch{
  console.error('[daily-capture] daily_storage_unavailable');
  return {status:503,body:{error:'Stockage de la capture quotidienne indisponible.',code:'daily_storage_unavailable'}};
 }
 if(input.fusionSnapshot==null)return {status:200,body:{...capture,partial:false,fusionSnapshot:{status:'not_requested'}}};
 const snapshot={...input.fusionSnapshot,lat:input.lat,lon:input.lon};
 try{normalizeFusionSnapshot(snapshot,now);}catch{
  console.warn('[daily-capture] fusion_snapshot_invalid');
  return {status:200,body:{...capture,partial:true,fusionSnapshot:{status:'rejected',code:'fusion_snapshot_invalid',message:'La capture quotidienne est conservée ; sa trace de fusion est invalide ou périmée.'}}};
 }
 try{
  const fusionSnapshot=await recordFusionSnapshot(snapshot,env,now);
  return {status:200,body:{...capture,partial:false,fusionSnapshot}};
 }catch{
  console.warn('[daily-capture] fusion_storage_unavailable');
  return {status:200,body:{...capture,partial:true,fusionSnapshot:{status:'unavailable',code:'fusion_storage_unavailable',message:'La capture quotidienne est conservée ; le stockage de sa trace de fusion est indisponible.'}}};
 }
}

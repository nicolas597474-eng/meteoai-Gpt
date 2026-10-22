/** Reçu de service seulement : il ne remplace jamais la relecture des preuves météo. */
export async function readCollectionServiceStatus(env:any,now=Date.now()){
 const enabled=env.METEOAI_BACKGROUND_ENABLED==='true';
 if(!enabled)return {enabled:false,lastAttemptAt:null,status:'disabled',description:'Collecte de service désactivée ; captures à la consultation uniquement.'};
 try{
  const row=await env.DB.prepare('SELECT attempted_at,status,message FROM weather_collection_status WHERE channel=?').bind('unattended_hourly_v1').first();
  if(!row)return {enabled:true,lastAttemptAt:null,status:'waiting',description:'Collecteur de service configuré ; aucun passage automatique reçu.'};
  const at=Date.parse(row.attempted_at);if(!Number.isFinite(at)||at>now)throw Error('Horloge de reçu invalide');
  let receipt:any=null;try{receipt=JSON.parse(row.message);}catch{}
  const valid=receipt?.version===1&&receipt.slot===row.attempted_at.slice(0,13)&&['complete','partial'].includes(receipt.status)&&['observations','models','dailyModels'].every(k=>Number.isSafeInteger(receipt[k])&&receipt[k]>=0)&&receipt.models<=7&&receipt.dailyModels<=7;
  // Reclassify old receipts: the former collector called 1–6 daily models complete.
  const receiptStatus=valid?(receipt.status==='complete'&&receipt.verified===true&&receipt.observations>0&&receipt.models===7&&receipt.dailyModels===7?'complete':'partial'):null;
  const stale=now-at>90*60000,status=stale?'stale':receiptStatus??(['running','failed'].includes(row.status)?row.status:'unverified');
  const timestamp=new Date(at).toLocaleString('fr-FR',{timeZone:'Europe/Paris'});
  const detail=valid?`${receipt.observations} relevés, ${receipt.models}/7 modèles horaires et ${receipt.dailyModels}/7 modèles quotidiens reçus.`:'Aucun succès confirmé par ce reçu.';
  return {enabled:true,lastAttemptAt:new Date(at).toISOString(),status,receiptStatus,counts:valid?{observations:receipt.observations,models:receipt.models,dailyModels:receipt.dailyModels}:null,description:`Collecteur de service indépendant du PC. Dernier passage : ${timestamp} (Paris) · ${status==='complete'?'complet':status==='partial'?'partiel':status==='stale'?'ancien, activité à vérifier':status==='running'?'en cours':status==='failed'?'en échec':'non vérifiable'}. ${detail} Les lacunes restent des lacunes.`};
 }catch{return {enabled:true,lastAttemptAt:null,status:'unavailable',description:'Collecteur de service configuré ; lecture du dernier passage indisponible. Aucune réussite annoncée.'};}
}

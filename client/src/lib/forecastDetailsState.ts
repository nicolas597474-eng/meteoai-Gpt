const time=(data:any)=>Date.parse(data?.officialSnapshot?.hourlyComputedAt??data?.officialSnapshot?.computedAt??'');
const stale=(data:any)=>data?.officialSnapshot?.snapshotStatus==='stale'||data?.controlCache?.stale===true;
/** Un ancien enrichissement ne doit pas masquer la série horaire fraîche.
 * Les données quotidiennes gardent leur propre statut de cache. */
export function selectForecastDetails<T>(essential:T|undefined,detailed:T|undefined):T|undefined{
 if(!detailed)return essential;
 if(!essential)return detailed;
 const e=essential as any,d=detailed as any;
 const useEssential=!stale(e)&&(stale(d)||Number.isFinite(time(e))&&time(e)>time(d));
 return {...d,...(useEssential?{...e,controlCache:e.controlCache}:{}),days:d.days,dailyStatus:d.dailyStatus,dailyModelsUsed:d.dailyModelsUsed,
  dailyCacheStale:stale(d),dailyCacheAt:d.controlCache?.cachedAt??d.officialSnapshot?.computedAt} as T;
}
export function forecastDetailsNotice(data:any,state:{busy:boolean;failed:boolean;offline:boolean}){
 const partial=data?.dailyStatus==='not_ready'||data?.officialSnapshot?.hourlyStatus==='not_ready';
 const isStale=stale(data)||data?.dailyCacheStale===true;
 if(!isStale&&!partial&&!state.failed)return null;
 const savedAt=Date.parse(data?.dailyCacheStale?data.dailyCacheAt:data?.controlCache?.cachedAt??data?.officialSnapshot?.computedAt??'');
 const date=Number.isFinite(savedAt)?new Date(savedAt).toLocaleString('fr-FR',{timeZone:'Europe/Paris',day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'}):null;
 const saved=`${data?.dailyCacheStale&&!stale(data)?'Prévisions quotidiennes enregistrées':'Prévision enregistrée'}${date?` du ${date} (Paris)`:''} affichée${data?.dailyCacheStale&&!stale(data)?'s':''}.`;
 return {busy:state.busy,message:state.offline?`Connexion indisponible. ${saved}`:state.busy?`Mise à jour des prévisions en cours. ${isStale?saved:'Les valeurs déjà disponibles restent affichées.'}`:state.failed?`La dernière actualisation n’a pas abouti. ${saved}`:isStale?`${saved} Actualisez pour recevoir les dernières prévisions.`:'Prévisions partiellement disponibles : certaines données n’ont pas été reçues.',button:state.busy?'Rafraîchissement…':'Actualiser les prévisions'};
}

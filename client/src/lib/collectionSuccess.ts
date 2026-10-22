import {formatCollectionTimestamp} from './collectionTimestamp';

export type CollectionSuccess = {
 status:string;collectedAt?:Date|string|null;dailyModelCount?:number|null;
 hourlyModelCount?:number|null;date?:string|null;hour?:number|null;
 attempts?:number|null;stationCount?:number|null;reason?:string|null;
};

/** Une réception serveur vérifiée n'est pas une référence physique qualifiée. */
export function physicalCollectionSummary(collection:CollectionSuccess){
 const count=collection.stationCount??'—';
 if(collection.status==='capture_verified')return `${count} relevé(s) stationnel(s) archivés et vérifiés. Cette réception ne qualifie pas les scores.`;
 if(collection.status==='stored')return `${count} station(s) qualifiée(s) utilisée(s).`;
 if(collection.status==='no_qualified_stations')return 'Aucune station physique qualifiée pour ce créneau.';
 return 'Le statut physique de ce passage n’est pas confirmé pour cette lecture.';
}

export function collectionMomentLabel(collection:CollectionSuccess|null,kind:'forecast'|'physical'){
 if(!collection)return 'Aucun succès vérifiable';
 if(collection.collectedAt)return `${kind==='forecast'?'Mis à jour':'Reçu'} le ${formatCollectionTimestamp(collection.collectedAt)}`;
 if(collection.date!=null&&collection.hour!=null)return `${new Date(`${collection.date}T12:00:00`).toLocaleDateString('fr-FR',{day:'numeric',month:'long',timeZone:'Europe/Paris'})} · ${String(collection.hour).padStart(2,'0')} h`;
 return 'Horodatage indisponible';
}

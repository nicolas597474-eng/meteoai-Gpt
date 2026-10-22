import {OFFICIAL_HOURLY_MODELS} from '../server/officialModels';
const statuses=new Set(['succeeded','already_archived','archive_unavailable','no_usable_values','unmapped_model_id','metadata_invalid','metadata_stale','availability_wait','run_timestamp_not_minute_aligned','metadata_unavailable','request_failed','request_invalid','invalid_response','no_future_valid_times','rate_limited','selected']);
/** Read the saved collection journal, not an inferred provider emission or a network probe. */
export async function readProviderCollectionJournal(env:any,now=Date.now()){
 const unavailable={available:false,results:[] as any[]};
 try{
  const row=await env.DB.prepare('SELECT attempted_at,status,message FROM weather_collection_status WHERE channel=?').bind('learning_provider_runs_v3').first();
  if(!row||typeof row.message!=='string'||row.message.length>32000||!Number.isFinite(Date.parse(row.attempted_at))||Date.parse(row.attempted_at)>now)return unavailable;
  const summary=JSON.parse(row.message);
  if(![1,2].includes(summary?.version)||!Array.isArray(summary.attempts)||!summary.attempts.length||summary.attempts.length>7)return unavailable;
  const seen=new Set<string>(),results=[];
  for(const item of summary.attempts){
   const model=OFFICIAL_HOURLY_MODELS.find(m=>m.name===item?.model);
   if(!model||seen.has(model.name)||!statuses.has(item.status))return unavailable;
   seen.add(model.name);
   const time=(value:any)=>typeof value==='number'&&Number.isFinite(value)&&value>=0&&value<=now?value:null;
   const count=(value:any)=>Number.isSafeInteger(value)&&value>=0?value:null;
   const http=(value:any)=>Number.isInteger(value)&&value>=100&&value<=599?value:null;
   const providerRunAt=time(item.providerRunAt);
   results.push({model:model.name,modelId:model.modelId,status:item.status,reasonCode:typeof item.reasonCode==='string'&&/^[a-z0-9_-]{1,96}$/.test(item.reasonCode)?item.reasonCode:null,
    leadBasis:providerRunAt===null?'unknown':'provider_run',metadataHttpStatus:http(item.metadataHttpStatus),metadataAvailableAt:time(item.metadataAvailableAt),providerRunAt,
    requestStartedAt:time(item.requestStartedAt),availableAt:time(item.availableAt),responseStatus:http(item.httpStatus),collectionLatencyMilliseconds:count(item.collectionLatencyMilliseconds),
    valuesStored:item.status==='already_archived'?null:count(item.valuesStored),minimumForecastLeadMilliseconds:count(item.minimumForecastLeadMilliseconds),maximumForecastLeadMilliseconds:count(item.maximumForecastLeadMilliseconds),capturedAt:row.attempted_at,journalTimingScope:'batch_start' as const,
    ...(item.metadataPublicationBasis==='component_upper_bound'?{metadataPublicationBasis:'component_upper_bound' as const}:{})});
  }
  return {available:true,results};
 }catch{return unavailable;}
}

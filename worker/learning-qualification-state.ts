const CHANNEL='learning_qualification_v1';
type RejectedDay={date:string;sourceDigest:string};
export type QualificationCheckpoint={cursor:string|null;rejected:RejectedDay[];attemptedAt:number|null;pendingDays:number};
const dateValid=(v:unknown):v is string=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&Number.isFinite(Date.parse(v+'T12:00:00Z'))&&new Date(v+'T12:00:00Z').toISOString().slice(0,10)===v;

/** Curseur de reprise uniquement : il ne constitue jamais une preuve de score. */
export async function readQualificationCheckpoint(env:any,now:number):Promise<QualificationCheckpoint>{
 const row=await env.DB.prepare('SELECT attempted_at,message FROM weather_collection_status WHERE channel=?').bind(CHANNEL).first();
 if(!row)return {cursor:null,rejected:[],attemptedAt:null,pendingDays:0};
 const value=JSON.parse(row.message),attemptedAt=Date.parse(row.attempted_at);
 if(!Number.isFinite(attemptedAt)||attemptedAt>now||value.version!==1||value.cursor!==null&&!dateValid(value.cursor)||!Array.isArray(value.rejected)||value.rejected.length>120||!Number.isSafeInteger(value.pendingDays)||value.pendingDays<0||value.pendingDays>121)throw Error('Suivi de qualification invalide');
 const seen=new Set<string>();
 for(const item of value.rejected){if(!dateValid(item?.date)||!/^[a-f0-9]{64}$/.test(item.sourceDigest??'')||seen.has(item.date))throw Error('Suivi de journée invalide');seen.add(item.date);}
 return {cursor:value.cursor,rejected:value.rejected,attemptedAt,pendingDays:value.pendingDays};
}
export async function saveQualificationCheckpoint(env:any,value:QualificationCheckpoint,now:number){
 const message=JSON.stringify({version:1,cursor:value.cursor,rejected:value.rejected,pendingDays:value.pendingDays});
 await env.DB.prepare('INSERT INTO weather_collection_status(channel,attempted_at,status,message) VALUES (?,?,?,?) ON CONFLICT(channel) DO UPDATE SET attempted_at=excluded.attempted_at,status=excluded.status,message=excluded.message WHERE weather_collection_status.attempted_at<=excluded.attempted_at').bind(CHANNEL,new Date(now).toISOString(),value.rejected.length?'partial':'ok',message).run();
}

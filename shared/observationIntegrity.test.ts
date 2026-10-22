import {describe,it,expect,vi} from 'vitest';
import {prepareObservations} from '../worker/station-observations';
import {verifyObservationArchive,readVerifiedObservations,countOverlappingHours} from '../worker/observation-integrity';
import {describeObservationFiles} from './archiveDiagnostics';
const now=Date.parse('2026-10-18T15:00:00Z'),HOUR=3600000;
const hash=async(text:string)=>Buffer.from(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text))).toString('hex');
async function fixture(){
 const {rows}=await prepareObservations({lat:50.7567,lon:2.5204,stations:[{id:'netatmo-test',temp:0,time:now-300000,distance:4,elevation:null},{id:'netatmo-other',temp:8,time:now-600000,distance:2}]},now);
 const payload={version:1,kind:'station_observations',source:'netatmo_browser_bridge',receivedAt:now,calibrationEligible:false,rows};
 const indexed=rows.map(row=>({id:row.id,station_key:row.stationKey,measured_at:row.measuredAt,received_at:row.receivedAt,temperature:row.temperature,distance:row.distance,elevation:row.elevation,source:row.source,quality_flags:JSON.stringify(row.flags),payload_digest:row.digest,calibration_eligible:0}));
 return {payload,indexed};
}
async function context(data:Awaited<ReturnType<typeof fixture>>){
 const text=JSON.stringify(data.payload),key='history/station-observations/'+await hash(text)+'.json';
 return {key,env:{BUCKET:{get:vi.fn(async()=>({size:Buffer.byteLength(text),arrayBuffer:async()=>new TextEncoder().encode(text).buffer}))},DB:{prepare:vi.fn(()=>({bind(){return this;},all:async()=>({results:data.indexed})}))}}};
}
describe('intégrité des fichiers physiques AI Lab',()=>{
 it('relit les mesures du writer, préserve zéro et accepte un sous-ensemble indexé',async()=>{
  const data=await fixture();data.indexed.pop();const {key,env}=await context(data);
  const result=await verifyObservationArchive(key,env,now);expect(result).toHaveLength(1);expect(result[0].temperature).toBe(0);
 });
 it('contrôle chaque colonne indexée, pas uniquement la température',async()=>{
  for(const [field,value] of Object.entries({id:'autre',station_key:'autre',measured_at:now,received_at:now-1,temperature:1,distance:5,elevation:1,source:'other',quality_flags:'["source_flagged"]',payload_digest:'wrong',calibration_eligible:1})){
   const data=await fixture();(data.indexed[0] as any)[field]=value;const {key,env}=await context(data);await expect(verifyObservationArchive(key,env,now)).rejects.toThrow('Index');
  }
 });
 it('rejette un contenu re-signé dont le digest interne ou la portée est incohérent',async()=>{
  const changes=[(p:any)=>p.source='other',(p:any)=>p.calibrationEligible=true,(p:any)=>p.receivedAt=now+1,(p:any)=>p.rows[0].temperature=42,(p:any)=>p.rows.push(p.rows[0]),(p:any)=>p.rows[0].distance=51,(p:any)=>p.rows[0].flags=['older_than_30_minutes'],(p:any)=>p.rows[0].measuredAt=now-91*60000];
  for(const change of changes){const data=await fixture();change(data.payload);const {key,env}=await context(data);await expect(verifyObservationArchive(key,env,now)).rejects.toThrow();}
 });
 it('refuse les fichiers manquants, altérés ou trop grands et les index vides ou dupliqués',async()=>{
  const data=await fixture(),{key,env}=await context(data);
  env.BUCKET.get.mockResolvedValueOnce(null as any);await expect(verifyObservationArchive(key,env,now)).rejects.toThrow('absente');
  env.BUCKET.get.mockResolvedValueOnce({size:500001} as any);await expect(verifyObservationArchive(key,env,now)).rejects.toThrow('grande');
  env.BUCKET.get.mockResolvedValueOnce({arrayBuffer:async()=>new TextEncoder().encode('altered').buffer} as any);await expect(verifyObservationArchive(key,env,now)).rejects.toThrow('Empreinte');
  data.indexed.push(data.indexed[0]);await expect(verifyObservationArchive(key,env,now)).rejects.toThrow('Index');
  data.indexed.length=0;await expect(verifyObservationArchive(key,env,now)).rejects.toThrow('Index');
 });
 it('borne la lecture à huit lots et signale chaque rejet sans écriture ni appel fournisseur',async()=>{
  const data=await fixture(),{key,env}=await context(data);let query=0;
  env.DB.prepare.mockImplementation(()=>({bind(){return this;},all:async()=>({results:query++===0?Array.from({length:9},(_,i)=>({object_key:i?'history/station-observations/'+String(i).repeat(64)+'.json':key})):data.indexed})}));
  const result=await readVerifiedObservations(env,now);expect(result.checkedArchives).toBe(8);expect(result.boundedRead).toBe(true);expect(env.BUCKET.get).toHaveBeenCalledTimes(8);
  expect(result.rejectedArchives).toBe(7);expect(result.rows.length).toBe(2);
 });
 it('ne confond ni heure en cours, ni prévision reçue après échéance, ni mesure signalée avec un créneau commun',()=>{
  const rows=[{stationKey:'s',measuredAt:now-30*60000,receivedAt:now,temperature:0,flags:[]},{stationKey:'s',measuredAt:now+1,receivedAt:now,temperature:0,flags:[]},{stationKey:'s',measuredAt:now-HOUR-1,receivedAt:now,temperature:0,flags:['source_flagged']}];
  const forecasts=[{receivedAt:now-2*HOUR,validAt:now-HOUR},{receivedAt:now-2*HOUR,validAt:now-HOUR},{receivedAt:now-3*HOUR,validAt:now-2*HOUR},{receivedAt:now,validAt:now}];
  expect(countOverlappingHours(rows,forecasts,now)).toBe(1);
  expect(countOverlappingHours(rows,[{receivedAt:now,validAt:now-HOUR}],now)).toBe(0);
  expect(countOverlappingHours(rows,forecasts,now-1)).toBe(0);
 });
 it('distingue les deux heures UTC du changement d’heure de Paris',()=>{
  const at=Date.parse('2026-10-25T03:00:00Z'),slots=[Date.parse('2026-10-25T00:00:00Z'),Date.parse('2026-10-25T01:00:00Z')];
  const rows=slots.map(slot=>({stationKey:'s',measuredAt:slot+600000,receivedAt:slot+900000,temperature:5,flags:[]}));
  expect(countOverlappingHours(rows,slots.map(validAt=>({receivedAt:validAt-HOUR,validAt})),at)).toBe(2);
 });
 it('ne remplace jamais un échec de lecture par zéro mesure vérifiée',()=>{
  expect(describeObservationFiles(undefined)).toContain('indisponible');
  const text=describeObservationFiles({status:'partial',checkedArchives:1,rejectedArchives:1,boundedRead:true,measurements:0,stations:0,rawHours:0,overlappingHours:null,forecastArchives:0,forecastReadBounded:true});
  expect(text).toContain('1 lot(s) ont été écartés');expect(text).toContain('aucune couverture quotidienne qualifiée');expect(text).toContain('indisponible');
 });
});

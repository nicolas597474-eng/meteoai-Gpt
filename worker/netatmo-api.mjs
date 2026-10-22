// API serveur uniquement : les secrets et jetons ne sont jamais renvoyés au client.
export const SITE_ORIGIN = 'https://meteoai-restauree-controle.givingbay1.chatgpt.site';
const CALLBACK = SITE_ORIGIN + '/api/netatmo/callback';
export const STATION_CACHE_MS = 10 * 60 * 1000;
// Une promesse par zone dans chaque instance ; le bail R2 protège aussi entre instances.
const stationFlights = new WeakMap();
const encoder = new TextEncoder();
const b64 = bytes => btoa(String.fromCharCode(...bytes));
const unb64 = value => Uint8Array.from(atob(value), c => c.charCodeAt(0));
const random = () => b64(crypto.getRandomValues(new Uint8Array(32))).replaceAll('+','-').replaceAll('/','_').replaceAll('=','');
const fail = (code, status=503) => { throw Object.assign(new Error(code), {status}); };
export async function digest(value) { return [...new Uint8Array(await crypto.subtle.digest('SHA-256',encoder.encode(value)))].map(b=>b.toString(16).padStart(2,'0')).join(''); }
export async function seal(value, secret, owner) {
  const key = await crypto.subtle.importKey('raw',unb64(secret),'AES-GCM',false,['encrypt']);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:encoder.encode(owner)},key,encoder.encode(JSON.stringify(value)));
  return JSON.stringify({iv:b64(iv),data:b64(new Uint8Array(data))});
}
export async function unseal(value, secret, owner) {
  const {iv,data} = JSON.parse(value);
  const key = await crypto.subtle.importKey('raw',unb64(secret),'AES-GCM',false,['decrypt']);
  const plain = await crypto.subtle.decrypt({name:'AES-GCM',iv:unb64(iv),additionalData:encoder.encode(owner)},key,unb64(data));
  return JSON.parse(new TextDecoder().decode(plain));
}
const rad = n => n*Math.PI/180;
export function stationZone(lat,lon,radius=20) {
  const row=Math.floor((lat+90)*10),column=Math.min(3599,Math.floor((lon+180)*10));
  const south=row/10-90,north=(row+1)/10-90,west=column/10-180,east=(column+1)/10-180;
  // La boîte couvre le rayon demandé de tout point de la cellule, pas seulement son centre.
  const delta=radius/110,latitudeEdge=Math.max(Math.abs(south-delta),Math.abs(north+delta));
  const dlon=delta/Math.max(.05,Math.cos(rad(latitudeEdge)));
  return {key:`${row}-${column}${radius===20?'':'-'+radius+'km'}`,query:new URLSearchParams({lat_ne:String(Math.min(90,north+delta)),lon_ne:String(Math.min(180,east+dlon)),lat_sw:String(Math.max(-90,south-delta)),lon_sw:String(Math.max(-180,west-dlon)),required_data:'temperature',filter:'true'})};
}
async function cachedZone(env,key,revision) {
  const object=await env.BUCKET.get(key);if(!object)return null;
  const result=await object.json(),age=Date.now()-result.at;
  return result.revision===revision&&age>=0&&age<STATION_CACHE_MS&&Array.isArray(result.body)?result:null;
}
async function shareStationFlight(env,key,load) {
  let flights=stationFlights.get(env.BUCKET);if(!flights){flights=new Map();stationFlights.set(env.BUCKET,flights);}
  if(!flights.has(key))flights.set(key,Promise.resolve().then(load).finally(()=>flights.delete(key)));
  return flights.get(key);
}
function km(a,b,c,d) { const x=Math.sin(rad(c-a)/2)**2+Math.cos(rad(a))*Math.cos(rad(c))*Math.sin(rad(d-b)/2)**2; return 12742*Math.asin(Math.min(1,Math.sqrt(x))); }
export function publicStations(body,lat,lon,radius=20,now=Date.now()) {
  if (!Array.isArray(body)) fail('NETATMO_INVALID_RESPONSE');
  return body.flatMap(s=>{
    const [lng,latitude]=s.place?.location??[];
    if (![lng,latitude].every(Number.isFinite)) return [];
    const distance=km(lat,lon,latitude,lng); if(distance>radius) return [];
    const readings=[],aux={pressure:[],windSpeed:[],windGust:[],windDirection:[],precipitation:[]};
    const add=(field,time,value,min,max)=>{
      if(Number.isFinite(time)&&time>0)aux[field].push({time,value:typeof value==='number'&&Number.isFinite(value)&&value>=min&&value<=max?value:null});
    };
    // Plusieurs variantes historiques existent dans getpublicdata, dont les
    // graphies « strengh » / « strenght » de la documentation Netatmo.
    const alias=(module,names)=>{
      const values=names.filter(name=>Object.hasOwn(module,name)).map(name=>module[name]);
      return values.length&&values.every(value=>value===values[0])?values[0]:null;
    };
    for(const m of Object.values(s.measures??{})) {
      if(!m||typeof m!=='object')continue;
      const types=Array.isArray(m.type)?m.type:typeof m.type==='string'?[m.type]:[];
      const i=types.indexOf('temperature'),humidityIndex=types.indexOf('humidity'),pressureIndex=types.indexOf('pressure');
      for(const [t,values] of Object.entries(m.res??{})) {
        const time=Number(t)*1000,temp=values?.[i];
        if(pressureIndex>=0)add('pressure',time,values?.[pressureIndex],300,1200);
        const rawHumidity=humidityIndex>=0?values?.[humidityIndex]:null;
        const humidity=typeof rawHumidity==='number'&&Number.isFinite(rawHumidity)&&rawHumidity>=0&&rawHumidity<=100?rawHumidity:null;
        if(i>=0&&Number.isFinite(time)&&typeof temp==='number'&&Number.isFinite(temp))readings.push({time,temp,humidity});
      }
      const windTime=typeof m.wind_timeutc==='number'?m.wind_timeutc*1000:NaN;
      add('windSpeed',windTime,alias(m,['wind_strength','wind_strengh']),0,300);
      add('windGust',windTime,alias(m,['gust_strength','gust_strenght','gust_strengh']),0,400);
      add('windDirection',windTime,m.wind_angle,0,360);
      // Cumul horaire uniquement : ni rain_live ni rain_24h ne le remplacent.
      add('precipitation',typeof m.rain_timeutc==='number'?m.rain_timeutc*1000:NaN,m.rain_60min,0,500);
    }
    readings.sort((a,b)=>b.time-a.time); const latest=readings[0]; if(!latest)return [];
    // Une humidité contradictoire au même instant reste inconnue ; aucun emprunt à un autre relevé.
    if(new Set(readings.filter(r=>r.time===latest.time&&r.humidity!==null).map(r=>r.humidity)).size>1)latest.humidity=null;
    const measurements={},measurementTimes={temperature:latest.time,...(latest.humidity!==null?{humidity:latest.time}:{})};
    for(const [field,candidates] of Object.entries(aux)){
      const time=candidates.length?Math.max(...candidates.map(row=>row.time)):null;
      const values=time===null?[]:candidates.filter(row=>row.time===time).map(row=>row.value);
      measurements[field]=values.length&&values[0]!==null&&values.every(value=>value===values[0])?values[0]:null;
      if(measurements[field]!==null)measurementTimes[field]=time;
    }
    const age=(now-latest.time)/60000;
    return [{id:`netatmo-${s._id}`,name:`Netatmo · ${s.place?.city||'Station extérieure'}`,lat:latitude,lon:lng,distance,elevation:Number.isFinite(s.place?.altitude)?s.place.altitude:null,...latest,...measurements,measurementTimes,precipitationPeriodMinutes:60,source:'Netatmo · réseau public',reliability:Math.max(0,Math.min(95,95-Math.max(0,age-10)*.5)),anomaly:age>90||age< -5||latest.temp< -45||latest.temp>55,interval:null}];
  }).sort((a,b)=>a.distance-b.distance);
}
const messages={
  NETATMO_SIGN_IN:'Reconnectez-vous à MeteoAI pour configurer Netatmo.',
  NETATMO_FORBIDDEN:'La requête de configuration n’est pas autorisée.',
  NETATMO_NOT_CONFIGURED:'Renseignez vos identifiants Netatmo dans la page Stations.',
  NETATMO_NOT_CONNECTED:'Autorisez la connexion à votre compte Netatmo.',
  NETATMO_RECONNECT_REQUIRED:'L’autorisation Netatmo a expiré ou a été refusée. Reconnectez Netatmo.',
  NETATMO_RATE_LIMIT:'La limite Netatmo est atteinte. Réessayez dans quelques minutes.',
  NETATMO_SCOPE:'Netatmo refuse l’accès aux stations publiques. Vérifiez les permissions de votre application Netatmo.',
  NETATMO_BUSY:'Une connexion Netatmo est en cours. Réessayez dans quelques secondes.',
  NETATMO_INVALID_CREDENTIALS:'Vérifiez le Client ID et le Client Secret de votre application Netatmo.',
  NETATMO_STATE:'Cette autorisation a expiré ou a déjà été utilisée. Relancez la connexion.',
  NETATMO_INVALID_COORDINATES:'Les coordonnées du lieu ne sont pas valides.',
  NETATMO_INVALID_RESPONSE:'La réponse Netatmo n’est pas exploitable.',
  NETATMO_UNAVAILABLE:'Netatmo est momentanément inaccessible. Les autres réseaux restent disponibles.',
  NETATMO_TIMEOUT:'Le délai de réponse Netatmo est dépassé. Nouvelle tentative après une courte attente.',
  NETATMO_NETWORK_ERROR:'La connexion à Netatmo a échoué. Nouvelle tentative après une courte attente.',
  NETATMO_PROVIDER_ERROR:'Le serveur Netatmo a renvoyé une erreur. Les anciennes réceptions gardent leur date.',
};
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'}});

// Bail R2 conditionnel : sérialise les modifications et les refresh entre Workers.
async function withLease(bucket,owner,fn,attempts=8) {
  const key=`netatmo/locks/${owner}`; let acquired=null;
  for(let i=0;i<attempts;i++) {
    const previous=await bucket.get(key);
    if(previous&&(await previous.json()).until>Date.now()) { await new Promise(r=>setTimeout(r,250)); continue; }
    acquired=await bucket.put(key,JSON.stringify({until:Date.now()+90000}),{onlyIf:previous?{etagMatches:previous.etag}:{etagDoesNotMatch:'*'}});
    if(acquired)break;
  }
  if(!acquired)fail('NETATMO_BUSY');
  try{return await fn();}finally{await bucket.put(key,JSON.stringify({until:0}),{onlyIf:{etagMatches:acquired.etag}});}
}
async function readVault(env,owner) {
  const object=await env.BUCKET.get(`netatmo/vault/${owner}`);
  return object?unseal(await object.text(),env.NETATMO_ENCRYPTION_KEY,owner):null;
}
async function saveVault(env,owner,value) { await env.BUCKET.put(`netatmo/vault/${owner}`,await seal(value,env.NETATMO_ENCRYPTION_KEY,owner)); }
const diagnosticKey=owner=>`netatmo/diagnostics-v1/${owner}`;
export async function readNetatmoDiagnostic(env,owner,revision){
 try{const object=await env.BUCKET.get(diagnosticKey(owner)),data=object?await object.json():null,now=Date.now();
  const buckets=data?.version===1&&(!revision||data.revision===revision)?(data.buckets??[]).filter(b=>Number.isSafeInteger(b.hour)&&b.hour<=now&&b.hour>=Math.floor(now/3600000)*3600000-23*3600000):[];
  const totals={requests:0,success:0,rateLimited:0,forbidden:0,providerErrors:0,networkErrors:0,timeouts:0};
  for(const b of buckets)for(const key of Object.keys(totals))totals[key]+=Number.isSafeInteger(b[key])&&b[key]>=0?b[key]:0;
  return {version:1,available:true,checkedAt:now,totals,last:buckets.length&&data?.last?data.last:null,quotaRemaining:null};
 }catch{return {version:1,available:false,checkedAt:Date.now(),totals:null,last:null,quotaRemaining:null};}
}
async function netatmoRequest(env,owner,vault,endpoint,url,init,fetcher){
 const now=Date.now(),previous=await readNetatmoDiagnostic(env,owner,vault.revision);
 if(previous.last?.retryAt>now)fail(previous.last.code==='NETATMO_RATE_LIMIT'?'NETATMO_RATE_LIMIT':'NETATMO_UNAVAILABLE',previous.last.code==='NETATMO_RATE_LIMIT'?429:503);
 let response,error;
 try{response=await fetcher(url,init);}catch(e){error=e;}
 const status=response?.status??null,code=error?(error.name==='TimeoutError'||error.name==='AbortError'?'NETATMO_TIMEOUT':'NETATMO_NETWORK_ERROR'):status===429?'NETATMO_RATE_LIMIT':status===403?'NETATMO_SCOPE':status>=500?'NETATMO_PROVIDER_ERROR':status>=400?'NETATMO_HTTP_ERROR':'ok';
 let retryAt=null;
 if(status===429||status>=500||error){const header=response?.headers.get('Retry-After'),seconds=header&&/^\d+$/.test(header)?Number(header)*1000:NaN,parsed=header?Date.parse(header):NaN;retryAt=Math.min(now+86400000,Math.max(now+60000,Number.isFinite(seconds)?now+seconds:Number.isFinite(parsed)&&parsed>now?parsed:now+(status===429?600000:60000)));}
 try{
  const old=await env.BUCKET.get(diagnosticKey(owner)),data=old?await old.json():null,hour=Math.floor(now/3600000)*3600000;
  const buckets=data?.version===1&&data.revision===vault.revision?(data.buckets??[]).filter(b=>Number.isSafeInteger(b.hour)&&b.hour<=now&&b.hour>=hour-47*3600000):[];
  let b=buckets.find(b=>b.hour===hour);if(!b){b={hour,requests:0,success:0,rateLimited:0,forbidden:0,providerErrors:0,networkErrors:0,timeouts:0};buckets.push(b);}
  b.requests++;if(response?.ok)b.success++;if(status===429)b.rateLimited++;if(status===403)b.forbidden++;if(status>=500)b.providerErrors++;if(error)b.networkErrors++;if(code==='NETATMO_TIMEOUT')b.timeouts++;
  await env.BUCKET.put(diagnosticKey(owner),JSON.stringify({version:1,revision:vault.revision,buckets,last:{at:now,endpoint,status,code,retryAt}}));
 }catch{/* Le diagnostic facultatif ne supprime jamais une réception réussie. */}
 if(error)fail(code==='NETATMO_TIMEOUT'?'NETATMO_TIMEOUT':'NETATMO_NETWORK_ERROR');return response;
}
async function tokenExchange(vault,params,fetcher,env,owner) {
  const url='https://api.netatmo.com/oauth2/token',init={method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:vault.clientId,client_secret:vault.clientSecret,...params}),signal:AbortSignal.timeout(15000)};
  const response=env?await netatmoRequest(env,owner,vault,'oauth',url,init,fetcher):await fetcher(url,init);
  if(!response.ok)fail(response.status===429?'NETATMO_RATE_LIMIT':response.status>=500?'NETATMO_PROVIDER_ERROR':response.status===403?'NETATMO_SCOPE':'NETATMO_RECONNECT_REQUIRED',response.status===429?429:response.status>=500?503:response.status===403?403:401);
  const data=await response.json();
  if(typeof data.access_token!=='string'||typeof data.refresh_token!=='string'||!Number.isFinite(data.expires_in)||data.expires_in<=0)fail('NETATMO_INVALID_RESPONSE');
  if(Array.isArray(data.scope)&&!data.scope.includes('read_station'))fail('NETATMO_SCOPE',403);
  return {access:data.access_token,refresh:data.refresh_token,expiresAt:Date.now()+data.expires_in*1000};
}
const cookieName='__Secure-meteoai-netatmo';
const stateCookie=(state,age=600)=>`${cookieName}=${state}; Path=/api/netatmo; Max-Age=${age}; Secure; HttpOnly; SameSite=Lax`;
function callbackRedirect(result) { return new Response(null,{status:303,headers:{Location:`${SITE_ORIGIN}/connexion-netatmo?netatmo=${result}`,'Set-Cookie':stateCookie('',0),'Cache-Control':'no-store','Referrer-Policy':'no-referrer'}}); }

/** Source serveur commune au navigateur et au collecteur autorisé, sans identité fabriquée. */
async function stationResult(env,owner,lat,lon,radius,fetcher,minimumReceivedAt=0){
      const v=await readVault(env,owner);if(!v)fail('NETATMO_NOT_CONFIGURED',409);if(!v.tokens)fail('NETATMO_NOT_CONNECTED',409);if(v.needsReconnect)fail('NETATMO_RECONNECT_REQUIRED',401);
      const zone=stationZone(lat,lon,radius),cacheKey=`netatmo/cache-zones-v2/${owner}/${zone.key}`;
      const cached=await cachedZone(env,cacheKey,v.revision);if(cached&&cached.at>=minimumReceivedAt)return {...cached,cacheHit:true};
      const result=await shareStationFlight(env,`${cacheKey}/${v.revision}/${minimumReceivedAt}`,()=>withLease(env.BUCKET,owner,async()=>{
        const vault=await readVault(env,owner);if(!vault?.tokens)fail('NETATMO_NOT_CONNECTED',409);
        if(vault.needsReconnect)fail('NETATMO_RECONNECT_REQUIRED',401);
        const fresh=await cachedZone(env,cacheKey,vault.revision);if(fresh&&fresh.at>=minimumReceivedAt)return {...fresh,cacheHit:true};
        const refresh=async()=>{try{vault.tokens=await tokenExchange(vault,{grant_type:'refresh_token',refresh_token:vault.tokens.refresh},fetcher,env,owner);await saveVault(env,owner,vault);}catch(e){if(e.message==='NETATMO_RECONNECT_REQUIRED'){vault.needsReconnect=true;await saveVault(env,owner,vault);}throw e;}};
        if(vault.tokens.expiresAt<Date.now()+60000)await refresh();
        const get=()=>netatmoRequest(env,owner,vault,'stations','https://api.netatmo.com/api/getpublicdata?'+zone.query,{headers:{Authorization:'Bearer '+vault.tokens.access},signal:AbortSignal.timeout(10000)},fetcher);
        let response=await get();if(response.status===401){await refresh();response=await get();}
        if(response.status===401){vault.needsReconnect=true;await saveVault(env,owner,vault);fail('NETATMO_RECONNECT_REQUIRED',401);}
        if(!response.ok)fail(response.status===429?'NETATMO_RATE_LIMIT':response.status===403?'NETATMO_SCOPE':response.status>=500?'NETATMO_PROVIDER_ERROR':'NETATMO_UNAVAILABLE',response.status===429?429:response.status===403?403:503);
        const body=await response.json();if(body.error||!Array.isArray(body.body))fail('NETATMO_INVALID_RESPONSE');
        // Stocker la zone entière : distance, fraîcheur et anomalies sont recalculées pour chaque lieu.
        const result={body:body.body,at:Date.now(),revision:vault.revision};
        await env.BUCKET.put(cacheKey,JSON.stringify(result));return result;
      },80));
      return result;
}

/** Le propriétaire est configuré côté serveur après autorisation, jamais fourni par l'appelant. */
export async function collectNetatmoBackground(env,fetcher=fetch){
  if(env.METEOAI_BACKGROUND_ENABLED!=='true'||!/^[a-f0-9]{64}$/.test(env.METEOAI_BACKGROUND_OWNER??''))fail('NETATMO_FORBIDDEN',403);
  const lat=50.7567,lon=2.5204,radius=50;
  // Le cache de l'heure précédente ne constitue pas une nouvelle réception horaire.
  const minimumReceivedAt=Math.floor(Date.now()/3600000)*3600000;
  const result=await stationResult(env,env.METEOAI_BACKGROUND_OWNER,lat,lon,radius,fetcher,minimumReceivedAt);
  return {lat,lon,radiusKm:radius,providerReceivedAt:result.at,stations:publicStations(result.body,lat,lon,radius)};
}

async function handleNetatmoInternal(request,env,fetcher=fetch) {
  const url=new URL(request.url),path=url.pathname;
  try {
    const user=request.headers.get('oai-authenticated-user-id'); if(!user)fail('NETATMO_SIGN_IN',401);
    if(!env.BUCKET||!env.NETATMO_ENCRYPTION_KEY)fail('NETATMO_UNAVAILABLE');
    const owner=await digest(user),vaultKey=`netatmo/vault/${owner}`;
    if(!['GET','POST'].includes(request.method))return json({error:'Méthode non autorisée.'},405);
    if(request.method==='POST'&&(request.headers.get('Origin')!==SITE_ORIGIN||!request.headers.get('Content-Type')?.startsWith('application/json')))fail('NETATMO_FORBIDDEN',403);
    if(path==='/api/netatmo/diagnostic'&&request.method==='GET') {
      const vault=await readVault(env,owner);
      return json({...await readNetatmoDiagnostic(env,owner,vault?.revision),configured:!!vault,connected:!!vault?.tokens&&!vault.needsReconnect});
    }
    if(path==='/api/netatmo/status'&&request.method==='GET') {
      const v=await readVault(env,owner);
      return json({configured:!!v?.clientId,connected:!!v?.tokens,needsReconnect:!!v?.needsReconnect,redirectUri:CALLBACK});
    }
    if(path==='/api/netatmo/configure'&&request.method==='POST') {
      const raw=await request.text();if(raw.length>4096)fail('NETATMO_INVALID_CREDENTIALS',400);
      let data;try{data=JSON.parse(raw);}catch{fail('NETATMO_INVALID_CREDENTIALS',400);}
      const clientId=typeof data.clientId==='string'?data.clientId.trim():'',clientSecret=typeof data.clientSecret==='string'?data.clientSecret.trim():'';
      if(!/^[a-zA-Z0-9_-]{8,200}$/.test(clientId)||!clientSecret||clientSecret.length<8||clientSecret.length>500||/\s/.test(clientSecret))fail('NETATMO_INVALID_CREDENTIALS',400);
      await withLease(env.BUCKET,owner,()=>saveVault(env,owner,{clientId,clientSecret,revision:random(),tokens:null}));
      return json({configured:true,connected:false});
    }
    if(path==='/api/netatmo/connect'&&request.method==='POST') {
      return await withLease(env.BUCKET,owner,async()=>{
        const v=await readVault(env,owner);if(!v)fail('NETATMO_NOT_CONFIGURED',409);
        const state=random();
        await env.BUCKET.put(`netatmo/oauth/${owner}`,await seal({hash:await digest(state),expires:Date.now()+600000,revision:v.revision},env.NETATMO_ENCRYPTION_KEY,owner));
        const params=new URLSearchParams({client_id:v.clientId,redirect_uri:CALLBACK,response_type:'code',scope:'read_station',state});
        const response=json({url:'https://api.netatmo.com/oauth2/authorize?'+params});response.headers.set('Set-Cookie',stateCookie(state));return response;
      });
    }
    if(path==='/api/netatmo/callback'&&request.method==='GET') {
      try {
        await withLease(env.BUCKET,owner,async()=>{
          const state=url.searchParams.get('state'),cookie=request.headers.get('Cookie')?.split(';').map(s=>s.trim()).find(s=>s.startsWith(cookieName+'='))?.slice(cookieName.length+1);
          if(!state||state!==cookie)fail('NETATMO_STATE',400);
          const object=await env.BUCKET.get(`netatmo/oauth/${owner}`);if(!object)fail('NETATMO_STATE',400);
          const saved=await unseal(await object.text(),env.NETATMO_ENCRYPTION_KEY,owner),v=await readVault(env,owner);
          if(saved.used||saved.expires<Date.now()||saved.hash!==await digest(state)||saved.revision!==v?.revision)fail('NETATMO_STATE',400);
          // Consommation avant échange : une URL de retour ne peut pas être rejouée.
          await env.BUCKET.put(`netatmo/oauth/${owner}`,await seal({...saved,used:true},env.NETATMO_ENCRYPTION_KEY,owner));
          if(url.searchParams.has('error')||!url.searchParams.get('code'))fail('NETATMO_RECONNECT_REQUIRED',401);
          v.tokens=await tokenExchange(v,{grant_type:'authorization_code',code:url.searchParams.get('code'),redirect_uri:CALLBACK},fetcher);v.needsReconnect=false;
          await saveVault(env,owner,v);
        });
        return callbackRedirect('connected');
      }catch{return callbackRedirect('failed');}
    }
    if(path==='/api/netatmo/disconnect'&&request.method==='POST') {
      await withLease(env.BUCKET,owner,async()=>{await env.BUCKET.delete(vaultKey);await env.BUCKET.delete(`netatmo/oauth/${owner}`);});
      return json({configured:false,connected:false});
    }
    if(path==='/api/netatmo/stations'&&request.method==='GET') {
      const latRaw=url.searchParams.get('lat'),lonRaw=url.searchParams.get('lon'),lat=Number(latRaw),lon=Number(lonRaw);
      if(latRaw===null||lonRaw===null||!Number.isFinite(lat)||!Number.isFinite(lon)||Math.abs(lat)>85||Math.abs(lon)>180)fail('NETATMO_INVALID_COORDINATES',400);
      const radius=Number(url.searchParams.get('radiusKm')??20);if(radius!==20&&radius!==50)fail('NETATMO_INVALID_COORDINATES',400);
      const result=await stationResult(env,owner,lat,lon,radius,fetcher);
      const answer=async(result,cacheHit=false)=>{
        const stations=publicStations(result.body,lat,lon,radius);
        // L'archivage interne reçoit exclusivement le résultat serveur, jamais une liste fournie par le navigateur.
        if(env.archivePhysicalStations&&lat===50.7567&&lon===2.5204&&radius===50){
          try{await env.archivePhysicalStations({lat,lon,radiusKm:radius,stations,providerReceivedAt:result.at});}catch{console.warn('Archivage des mesures serveur indisponible ; affichage des stations conservé.');}
        }
        return json({radiusKm:radius,stations,at:result.at,expiresAt:result.at+STATION_CACHE_MS,cacheHit:cacheHit||result.cacheHit===true});
      };
      return await answer(result);
    }
    return json({error:'Route introuvable.'},404);
  }catch(e){const code=messages[e.message]?e.message:'NETATMO_UNAVAILABLE';return json({code,error:messages[code]},e.status??503);}
}

/** Connexion propre à ce Site ; aucune passerelle inter-applications. */
export async function handleNetatmo(request,env,fetcher=fetch){
 const origin=request.headers.get('Origin');
 if(origin&&origin!==SITE_ORIGIN)return json({error:'Origine non autorisée.'},403);
 return handleNetatmoInternal(request,env,fetcher);
}

/* Coquille et dernières données : stale-while-revalidate, sans inventer de réponse météo. */
const VERSION='atmosphere-v1.0.2', SHELL=`${VERSION}-shell`, DATA=`${VERSION}-data`;
const BUILD_ASSETS = [];
const ORIGINS=['https://api.open-meteo.com','https://geocoding-api.open-meteo.com','https://archive-api.open-meteo.com','https://api.opensensemap.org','https://public.opendatasoft.com'];
self.addEventListener('install',event=>event.waitUntil(caches.open(SHELL).then(cache=>cache.addAll(['/','/manifest.webmanifest','/icon.svg','/icons/icon-192.png','/icons/icon-512.png',...BUILD_ASSETS]))));
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key.startsWith('atmosphere-')&&!key.startsWith(VERSION)).map(key=>caches.delete(key)))).then(()=>self.clients.claim())));
self.addEventListener('message',event=>{if(event.data?.type==='SKIP_WAITING')self.skipWaiting();});
self.addEventListener('fetch',event=>{
  if(event.request.method!=='GET')return;
  const url=new URL(event.request.url), same=url.origin===self.location.origin, weather=ORIGINS.includes(url.origin);
  if(!same&&!weather)return;
  if(same&&url.pathname.startsWith('/api/'))return;
  if(event.request.mode==='navigate'){
    event.respondWith(fetch(event.request).then(async response=>{if(response.ok){const cache=await caches.open(SHELL);await cache.put('/',response.clone());}return response;}).catch(async()=>await caches.match('/')||new Response('MeteoAI : ouvrez une première fois l’application avec une connexion.',{status:503,headers:{'Content-Type':'text/plain;charset=utf-8'}})));
    return;
  }
  event.respondWith((async()=>{
    const cache=await caches.open(weather?DATA:SHELL), cached=await cache.match(event.request);
    const refresh=fetch(event.request).then(async response=>{
      if(response.ok){
        let stored=response;
        if(weather){const headers=new Headers(response.headers);headers.set('X-MeteoAI-Fetched-At',String(Date.now()));stored=new Response(await response.blob(),{status:response.status,statusText:response.statusText,headers});}
        await cache.put(event.request,stored.clone());
        if(weather){const keys=await cache.keys();if(keys.length>100)await Promise.all(keys.slice(0,keys.length-100).map(key=>cache.delete(key)));}
        return stored;
      }
      return response;
    });
    if(cached&&event.request.cache!=='reload'){event.waitUntil(refresh.catch(()=>{}));return cached;}
    if(cached&&event.request.cache==='reload'){try{return await refresh;}catch{return cached;}}
    try{return await refresh;}catch{return new Response(JSON.stringify({error:true,reason:'Hors ligne et aucune donnée en cache.'}),{status:503,headers:{'Content-Type':'application/json'}});}
  })());
});

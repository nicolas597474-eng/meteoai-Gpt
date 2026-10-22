// Coquille complète et illustrations visitées. Les API et identités sont exclues.
// Le paquet de production injecte les actifs et une version calculée sur leur contenu.
const SHELL_CACHE = "meteoai-shell-__BUILD_VERSION__";
const PRECACHE_URLS = ["/", "/manifest.webmanifest"];
const PAGES=new Set(['/','/details','/ai-lab','/favorites','/ranking','/stations','/laboratoire','/history','/lab','/reliability']);
const staticPath=path=>path.startsWith('/assets/')||path==='/manifest.webmanifest'||/^\/manus-storage\/[^/]+\.(png|webp|jpg)$/.test(path);
const cacheable=response=>response.ok&&!response.redirected&&new URL(response.url||self.location.origin).origin===self.location.origin;

self.addEventListener('install',event=>event.waitUntil((async()=>{
 const cache=await caches.open(SHELL_CACHE);
 // Pas de skipWaiting ici : l’utilisateur choisit quand installer la mise à jour.
 for(const path of PRECACHE_URLS){
  const request=new Request(new URL(path,self.location.origin),{cache:'reload',credentials:'same-origin'}),response=await fetch(request);
  if(!cacheable(response))throw new Error('Coquille indisponible');
  await cache.put(request,response);
 }
})()));
self.addEventListener('message',event=>{if(event.data?.type==='SKIP_WAITING')void self.skipWaiting();});
self.addEventListener('activate',event=>event.waitUntil((async()=>{
 for(const key of await caches.keys())if(key.startsWith('meteoai-shell-')&&key!==SHELL_CACHE)await caches.delete(key);
 await self.clients.claim();
})()));
self.addEventListener('fetch',event=>{
 const request=event.request,url=new URL(request.url);
 if(request.method!=='GET'||url.origin!==self.location.origin)return;
 // Aucun cache générique : ni API, ni identité, ni page privée renvoyant des données.
 if(request.mode==='navigate'&&PAGES.has(url.pathname)){
  event.respondWith((async()=>{
   try{
    const response=await fetch(request);
    if(cacheable(response)&&response.headers.get('Content-Type')?.includes('text/html')){const copy=response.clone();event.waitUntil(caches.open(SHELL_CACHE).then(cache=>cache.put('/',copy)));}
    return response;
   }catch{return await (await caches.open(SHELL_CACHE)).match('/')??new Response('Ouvrez MeteoAI une première fois avec une connexion pour préparer le mode hors ligne.',{status:503,headers:{'Content-Type':'text/plain; charset=utf-8'}});}
  })());
  return;
 }
 if(!staticPath(url.pathname))return;
 event.respondWith((async()=>{
  const cache=await caches.open(SHELL_CACHE),saved=await cache.match(request);if(saved)return saved;
  const response=await fetch(request);
  if(cacheable(response))event.waitUntil((async()=>{
   await cache.put(request,response.clone());
   if(url.pathname.startsWith('/manus-storage/')){
    const images=(await cache.keys()).filter(key=>new URL(key.url).pathname.startsWith('/manus-storage/'));
    for(const key of images.slice(0,Math.max(0,images.length-32)))await cache.delete(key);
   }
  })());
  return response;
 })());
});

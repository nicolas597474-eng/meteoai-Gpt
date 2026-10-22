import {bindSkyAnimation,skyQuality,type SkyScene} from './atmosphericSky';
const mix=(a:number[],b:number[],t:number)=>a.map((v,i)=>Math.round(v+(b[i]-v)*Math.max(0,Math.min(1,t))));
const rgb=(c:number[])=>`rgb(${c.join(',')})`;
function random(seed:number){let s=seed>>>0;return ()=>{s=(Math.imul(s,1664525)+1013904223)>>>0;return s/4294967296;};}
function noise(x:number,y:number,seed:number){
 const hash=(a:number,b:number)=>{let n=Math.imul(a,374761393)+Math.imul(b,668265263)+seed*144269;n=Math.imul(n^(n>>>13),1274126177);return ((n^(n>>>16))>>>0)/4294967295;};
 const ix=Math.floor(x),iy=Math.floor(y),u=x-ix,v=y-iy,s=u*u*(3-2*u),t=v*v*(3-2*v);
 return (hash(ix,iy)*(1-s)+hash(ix+1,iy)*s)*(1-t)+(hash(ix,iy+1)*(1-s)+hash(ix+1,iy+1)*s)*t;
}
function fbm(x:number,y:number,seed:number){let total=0,amplitude=.54;for(let i=0;i<4;i++){total+=noise(x,y,seed+i*13)*amplitude;x=x*2.07+4.3;y=y*2.07-2.7;amplitude*=.48;}return total;}
/** Texture volumétrique précalculée : bruit fractal, amas diffus et lumière supérieure.
 * Pas de bruit, de flou CSS ou de pixels recalculés dans la boucle d'animation. */
function cloudSprite(seed:number,light:number){
 const canvas=document.createElement('canvas');canvas.width=224;canvas.height=128;
 const ctx=canvas.getContext('2d');if(!ctx)return canvas;
 const data=ctx.createImageData(canvas.width,canvas.height),rnd=random(seed);
 const puffs=Array.from({length:10},(_,i)=>({x:.12+i*.078,y:.39+rnd()*.24,rx:.11+rnd()*.07,ry:.13+rnd()*.18}));
 for(let y=0;y<128;y++)for(let x=0;x<224;x++){
  const u=x/224,v=y/128,n=fbm(u*5,v*4,seed);
  let envelope=0;for(const p of puffs)envelope=Math.max(envelope,Math.exp(-((u-p.x)**2/(p.rx*p.rx)+(v-p.y)**2/(p.ry*p.ry))*1.5));
  const edge=Math.min(1,x/28,(223-x)/28,y/18,(127-y)/18);
  const fade=edge*edge*(3-2*edge);
  const density=Math.max(0,envelope*.95+n*.43-.42),alpha=(1-Math.exp(-density*4))*Math.min(1,envelope*3)*fade;
  if(alpha<.004)continue;
  const illumination=Math.max(0,Math.min(1,.91-v*.5+(n-.45)*.85));
  const shade=mix([78,96,119],[249,251,251],illumination);
  const color=mix([18+shade[0]*.22,27+shade[1]*.24,46+shade[2]*.3],shade,light);
  const i=(y*224+x)*4;data.data[i]=color[0];data.data[i+1]=color[1];data.data[i+2]=color[2];data.data[i+3]=Math.round(alpha*235);
 }
 ctx.putImageData(data,0,0);return canvas;
}
type Cloud={x:number;y:number;size:number;depth:number;variant:number};
export function createAtmosphericRenderer(canvas:HTMLCanvasElement,initial:SkyScene,options:{reduced:boolean;static:boolean}){
 const ctx=canvas.getContext('2d',{alpha:false});if(!ctx)return {update:(_:SkyScene)=>{},dispose:()=>{}};
 let scene=initial,width=1,height=1,quality=skyQuality(innerWidth,options.reduced),sprites:HTMLCanvasElement[]=[],spriteLight=-1;
 const rnd=random(24731),clouds:Cloud[]=Array.from({length:18},(_,i)=>({x:rnd()*2-1,y:rnd()*.95-.12,size:.75+rnd()*.9,depth:.45+rnd()*.55,variant:i%3}));
 const drops=Array.from({length:32},()=>({x:rnd(),y:rnd(),depth:.4+rnd()*.6}));
 function draw(dt:number){
  if(!ctx)return;
  const day=scene.daylight,storm=scene.coverage*.48+scene.rain*.25;
  const top=mix(mix([3,10,29],[22,95,161],day),[68,86,109],storm*day);
  const horizon=mix(mix([17,31,64],[130,182,217],day),scene.morning?[247,156,117]:[222,132,158],scene.twilight*.85*(1-scene.coverage*.4));
  const gradient=ctx.createLinearGradient(0,0,0,height);gradient.addColorStop(0,rgb(top));gradient.addColorStop(.7,rgb(horizon));gradient.addColorStop(1,rgb(mix(horizon,top,.28)));
  ctx.globalAlpha=1;ctx.fillStyle=gradient;ctx.fillRect(0,0,width,height);
  if(scene.coverage<.72){
   const glow=ctx.createRadialGradient(width*.77,height*.23,0,width*.77,height*.23,width*.7);
   glow.addColorStop(0,`rgba(255,224,179,${.17*day*(1-scene.coverage)})`);glow.addColorStop(1,'rgba(255,224,179,0)');ctx.fillStyle=glow;ctx.fillRect(0,0,width,height);
  }
  const light=Math.round(day*8)/8;
  if(spriteLight!==light){sprites=[cloudSprite(71,light),cloudSprite(193,light),cloudSprite(349,light)];spriteLight=light;}
  const count=Math.ceil(scene.coverage*quality.maxClouds);
  for(let i=0;i<count;i++){
   const c=clouds[i];c.x+=dt*scene.drift*c.depth/width;if(c.x>1.2)c.x=-c.size*1.3;
   const w=width*c.size,h=w*.56;
   ctx.globalAlpha=(.30+scene.coverage*.56)*c.depth;
   ctx.drawImage(sprites[c.variant],c.x*width,c.y*height,w,h);
  }
  ctx.globalAlpha=1;
  if(scene.rain>0){
   ctx.fillStyle=`rgba(66,78,96,${scene.rain*.14})`;ctx.fillRect(0,0,width,height);
   const count=Math.ceil(scene.rain*quality.maxDrops);ctx.strokeStyle=`rgba(210,227,241,${.09+scene.rain*.1})`;ctx.lineWidth=.65;
   ctx.beginPath();for(let i=0;i<count;i++){const d=drops[i];d.y+=dt*(.2+d.depth*.17);d.x+=dt*.012;if(d.y>1.05){d.y=-.05;d.x=rnd();}const x=d.x*width,y=d.y*height;ctx.moveTo(x,y);ctx.lineTo(x+1+scene.wind*.06,y+8+d.depth*14);}ctx.stroke();
  }
  // Voile de contraste constant pour les textes blancs, indépendant des mesures.
  ctx.fillStyle='rgba(3,13,29,.14)';ctx.fillRect(0,0,width,height);
 }
 function resize(){
  width=Math.max(1,canvas.clientWidth);height=Math.max(1,canvas.clientHeight);quality=skyQuality(width,options.reduced);
  const ratio=Math.min(window.devicePixelRatio||1,quality.dpr,1600/Math.max(width,height));
  canvas.width=Math.round(width*ratio);canvas.height=Math.round(height*ratio);ctx!.setTransform(ratio,0,0,ratio,0,0);loop?.invalidate();
 }
 let loop:ReturnType<typeof bindSkyAnimation>|undefined;resize();
 const animated=()=>!options.static&&(scene.coverage>0&&scene.wind>0||scene.rain>0);
 loop=bindSkyAnimation({document,request:fn=>window.requestAnimationFrame(fn),cancel:id=>window.cancelAnimationFrame(id),draw,fps:quality.fps,animate:animated()});
 const observer=typeof ResizeObserver==='function'?new ResizeObserver(resize):null;observer?.observe(canvas);window.addEventListener('resize',resize);
 return {update(next:SkyScene){scene=next;loop?.setAnimated(animated());loop?.invalidate();},dispose(){loop?.dispose();observer?.disconnect();window.removeEventListener('resize',resize);sprites=[];canvas.width=1;canvas.height=1;}};
}

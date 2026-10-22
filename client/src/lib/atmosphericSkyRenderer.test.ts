import {afterEach,expect,it,vi} from 'vitest';
import {createAtmosphericRenderer} from './atmosphericSkyRenderer';
import {makeSkyScene} from './atmosphericSky';
afterEach(()=>vi.unstubAllGlobals());
it('garde les méthodes rAF liées à Window et précalcule les textures hors de la boucle',()=>{
 const frames=new Map<number,FrameRequestCallback>(),listeners=new Map<string,()=>void>();let id=0;
 const gradient={addColorStop:vi.fn()},context={createImageData:(w:number,h:number)=>({data:new Uint8ClampedArray(w*h*4)}),putImageData:vi.fn(),createLinearGradient:()=>gradient,createRadialGradient:()=>gradient,setTransform:vi.fn(),fillRect:vi.fn(),drawImage:vi.fn(),beginPath:vi.fn(),moveTo:vi.fn(),lineTo:vi.fn(),stroke:vi.fn()};
 const fakeDocument={hidden:false,createElement:()=>({getContext:()=>context}),addEventListener:(name:string,fn:()=>void)=>listeners.set(name,fn),removeEventListener:(name:string)=>listeners.delete(name)};
 const fakeWindow={devicePixelRatio:3,addEventListener:vi.fn(),removeEventListener:vi.fn(),requestAnimationFrame:function(fn:FrameRequestCallback){expect(this).toBe(fakeWindow);frames.set(++id,fn);return id;},cancelAnimationFrame:function(n:number){expect(this).toBe(fakeWindow);frames.delete(n);}};
 vi.stubGlobal('document',fakeDocument);vi.stubGlobal('window',fakeWindow);vi.stubGlobal('innerWidth',390);vi.stubGlobal('ResizeObserver',undefined);
 const canvas={clientWidth:390,clientHeight:844,width:0,height:0,getContext:()=>context} as unknown as HTMLCanvasElement;
 const now=Date.parse('2026-10-20T12:00:00Z'),scene=makeSkyScene({capturedAt:new Date(now).toISOString(),cloudCover:100,windSpeed:20},50.76,2.52,now);
 const renderer=createAtmosphericRenderer(canvas,scene,{reduced:false,static:false});
 expect(canvas.width).toBeLessThanOrEqual(488);expect(frames.size).toBe(1);expect(context.putImageData).toHaveBeenCalledTimes(3);
 for(const call of context.putImageData.mock.calls){
  const pixels=(call as unknown as [{data:Uint8ClampedArray}])[0].data;
  for(let y=0;y<128;y++){expect(pixels[(y*224)*4+3]).toBe(0);expect(pixels[(y*224+223)*4+3]).toBe(0);}
  for(let x=0;x<224;x++){expect(pixels[x*4+3]).toBe(0);expect(pixels[(127*224+x)*4+3]).toBe(0);}
 }
 for(const time of [100,150,200,250]){const pending=[...frames.values()];frames.clear();pending.forEach(fn=>fn(time));}
 expect(context.drawImage).toHaveBeenCalled();expect(context.putImageData).toHaveBeenCalledTimes(3);
 fakeDocument.hidden=true;listeners.get('visibilitychange')!();expect(frames.size).toBe(0);
 fakeDocument.hidden=false;listeners.get('visibilitychange')!();expect(frames.size).toBe(1);
 renderer.dispose();expect(frames.size).toBe(0);expect(listeners.size).toBe(0);
});

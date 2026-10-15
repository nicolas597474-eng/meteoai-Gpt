// Icône vectorielle rasterisée de façon déterministe, sans service externe.
import { mkdirSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
const directory=new URL('../public/icons/',import.meta.url);mkdirSync(directory,{recursive:true});
const crcTable=Array.from({length:256},(_,n)=>{for(let k=0;k<8;k++)n=n&1?0xedb88320^(n>>>1):n>>>1;return n>>>0;});
function crc32(buffer){let c=0xffffffff;for(const b of buffer)c=crcTable[(c^b)&255]^(c>>>8);return (c^0xffffffff)>>>0;}
function chunk(type,data){const name=Buffer.from(type),size=Buffer.alloc(4),crc=Buffer.alloc(4);size.writeUInt32BE(data.length);crc.writeUInt32BE(crc32(Buffer.concat([name,data])));return Buffer.concat([size,name,data,crc]);}
function render(size,maskable=false){
  const scale=maskable?.78:1,samples=2,raw=Buffer.alloc((size*4+1)*size);
  for(let y=0;y<size;y++){const row=y*(size*4+1);raw[row]=0;for(let x=0;x<size;x++){
    const color=[0,0,0];for(let sy=0;sy<samples;sy++)for(let sx=0;sx<samples;sx++){
      const px=((x+(sx+.5)/samples)/size*512-256)/scale+256,py=((y+(sy+.5)/samples)/size*512-256)/scale+256;
      const t=y/size,c=[Math.round(37-17*t),Math.round(62-18*t),Math.round(80-19*t)];
      const sun=(px-302)**2+(py-193)**2<72**2;
      if(sun){c[0]=246;c[1]=Math.round(216-(py-120)/146*31);c[2]=Math.round(169-(py-120)/146*35);}
      const cloud=(px-148)**2+(py-284)**2<44**2||(px-211)**2+(py-248)**2<69**2||(px-285)**2+(py-279)**2<54**2||(px-342)**2+(py-306)**2<35**2||(px>144&&px<343&&py>274&&py<340);
      if(cloud){const shade=Math.max(0,Math.min(1,(py-180)/165));c[0]=Math.round(234-77*shade);c[1]=Math.round(238-61*shade);c[2]=Math.round(232-49*shade);}
      if(py>=381&&py<=389&&px>=162&&px<=350){c[0]=156;c[1]=203;c[2]=188;}
      for(let i=0;i<3;i++)color[i]+=c[i]/(samples*samples);
    }
    const pos=row+1+x*4;for(let i=0;i<3;i++)raw[pos+i]=Math.round(color[i]);raw[pos+3]=255;
  }}
  const header=Buffer.alloc(13);header.writeUInt32BE(size);header.writeUInt32BE(size,4);header[8]=8;header[9]=6;
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',deflateSync(raw,{level:9})),chunk('IEND',Buffer.alloc(0))]);
}
for(const [file,size,maskable] of [['icon-192.png',192,false],['icon-512.png',512,false],['maskable-512.png',512,true]])writeFileSync(new URL(file,directory),render(size,maskable));
console.log('Icônes PWA générées : 192, 512 et maskable 512 px.');

import {build} from 'esbuild';
import {readFile,writeFile,readdir,mkdir,cp} from 'node:fs/promises';
import {join,resolve,relative} from 'node:path';
import {createHash} from 'node:crypto';
const root=process.cwd(),assets={};
const types={html:'text/html; charset=utf-8',js:'text/javascript; charset=utf-8',css:'text/css; charset=utf-8',png:'image/png',jpg:'image/jpeg',webmanifest:'application/manifest+json',json:'application/json',svg:'image/svg+xml',woff2:'font/woff2'};
async function walk(dir){for(const entry of await readdir(dir,{withFileTypes:true})){if(['manus-storage','__manus__'].includes(entry.name))continue;const p=join(dir,entry.name);if(entry.isDirectory())await walk(p);else{const key='/'+relative(join(root,'dist/client'),p).replaceAll('\\','/');assets[key]={body:(await readFile(p)).toString('base64'),type:types[key.split('.').pop()]??'application/octet-stream'};}}}
await walk(join(root,'dist/client'));
// Tous les chunks React sont préparés : une page non encore ouverte reste navigable hors ligne.
const shellVersion=createHash('sha256').update(JSON.stringify(assets)).digest('hex').slice(0,16);
const precache=Object.keys(assets).filter(path=>path!=='/sw.js'&&path!=='/index.html'&&!path.endsWith('.map'));
const sw=Buffer.from(assets['/sw.js'].body,'base64').toString('utf8').replace('__BUILD_VERSION__',shellVersion).replace('const PRECACHE_URLS = ["/", "/manifest.webmanifest"];','const PRECACHE_URLS = '+JSON.stringify(['/',...precache])+';');
assets['/sw.js'].body=Buffer.from(sw).toString('base64');
await mkdir('dist/server',{recursive:true});await mkdir('dist/.openai',{recursive:true});
const result=await build({entryPoints:['worker/index.ts'],bundle:true,platform:'browser',format:'esm',target:'es2022',write:false,metafile:true,plugins:[{name:'ports-worker',setup(b){b.onResolve({filter:/^node:crypto$/},()=>({path:resolve('worker/crypto-web.ts')}));b.onResolve({filter:/^\.\/db$/},args=>args.importer.endsWith('officialHourlyForecast.ts')?{path:resolve('worker/history-bridge.ts')}:undefined);b.onResolve({filter:/^\.\/stationService$/},args=>['dailyForecastVerification.ts','stationPerformanceService.ts'].some(name=>args.importer.endsWith(name))?{path:resolve('worker/station-kind.ts')}:undefined);}}]});
const code='const EMBEDDED_ASSETS='+JSON.stringify(assets)+';\n'+result.outputFiles[0].text;
await writeFile('dist/server/index.js',code);await cp('.openai/hosting.json','dist/.openai/hosting.json');
await writeFile('dist/build-report.json',JSON.stringify({staticFiles:Object.keys(assets).length,workerBytes:Buffer.byteLength(code),modules:Object.keys(result.metafile.inputs)},null,2));
console.log(JSON.stringify({staticFiles:Object.keys(assets).length,workerBytes:Buffer.byteLength(code),runtime:'Worker ESM ; images originales dans R2'}));

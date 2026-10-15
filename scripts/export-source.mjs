// Transport de livraison GitHub : seuls les fichiers suivables du projet sont exportés.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
const root=process.cwd();
const files=execFileSync('git',['-c',`safe.directory=${root.replaceAll('\\','/')}`,'ls-files','--cached','--others','--exclude-standard'],{encoding:'utf8'}).trim().split(/\r?\n/).filter(Boolean);
const unique=[...new Set(files)].sort();
if(process.argv[2]==='list'){console.log(JSON.stringify(unique.map(path=>({path,size:readFileSync(path).length,binary:path.endsWith('.png')}))));}
else{const path=unique[Number(process.argv[2])],buffer=readFileSync(path);const binary=path.endsWith('.png');const text=binary?buffer.toString('base64'):buffer.toString('utf8');const start=Number(process.argv[3]??0);console.log(JSON.stringify({path,binary,content:text.slice(start,start+16000),total:text.length,start}));}

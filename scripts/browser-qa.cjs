const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require('C:/Users/USER/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
(async()=>{
 fs.mkdirSync('qa',{recursive:true});const browser=await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});
 const report={pageErrors:[],consoleErrors:[],apiErrors:[],resourceFailures:[],widths:[]};
 try{
  const context=await browser.newContext({viewport:{width:390,height:844},serviceWorkers:'block',reducedMotion:'reduce'}),page=await context.newPage();
  page.on('pageerror',e=>report.pageErrors.push(e.message));page.on('console',m=>{if(m.type()==='error')report.consoleErrors.push(m.text().slice(0,300));});
  page.on('response',async r=>{if(r.status()>=400)report.resourceFailures.push({path:new URL(r.url()).pathname,status:r.status()});if(r.url().includes('/api/trpc/')){try{const b=await r.json();for(const v of Array.isArray(b)?b:[b])if(v.error)report.apiErrors.push({path:new URL(r.url()).pathname,message:v.error.json?.message});}catch{}}});
  await page.goto('http://127.0.0.1:33076/',{waitUntil:'domcontentloaded'});await page.waitForTimeout(18000);
  report.text=(await page.locator('body').innerText()).slice(0,3000);
  await page.screenshot({path:'qa/dashboard.png',fullPage:false});
  for(const width of [320,360,390,430]){await page.setViewportSize({width,height:844});report.widths.push({width,overflow:await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1)});}
  await page.goto('http://127.0.0.1:33076/details',{waitUntil:'domcontentloaded'});await page.waitForTimeout(4500);await page.screenshot({path:'qa/previsions.png',fullPage:false});
  await page.goto('http://127.0.0.1:33076/controle-historique',{waitUntil:'domcontentloaded'});report.historyText=(await page.locator('body').innerText()).slice(0,600);await page.screenshot({path:'qa/historique.png',fullPage:false});
  assert(report.historyText.includes('100 lignes préservées'));
  const response=await context.request.get('http://127.0.0.1:33076/api/trpc/weather.getDetailedForecast?input='+encodeURIComponent(JSON.stringify({json:{lat:50.7567,lon:2.5204,includeExtendedPeriods:false}})),{timeout:45000});
  const detail=(await response.json()).result?.data?.json;
  report.forecast={hours:detail?.hours?.length??0,models:detail?.modelsUsed??[],weighting:detail?.officialSnapshot?.hourlyWeighting?.status,currentTemperature:detail?.currentSnapshot?.temp};
  assert(report.forecast.hours>0&&report.forecast.models.length>0,'Prévision réelle absente');assert(report.pageErrors.length===0,'Erreur JavaScript');assert(report.widths.every(w=>!w.overflow),'Débordement mobile');
 }finally{await browser.close();fs.writeFileSync('qa/browser-report.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));}
})().catch(e=>{console.error(e.message);process.exitCode=1;});

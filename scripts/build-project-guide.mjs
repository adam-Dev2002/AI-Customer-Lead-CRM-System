import { chromium } from '../.local-tools/browser-testing/node_modules/playwright-core/index.mjs';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root=fileURLToPath(new URL('../',import.meta.url));
const preview=path.join(root,'.local-preview/project-guide');
await mkdir(preview,{recursive:true});
const report=JSON.parse(await readFile(path.join(root,'.local-preview/project-audit.json'),'utf8'));
const values={TESTS:report.tests,LEADS:report.leads,REVIEWS:report.reviewRows,SHEET_EMAILS:report.sheetEmailRows,APPLIED:report.applied,PENDING:report.pending,FAILED:report.failed,BUILD:report.build,MAIL:report.mailStatus};
const source=await readFile(path.join(root,'docs/customerlead-project-guide.html'),'utf8');
const html=source.replace(/@@([A-Z_]+)@@/g,(_,key)=>{if(values[key]===undefined)throw Error('Missing audit value '+key);return String(values[key]);});
const output=path.join(root,'templates/leads/public/integrations/customerlead-project-guide.pdf');
const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
try{
  const page=await browser.newPage({viewport:{width:900,height:1100}});
  await page.setContent(html,{waitUntil:'load'});
  await page.emulateMedia({media:'print'});
  await page.evaluate(()=>document.fonts.ready);
  const layout=await page.locator('.page').evaluateAll(pages=>pages.map((p,index)=>({page:index+1,title:p.querySelector('h1,h2')?.textContent,overflow:p.scrollHeight-p.clientHeight,widthOverflow:p.scrollWidth-p.clientWidth})));
  const invalid=layout.filter(p=>p.overflow>2||p.widthOverflow>2);
  if(invalid.length)throw Error('Page overflow: '+JSON.stringify(invalid));
  await page.pdf({path:output,format:'A4',printBackground:true,preferCSSPageSize:true,displayHeaderFooter:true,margin:{top:'17mm',bottom:'17mm',left:'15mm',right:'15mm'},headerTemplate:'<div></div>',footerTemplate:'<div style="font-family:Arial,sans-serif;font-size:8px;color:#756780;width:100%;padding:0 15mm;display:flex;justify-content:space-between"><span>CustomerLead · Project, setup &amp; operations · 19 October 2026</span><span><span class="pageNumber"></span> / <span class="totalPages"></span></span></div>'});
  await writeFile(path.join(preview,'rendered-guide.html'),html);
  await writeFile(path.join(preview,'layout.json'),JSON.stringify(layout,null,2));
  console.log(JSON.stringify({output,pages:layout.length,bytes:(await readFile(output)).length,layout:'All source pages fit.'}));
}finally{await browser.close();}

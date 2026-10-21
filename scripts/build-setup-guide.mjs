import { chromium } from '../.local-tools/browser-testing/node_modules/playwright-core/index.mjs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const source = new URL('../docs/customerlead-setup-and-testing.html', import.meta.url);
const output = fileURLToPath(new URL('../templates/leads/public/integrations/customerlead-setup-and-testing.pdf', import.meta.url));
const preview = fileURLToPath(new URL('../.local-preview/setup-guide/', import.meta.url));
await mkdir(preview, {recursive:true});
const browser = await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
try {
  const page = await browser.newPage({viewport:{width:900,height:1100},deviceScaleFactor:1});
  await page.goto(source.href, {waitUntil:'load'});
  await page.emulateMedia({media:'print'});
  await page.evaluate(()=>document.fonts.ready);
  const layout = await page.locator('.page').evaluateAll(pages => pages.map((page,index)=>({page:index+1,title:page.querySelector('h2,h1')?.textContent,overflow:page.scrollHeight-page.clientHeight,widthOverflow:page.scrollWidth-page.clientWidth})));
  const invalid = layout.filter(p=>p.overflow>2 || p.widthOverflow>2);
  if(invalid.length) throw new Error('Guide content exceeds page bounds: '+JSON.stringify(invalid));
  await page.pdf({path:output,format:'A4',printBackground:true,preferCSSPageSize:true,displayHeaderFooter:true,margin:{top:'17mm',right:'15mm',bottom:'17mm',left:'15mm'},headerTemplate:'<div></div>',footerTemplate:'<div style="font-family:Arial,sans-serif;font-size:8px;color:#736b83;width:100%;padding:0 15mm;display:flex;justify-content:space-between"><span>CustomerLead · Two-workflow setup &amp; testing · 19 October 2026</span><span><span class="pageNumber"></span> / <span class="totalPages"></span></span></div>'});
  for(const number of [1,2,6,8,9,13,14]) await page.locator('.page').nth(number-1).screenshot({path:path.join(preview,`source-page-${number}.png`)});
  const pdf = await readFile(output);
  const pageCount = (pdf.toString('latin1').match(/\/Type\s*\/Page\b/g)||[]).length;
  if(pageCount!==layout.length) throw new Error(`Expected ${layout.length} PDF pages, got ${pageCount}.`);
  await writeFile(path.join(preview,'layout-review.json'),JSON.stringify({pageCount,bytes:pdf.length,pages:layout},null,2));
  console.log(JSON.stringify({output,pageCount,bytes:pdf.length,layout:'All pages fit their A4 bounds.'}));
} finally {await browser.close();}

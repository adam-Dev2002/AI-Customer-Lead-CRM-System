import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { getDocument } from '../.local-tools/pdf-review/node_modules/pdfjs-dist/legacy/build/pdf.mjs';
import canvasPackage from '../.local-tools/pdf-review/node_modules/@napi-rs/canvas/index.js';

const {createCanvas,loadImage} = canvasPackage;
const pdfPath = fileURLToPath(new URL('../templates/leads/public/integrations/customerlead-setup-and-testing.pdf', import.meta.url));
const output = fileURLToPath(new URL('../.local-preview/setup-guide/', import.meta.url));
await mkdir(output,{recursive:true});
const document = await getDocument({data:new Uint8Array(await readFile(pdfPath)),useSystemFonts:true}).promise;
assert.equal(document.numPages,14);
const source=await readFile(new URL('../docs/customerlead-setup-and-testing.html',import.meta.url),'utf8');
const markers=[...source.matchAll(/<p class="eyebrow">([^<]+)<\/p>/g)].map(m=>m[1].toLowerCase().replace(/[^a-z0-9]/g,''));
const texts = [], links = new Set(), thumbnails=[];
for(let number=1;number<=document.numPages;number++) {
  const page=await document.getPage(number);
  const content=await page.getTextContent();
  const text=content.items.map(item=>item.str || '').join(' ');
  assert(text.length>500,`Page ${number} is unexpectedly empty.`);
  assert(text.toLowerCase().replace(/[^a-z0-9]/g,'').startsWith(markers[number-1]),`Page ${number} contains spillover before its section heading.`);
  texts.push(text);
  for(const annotation of await page.getAnnotations()) if(annotation.url) links.add(annotation.url);
  const viewport=page.getViewport({scale:1.1});
  const canvas=createCanvas(Math.ceil(viewport.width),Math.ceil(viewport.height));
  await page.render({canvasContext:canvas.getContext('2d'),canvas,viewport}).promise;
  const buffer=canvas.toBuffer('image/png');
  await writeFile(path.join(output,`pdf-page-${number}.png`),buffer);
  thumbnails.push(await loadImage(buffer));
}
const fullText=texts.join('\n');
const searchable=fullText.toLowerCase().replace(/\s+/g,'');
for(const phrase of ['owner@example.com','lead_ai_enabled','send_emails_enabled','Lead_ID','Draft_ID','Manual connection test','Follow_Up_Due_UTC','Header Auth account 2','ReplyReviews','Test 3','Test 5','1IugQXIcteoSLJ0aACmG8A5eSb6vl-CvelPWg9b4K8-Y'])
  assert(searchable.includes(phrase.toLowerCase().replace(/\s+/g,'')),`PDF text is missing ${phrase}.`);
assert(!/AIza[0-9A-Za-z_-]{25,}|sk-(?:proj-)?[0-9A-Za-z_-]{30,}|Bearer [0-9a-f]{50,}/.test(fullText),'PDF appears to contain an actual credential.');
assert([...links].some(url=>url.endsWith('customerlead-sync-and-send-bridge.json')),'Combined bridge download link missing.');
const sheet=createCanvas(900,Math.ceil(document.numPages/3)*450);
const ctx=sheet.getContext('2d');
ctx.fillStyle='#e9e7ef'; ctx.fillRect(0,0,sheet.width,sheet.height);
for(let index=0;index<thumbnails.length;index++) {
  const x=(index%3)*300+12,y=Math.floor(index/3)*450+25;
  ctx.fillStyle='#302545';ctx.font='13px sans-serif';ctx.fillText(`Page ${index+1}`,x,y-7);
  ctx.drawImage(thumbnails[index],x,y,276,390);
}
await writeFile(path.join(output,'pdf-contact-sheet.png'),sheet.toBuffer('image/png'));
await writeFile(path.join(output,'pdf-review.json'),JSON.stringify({pages:document.numPages,characters:fullText.length,links:[...links],checks:'Text extracted, all pages rendered, expected fields/download links present, no credential strings.'},null,2));
await document.loadingTask.destroy();
console.log(JSON.stringify({pages:14,characters:fullText.length,links:links.size,review:path.join(output,'pdf-contact-sheet.png'),status:'PDF text and render checks passed.'}));

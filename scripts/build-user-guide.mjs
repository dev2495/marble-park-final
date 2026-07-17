import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourcePath = path.join(root, 'apps/web/src/lib/help-content.ts');
const publicDir = path.join(root, 'apps/web/public/help');
const reportDir = path.join(root, 'reports/marble-park-user-training-2026-07-17');
const logoData = `data:image/jpeg;base64,${fs.readFileSync(path.join(root, 'apps/web/public/brand/marble-park-logo.jpg')).toString('base64')}`;

function loadHelpContent() {
  const source = fs.readFileSync(sourcePath, 'utf8');
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  const module = { exports: {} };
  Function('exports', 'module', output)(module.exports, module);
  return module.exports.HELP_GUIDES;
}

function escape(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
}

const guides = loadHelpContent();
const uniqueVideos = guides.filter((guide, index) => guide.video && guides.findIndex((item) => item.video === guide.video) === index);
const sectionHtml = guides.map((guide, index) => `
  <section class="guide" id="${escape(guide.id)}">
    <div class="guide-head"><span class="number">${String(index + 1).padStart(2, '0')}</span><div><p class="eyebrow">${escape(guide.roles.join(' · '))} · ${escape(guide.duration)}</p><h2>${escape(guide.title)}</h2><p>${escape(guide.summary)}</p></div></div>
    ${guide.image ? `<img class="screen" src="./images/${path.basename(guide.image)}" alt="${escape(guide.title)} screen">` : ''}
    <div class="flow">${guide.flow.map((step, stepIndex) => `<span>${escape(step)}</span>${stepIndex < guide.flow.length - 1 ? '<b>→</b>' : ''}`).join('')}</div>
    <div class="columns"><div><h3>How to complete it</h3><ol>${guide.steps.map((step) => `<li>${escape(step)}</li>`).join('')}</ol></div><aside><h3>Before you finish</h3>${guide.checks.map((check) => `<p>✓ ${escape(check)}</p>`).join('')}</aside></div>
  </section>`).join('');

const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Marble Park ERP Complete User Guide</title><style>
:root{color-scheme:light;--ink:#18181b;--muted:#5f5b59;--line:#ded8d6;--soft:#f7f4f3;--blue:#8f241f;--green:#0d7470}*{box-sizing:border-box}html{scroll-behavior:smooth}body{margin:0;background:#fff;color:var(--ink);font:15px/1.6 Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;letter-spacing:0}.page{max-width:1120px;margin:auto;padding:44px 32px 80px}header{border-top:4px solid var(--blue);border-bottom:1px solid var(--line);padding:24px 0 34px}.brand{display:flex;align-items:center;gap:12px}.logo{width:44px;height:58px;object-fit:contain;background:#000}.eyebrow{margin:0;color:var(--blue);font-size:11px;font-weight:750;text-transform:uppercase}h1{max-width:800px;margin:22px 0 10px;font-size:42px;line-height:1.08;letter-spacing:0}h2{margin:3px 0 7px;font-size:26px;line-height:1.2;letter-spacing:0}h3{margin:0 0 12px;font-size:15px;letter-spacing:0}.lede{max-width:780px;color:var(--muted);font-size:17px}.lifecycle{display:grid;grid-template-columns:repeat(6,1fr);margin-top:28px;border:1px solid var(--line);border-radius:6px;overflow:hidden}.lifecycle div{padding:15px;border-right:1px solid var(--line);font-weight:700;font-size:12px}.lifecycle div:last-child{border:0}.contents{margin:36px 0}.contents h2{font-size:20px}.contents-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:8px 24px}.contents a{color:var(--ink);text-decoration:none;border-bottom:1px solid var(--line);padding:9px 0}.guide{padding:46px 0;border-top:1px solid var(--line);break-before:page}.guide-head{display:grid;grid-template-columns:48px 1fr;gap:16px}.number{display:grid;width:42px;height:42px;place-items:center;border-radius:50%;background:var(--blue);color:#fff;font-size:12px;font-weight:800}.guide-head p{max-width:820px;margin:0;color:var(--muted)}.screen{display:block;width:100%;max-height:560px;object-fit:contain;margin:24px 0;border:1px solid var(--line);border-radius:6px;background:var(--soft)}.flow{display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin:24px 0}.flow span{border-radius:4px;background:#fff0ee;color:#7f211d;padding:7px 10px;font-size:12px;font-weight:750}.flow b{color:#9c9490}.columns{display:grid;grid-template-columns:1.5fr .8fr;gap:30px}.columns ol{margin:0;padding-left:22px}.columns li{margin:8px 0}.columns aside{border-left:3px solid var(--green);padding:4px 0 4px 18px}.columns aside p{margin:9px 0;color:var(--muted);font-size:13px}.videos{padding:46px 0;border-top:1px solid var(--line)}.video-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:14px}.video{border:1px solid var(--line);border-radius:6px;padding:16px}.video a{color:var(--blue);font-weight:750}.footer{margin-top:48px;border-top:1px solid var(--line);padding-top:22px;color:var(--muted);font-size:12px}@media(max-width:760px){.page{padding:28px 18px}h1{font-size:32px}.lifecycle{grid-template-columns:1fr 1fr}.lifecycle div{border-bottom:1px solid var(--line)}.contents-grid,.columns,.video-grid{grid-template-columns:1fr}.guide-head{grid-template-columns:38px 1fr}}@media print{@page{size:A4;margin:13mm}.page{max-width:none;padding:0}header{padding-top:0}.lifecycle{font-size:9px}.contents{break-after:page}.guide{padding:20px 0}.screen{max-height:112mm;margin:14px 0}.columns{gap:18px}.videos{break-before:page}a{color:inherit;text-decoration:none}}
</style></head><body><main class="page"><header><div class="brand"><img class="logo" src="${logoData}" alt="Marble Park logo"><div><strong>Marble Park</strong><p class="eyebrow">Retail operations system</p></div></div><h1>Complete user guide: customer promise to physical fulfilment</h1><p class="lede">A role-based operating manual for sanitaryware, tiles and bathroom retail. It explains the exact actions, system controls and completion checks across Product Master, CRM, quotations, purchase, inventory lots, dispatch, returns, payments and audit.</p><div class="lifecycle">${['Lead + intent','Quote + revision','Partial order','Reserve / procure','Pick + dispatch','Payment + return'].map((step, index) => `<div><small>0${index + 1}</small><br>${step}</div>`).join('')}</div></header><nav class="contents"><h2>Guide index</h2><div class="contents-grid">${guides.map((guide, index) => `<a href="#${escape(guide.id)}">${String(index + 1).padStart(2, '0')} · ${escape(guide.title)}</a>`).join('')}</div></nav>${sectionHtml}<section class="videos"><p class="eyebrow">Training media</p><h2>Separate workflow videos</h2><div class="video-grid">${uniqueVideos.map((guide, index) => `<div class="video"><strong>${index + 1}. ${escape(guide.title)}</strong><p>${escape(guide.summary)}</p><a href="./videos/${path.basename(guide.video)}">Open MP4 walkthrough</a></div>`).join('')}</div></section><footer class="footer">Generated from the in-product Help Center content. Operational rules should be updated in the system help model first, then this guide regenerated.<br>Marble Park ERP · User training suite · 17 July 2026</footer></main></body></html>`;

for (const destination of [publicDir, reportDir]) {
  fs.mkdirSync(destination, { recursive: true });
  fs.writeFileSync(path.join(destination, destination === publicDir ? 'user-guide.html' : 'guide.html'), html);
  fs.writeFileSync(path.join(destination, 'guide-data.json'), JSON.stringify({ generatedAt: '2026-07-17', guides }, null, 2));
  for (const folder of ['images', 'videos']) {
    const source = path.join(publicDir, folder);
    const target = path.join(destination, folder);
    if (destination !== publicDir && fs.existsSync(source)) fs.cpSync(source, target, { recursive: true, force: true });
  }
}

console.log(JSON.stringify({ ok: true, guides: guides.length, videos: uniqueVideos.length, publicHtml: path.join(publicDir, 'user-guide.html'), reportHtml: path.join(reportDir, 'guide.html') }, null, 2));

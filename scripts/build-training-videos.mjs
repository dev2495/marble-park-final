import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const imageDir = path.join(root, 'apps/web/public/help/images');
const outputDir = path.join(root, 'apps/web/public/help/videos');
const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'marble-park-training-'));
const ffmpeg = process.env.FFMPEG_PATH || '/opt/homebrew/bin/ffmpeg';
const font = process.env.TRAINING_FONT || '/System/Library/Fonts/SFNS.ttf';
fs.mkdirSync(outputDir, { recursive: true });

const image = (name) => path.join(imageDir, name);
const decks = [
  {
    file: '01-master-data-and-tiles.mp4', title: 'Master data, tile designs and physical stock',
    slides: [
      { kicker: 'Foundation', title: 'One saleable design = one Product Master SKU', body: ['Brand, category, finish and size are controlled attributes.', 'The SKU is immutable; images, rates and attributes remain editable.', 'A showroom code helps sales find the same Product Master record.'] },
      { kicker: 'Tile master', title: 'Keep thousands of designs manageable', body: ['Bulk-import supplier design catalogues.', 'Register only physical showroom displays.', 'A display sample is not saleable stock.'], image: image('quote-editor-tile-and-sanitaryware.png') },
      { kicker: 'Stock truth', title: 'Opening Stock once, GRN after go-live', body: ['Opening Stock establishes the initial balance.', 'Every later inward is received through PO and GRN.', 'Posting creates traceable lots, locations and ledger entries.'], image: image('pending-inward.png') },
      { kicker: 'Identity', title: 'Print QR labels for lots and displays', body: ['The label carries SKU, lot, inward reference and location identity.', 'Scan during review, picking and returns.', 'Reprints retain the same system identity.'], image: image('labels-and-lots.png') },
    ],
  },
  {
    file: '02-tile-pricing-and-quotes.mp4', title: 'Tile pricing and Quote Studio',
    slides: [
      { kicker: 'Three commercial modes', title: 'Area, pieces and boxes are all supported', body: ['Choose the basis per tile line.', 'Rates and billed quantity follow that basis.', 'Physical fulfilment remains visible in boxes.'] },
      { kicker: 'Area', title: 'Required area + wastage → whole boxes', body: ['Enter SQFT or SQM and wastage percentage.', 'The system rounds up to enough full boxes.', 'The quote bills actual supplied coverage.'], flow: ['110 SQFT required', '÷ 15.5 / box', '8 boxes', '124 SQFT billed'] },
      { kicker: 'Pieces', title: 'Requested pieces → whole boxes', body: ['Enter the customer’s piece requirement.', 'The system uses pieces per box and rounds up.', 'The quote shows requested, supplied and billed pieces.'], flow: ['3 pieces requested', '2 pcs / box', '2 boxes', '4 pieces billed'] },
      { kicker: 'Quote Studio', title: 'Customer-facing image, room and rate stay editable', body: ['Search SKU or internal showroom code.', 'Set room, negotiated rate, discount and GST.', 'Save a priced quotation or selection-only PDF.'], image: image('quote-editor-tile-and-sanitaryware.png') },
    ],
  },
  {
    file: '03-crm-lead-to-quote.mp4', title: 'CRM: lead to approved quotation',
    slides: [
      { kicker: 'CRM lifecycle', title: 'Keep one customer story from enquiry to decision', body: ['Lead captures the opportunity.', 'Intent captures room-wise requirements.', 'Quote revisions preserve commercial history.'], flow: ['Lead', 'Intent', 'Selections', 'Quote', 'Revision', 'Sent'] },
      { kicker: 'Sales desk', title: 'Start with customer, site and next action', body: ['Record budget, timeline, source and owner.', 'Use activities for calls, visits and follow-up.', 'Keep the next action visible to the sales team.'], image: image('dashboard-with-e2e-records.png') },
      { kicker: 'Selections', title: 'Every row comes from Product Master', body: ['Mix sanitaryware, tiles and bathroom products.', 'Group lines by room or use.', 'Override the customer-facing image without changing master media.'], image: image('quote-editor-tile-and-sanitaryware.png') },
      { kicker: 'Commercial control', title: 'Revise before order, approve exceptions', body: ['Below-floor rates go to Owner approval.', 'Issue priced or selection-only PDF.', 'After an order exists, make a revision for a new agreement.'] },
    ],
  },
  {
    file: '04-partial-order-and-procurement.mp4', title: 'Partial orders, backorders and procurement',
    slides: [
      { kicker: 'Partial conversion', title: 'One quote can create multiple sales orders', body: ['Select only quantities confirmed now.', 'Remaining quantities stay open on the same quote.', 'Close the remainder only with a customer cancellation reason.'], flow: ['Quote 10', 'Order 4', 'Order 3', '3 remain / close'] },
      { kicker: 'Availability', title: 'Reserve what exists, backorder the shortage', body: ['Reservations use physical boxes or pieces.', 'Available lots are allocated in order.', 'Shortage automatically creates purchase demand.'], image: image('pending-inward.png') },
      { kicker: 'Procurement', title: 'Demand → PO → partial GRNs', body: ['Group open demand by vendor.', 'Receive each supplier delivery separately.', 'Damaged quantity is isolated from saleable stock.'], flow: ['Purchase demand', 'Purchase order', 'GRN 1', 'GRN 2', 'Lots'] },
      { kicker: 'Pending inward', title: 'Keep the customer order connected', body: ['The shortage retains quote and sales-order identity.', 'Posted inward creates labels and stock.', 'Allocation updates readiness without rebuilding the quote.'], image: image('pending-inward.png') },
    ],
  },
  {
    file: '05-stock-dispatch-and-returns.mp4', title: 'Lots, partial dispatch, delivery and returns',
    slides: [
      { kicker: 'Exact stock identity', title: 'Pick the right SKU, lot and location', body: ['Scan or select the lot reserved for the order.', 'Cannot pick above available or ordered balance.', 'Packing retains the allocation trail.'], image: image('labels-and-lots.png') },
      { kicker: 'Partial dispatch', title: 'Create more than one challan against one order', body: ['Dispatch only items ready now.', 'The order keeps remaining quantities open.', 'Use OTP as delivery proof for each challan.'], image: image('dispatch-partial-flow.png') },
      { kicker: 'Returns', title: 'Return against the original dispatch line', body: ['Choose reason, quantity and disposition.', 'Saleable return restores the original traceable lot.', 'Damaged return remains isolated for review.'], flow: ['Dispatch line', 'Return receive', 'Inspect', 'Restock / damage'] },
      { kicker: 'Daily control', title: 'Finish with reconciliation', body: ['Lot, location, ledger and aggregate balances must agree.', 'Investigate exceptions before manual adjustment.', 'Use controlled stock count and approval when correction is needed.'], image: image('reconciliation-clean.png') },
    ],
  },
];

function esc(value) { return String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char])); }
function slideHtml(deck, slide, index) {
  const imageHtml = slide.image ? `<div class="screen"><img src="${pathToFileURL(slide.image).href}"></div>` : '';
  const flowHtml = slide.flow ? `<div class="flow">${slide.flow.map((step, i) => `<span>${esc(step)}</span>${i < slide.flow.length - 1 ? '<b>→</b>' : ''}`).join('')}</div>` : '';
  return `<!doctype html><html><head><meta charset="utf-8"><style>*{box-sizing:border-box}body{margin:0;width:1280px;height:720px;overflow:hidden;background:#f7f9fc;color:#18181b;font-family:Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;letter-spacing:0}.top{height:62px;display:flex;align-items:center;justify-content:space-between;padding:0 42px;border-bottom:1px solid #dbe3ee;background:#fff}.brand{display:flex;align-items:center;gap:11px;font-size:15px;font-weight:750}.logo{display:grid;width:32px;height:32px;place-items:center;border-radius:5px;background:#2563eb;color:white;font-size:11px}.count{font-size:12px;color:#64748b}.content{height:658px;display:grid;grid-template-columns:${slide.image ? '410px 1fr' : '1fr'};gap:34px;padding:42px}.copy{align-self:center}.kicker{margin:0;color:#2456a6;font-size:13px;font-weight:800;text-transform:uppercase}.title{max-width:720px;margin:10px 0 24px;font-size:38px;line-height:1.08}.bullets{display:grid;gap:15px}.bullet{display:grid;grid-template-columns:22px 1fr;gap:11px;font-size:19px;line-height:1.42;color:#3f4754}.tick{display:grid;width:20px;height:20px;place-items:center;border-radius:50%;background:#def7ec;color:#176b4d;font-size:12px;font-weight:900;margin-top:3px}.screen{align-self:center;height:520px;border:1px solid #dbe3ee;border-radius:7px;background:#fff;padding:10px;box-shadow:0 18px 50px -34px #1e293b}.screen img{width:100%;height:100%;object-fit:contain}.flow{display:flex;align-items:center;justify-content:center;gap:12px;margin-top:34px}.flow span{min-width:140px;border:1px solid #bfd2ee;border-radius:6px;background:#fff;padding:17px 15px;text-align:center;color:#173f7c;font-size:16px;font-weight:800}.flow b{color:#94a3b8;font-size:22px}</style></head><body><div class="top"><div class="brand"><span class="logo">MP</span>Marble Park ERP · ${esc(deck.title)}</div><span class="count">${index + 1} / ${deck.slides.length}</span></div><main class="content"><div class="copy"><p class="kicker">${esc(slide.kicker)}</p><h1 class="title">${esc(slide.title)}</h1><div class="bullets">${slide.body.map((text) => `<div class="bullet"><span class="tick">✓</span><span>${esc(text)}</span></div>`).join('')}</div>${flowHtml}</div>${imageHtml}</main></body></html>`;
}

function run(command, args) {
  const result = spawnSync(command, args, { stdio: 'pipe', encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`${command} failed: ${result.stderr || result.stdout}`);
}

function wrapText(value, width) {
  return String(value).split(/\s+/).reduce((lines, word) => {
    const last = lines.at(-1) || '';
    if (!last || `${last} ${word}`.length > width) lines.push(word);
    else lines[lines.length - 1] = `${last} ${word}`;
    return lines;
  }, []).join('\n');
}

function textFile(base, name, value) {
  const target = path.join(workDir, `${base}-${name}.txt`);
  fs.writeFileSync(target, value);
  return target.replaceAll('\\', '/').replaceAll(':', '\\:').replaceAll("'", "'\\''");
}

for (const [deckIndex, deck] of decks.entries()) {
  const clips = [];
  for (const [slideIndex, slide] of deck.slides.entries()) {
    const base = `${deckIndex}-${slideIndex}`;
    const clipPath = path.join(workDir, `${base}.mp4`);
    const titleLines = wrapText(slide.title, slide.image ? 29 : 48).split('\n').map((line, index) => textFile(base, `title-${index}`, line));
    const kicker = textFile(base, 'kicker', slide.kicker.toUpperCase());
    const bodyLines = slide.body.flatMap((item, itemIndex) => wrapText(item, slide.image ? 36 : 64).split('\n').map((line, lineIndex) => ({ text: `${lineIndex ? '  ' : '- '}${line}`, gap: lineIndex === 0 && itemIndex > 0 })));
    const bodyFiles = bodyLines.map((item, index) => ({ ...item, file: textFile(base, `body-${index}`, item.text) }));
    const header = textFile(base, 'header', `MP  MARBLE PARK ERP  /  ${deck.title.toUpperCase()}`);
    const count = textFile(base, 'count', `${slideIndex + 1} / ${deck.slides.length}`);
    const flow = slide.flow ? textFile(base, 'flow', slide.flow.join('   →   ')) : null;
    const titleSize = slide.image ? 38 : 46;
    let bodyY = slide.image ? 304 : 298;
    const bodyLayers = bodyFiles.map((item) => {
      if (item.gap) bodyY += 14;
      const layer = `drawtext=fontfile='${font}':textfile='${item.file}':fontcolor=0x3f4754:fontsize=${slide.image ? 20 : 23}:x=52:y=${bodyY}`;
      bodyY += slide.image ? 29 : 33;
      return layer;
    });
    const draw = [
      'drawbox=x=0:y=0:w=1280:h=62:color=white:t=fill',
      'drawbox=x=0:y=61:w=1280:h=1:color=0xdbe3ee:t=fill',
      `drawtext=fontfile='${font}':textfile='${header}':fontcolor=0x18181b:fontsize=15:x=42:y=22`,
      `drawtext=fontfile='${font}':textfile='${count}':fontcolor=0x64748b:fontsize=13:x=1180:y=22`,
      `drawtext=fontfile='${font}':textfile='${kicker}':fontcolor=0x2456a6:fontsize=15:x=42:y=116`,
      ...titleLines.map((file, index) => `drawtext=fontfile='${font}':textfile='${file}':fontcolor=0x18181b:fontsize=${titleSize}:x=42:y=${154 + index * (titleSize + 7)}`),
      ...bodyLayers,
      ...(flow ? [`drawbox=x=60:y=540:w=1160:h=84:color=white:t=fill`, `drawbox=x=60:y=540:w=1160:h=84:color=0xbfd2ee:t=2`, `drawtext=fontfile='${font}':textfile='${flow}':fontcolor=0x173f7c:fontsize=20:x=(w-text_w)/2:y=570`] : []),
      'fade=t=in:st=0:d=0.3', 'fade=t=out:st=3.5:d=0.5', 'format=yuv420p',
    ];
    if (slide.image) {
      const filter = `[0:v]scale=710:520:force_original_aspect_ratio=decrease,pad=710:520:(ow-iw)/2:(oh-ih)/2:color=white[shot];color=c=0xf7f9fc:s=1280x720:d=4[bg];[bg]${draw.slice(0, -3).join(',')}[base];[base][shot]overlay=535:105,${draw.slice(-3).join(',')}[out]`;
      run(ffmpeg, ['-y', '-loop', '1', '-i', slide.image, '-filter_complex', filter, '-map', '[out]', '-t', '4', '-an', '-r', '24', '-c:v', 'libx264', '-preset', 'fast', '-crf', '21', clipPath]);
    } else {
      run(ffmpeg, ['-y', '-f', 'lavfi', '-i', 'color=c=0xf7f9fc:s=1280x720:d=4:r=24', '-vf', draw.join(','), '-t', '4', '-an', '-c:v', 'libx264', '-preset', 'fast', '-crf', '21', clipPath]);
    }
    clips.push(clipPath);
  }
  const concatPath = path.join(workDir, `${deckIndex}-concat.txt`);
  fs.writeFileSync(concatPath, clips.map((clip) => `file '${clip.replaceAll("'", "'\\''")}'`).join('\n'));
  run(ffmpeg, ['-y', '-f', 'concat', '-safe', '0', '-i', concatPath, '-c', 'copy', '-movflags', '+faststart', path.join(outputDir, deck.file)]);
}

console.log(JSON.stringify({ ok: true, outputDir, videos: decks.map((deck) => deck.file), temporaryFrames: workDir }, null, 2));

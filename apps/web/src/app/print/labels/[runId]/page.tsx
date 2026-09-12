'use client';

import { use, useEffect, useState } from 'react';
import Link from 'next/link';
import { gql, useMutation, useQuery } from '@apollo/client';
import { ArrowLeft, CheckCircle2, Download, Printer, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { QueryErrorBanner } from '@/components/query-state';
import { compactTileSize } from '@marble-park/pricing-contract/tile-size';

const RUN = gql`query LabelPrintRun($id: ID!) { internalLabelPrintRun(id: $id) }`;
const CONFIRM = gql`mutation ConfirmLabelPrint($id: ID!) { confirmInternalLabelPrintRun(id: $id) }`;
const CANCEL = gql`mutation CancelLabelPrint($id: ID!, $reason: String!) { cancelInternalLabelPrintRun(id: $id, reason: $reason) }`;
const PREPARE = gql`mutation PrepareLabelReprint($input: InternalLabelPrintRunInput!) { prepareInternalLabelPrintRun(input: $input) }`;
const STANDARD_TEMPLATE = 'thermal_4x2';
const PORTRAIT_WIDTH_MM = 50.8;
const PORTRAIT_HEIGHT_MM = 101.6;
const LANDSCAPE_WIDTH_MM = 101.6;
const LANDSCAPE_HEIGHT_MM = 50.8;

function money(value: unknown) {
  return Number(value || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 });
}

function labelKind(label: any) {
  if (label.payload?.displaySample) return 'DISPLAY';
  if (label.payload?.lotNumber) return 'STOCK LOT';
  return 'PRODUCT';
}

function printIdentity(label: any) {
  const payload = label.payload || {};
  if (payload.lotNumber) return { heading: 'LOT', value: payload.lotNumber };
  if (payload.displaySample) return { heading: 'DISPLAY', value: payload.displaySample };
  return { heading: 'IDENTITY', value: 'PRODUCT / SHELF' };
}

function PortraitFourByTwoLabelV2({ label }: { label: any }) {
  const payload = label.payload || {};
  const brandCode = String(payload.brandCode || 'CODE PENDING').toUpperCase();
  const productCode = String(payload.productCode || payload.internalCode || payload.sku || 'PRODUCT CODE PENDING').toUpperCase();
  const identity = payload.lotNumber
    ? { heading: 'LOT CODE', value: String(payload.lotNumber).toUpperCase() }
    : payload.displaySample
      ? { heading: 'DISPLAY CODE', value: String(payload.displaySample).toUpperCase() }
      : null;
  const productCodeSize = productCode.length > 40 ? '5.5pt' : productCode.length > 32 ? '6.2pt' : productCode.length > 24 ? '7pt' : productCode.length > 14 ? '7.2pt' : '15.5pt';
  const productCodeWhiteSpace = productCode.length > 40 ? 'normal' : 'nowrap';
  const identityCodeSize = String(identity?.value || '').length > 28 ? '7.5pt' : '9pt';

  return <article className="mp-portrait-label-page" aria-label={`Physical label ${label.labelCode}`}>
    <div className="mp-portrait-safe-frame">
      <header className="mp-portrait-header">
        <div className="mp-portrait-brand"><span className="mp-portrait-mark">MP</span><span>MARBLE PARK</span></div>
        <span className="mp-portrait-kind">{labelKind(label)}</span>
      </header>
      <section className="mp-portrait-qr-panel">
        <img src={label.qrDataUrl} alt={`Scan ${label.labelCode}`} />
        <p className="mp-portrait-human-code">{label.labelCode}</p>
      </section>
      <section className={`mp-portrait-code-panel${identity ? ' has-identity' : ''}`}>
        <div className="mp-portrait-code-row">
          <span>BRAND CODE</span>
          <strong>{brandCode}</strong>
        </div>
        <div className="mp-portrait-code-row mp-portrait-product-code">
          <span>PRODUCT CODE</span>
          <strong style={{ fontSize: productCodeSize, whiteSpace: productCodeWhiteSpace }}>{productCode}</strong>
        </div>
        {identity ? <div className="mp-portrait-code-row mp-portrait-identity-code">
          <span>{identity.heading}</span>
          <strong style={{ fontSize: identityCodeSize }}>{identity.value}</strong>
        </div> : null}
      </section>
      <footer className="mp-portrait-rate">
        <span>RATE</span>
        <strong>Rs. {money(payload.mrpInclusive)}</strong>
        <b>/{String(payload.priceUom || 'PC').toUpperCase()}</b>
      </footer>
    </div>
  </article>;
}

function CompactPortraitFourByTwoLabelV3({ label }: { label: any }) {
  const payload = label.payload || {};
  const brandCode = String(payload.governedBrandCode || payload.brandCode || 'PENDING').toUpperCase();
  const productValue = String(payload.compactProductValue || payload.productCode || payload.internalCode || payload.sku || 'PENDING').toUpperCase();
  const productSize = productValue.length > 34 ? '8.8pt' : productValue.length > 26 ? '10.5pt' : productValue.length > 18 ? '12.5pt' : '17pt';
  const productKind = payload.displaySample ? 'DISPLAY' : 'PRODUCT';

  return <article className="mp-v3-label-page" aria-label={`Physical label ${label.labelCode}`}>
    <div className="mp-v3-safe-frame">
      <header className="mp-v3-header">
        <div className="mp-v3-brand"><span className="mp-v3-mark">MP</span><span>MARBLE PARK</span></div>
        <span className="mp-v3-kind">{productKind}</span>
      </header>
      <section className="mp-v3-qr-panel">
        <img src={label.qrDataUrl} alt={`Scan ${label.labelCode}`} />
        <p className="mp-v3-human-code">{label.labelCode}</p>
      </section>
      <section className="mp-v3-code-panel">
        <div className="mp-v3-code-row mp-v3-brand-code">
          <span>BRAND</span>
          <strong>{brandCode}</strong>
        </div>
        <div className="mp-v3-code-row mp-v3-product-code">
          <span>PRODUCT</span>
          <strong style={{ fontSize: productSize }}>{productValue}</strong>
        </div>
      </section>
      <footer className="mp-v3-rate">
        <span>RATE</span>
        <strong>Rs. {money(payload.mrpInclusive)}</strong>
        <b>/{String(payload.priceUom || 'PC').toUpperCase()}</b>
      </footer>
    </div>
  </article>;
}

function FinishFourByTwoLabelV4({ label, portrait }: { label: any; portrait: boolean }) {
  const payload = label.payload || {};
  const tileSize = compactTileSize(payload);
  const productValue = String(payload.compactProductValue || payload.productCode || payload.internalCode || payload.sku || 'PENDING').toUpperCase();
  // Keep the governed product/design value inside its fixed two-line print row.
  // Long master values must remain readable without pushing finish or rate out of the 4 x 2 frame.
  const productSize = productValue.length > 48 ? '8.5pt'
    : productValue.length > 36 ? '9.5pt'
    : productValue.length > 28 ? '10.5pt'
    : productValue.length > 20 ? '12pt'
    : portrait ? '14pt' : '14.5pt';
  return <article className={`mp-v4-label-page${portrait ? ' is-portrait' : ''}`} aria-label={`Physical label ${label.labelCode}`}>
    <div className="mp-v4-frame">
      <section className="mp-v4-qr">
        <img src={label.qrDataUrl} alt={`Scan ${label.labelCode}`} />
        <p>{label.labelCode}</p>
      </section>
      <section className="mp-v4-copy">
        <header className="mp-v4-header"><b>MP</b><strong>MARBLE PARK</strong></header>
        <div className={`mp-v4-identity${tileSize ? ' has-tile-size' : ''}`}>
          <div className="mp-v4-brand"><span>BRAND</span><strong>{String(payload.governedBrandCode || payload.brandCode || 'PENDING').toUpperCase()}</strong></div>
          {tileSize ? <div className="mp-v4-size"><strong className="mp-v4-tile-size">{tileSize}</strong></div> : null}
        </div>
        <div className="mp-v4-product"><span>PRODUCT</span><strong style={{ fontSize: productSize }}>{productValue}</strong></div>
        <div className="mp-v4-finish"><span>FINISH</span><strong>{String(payload.finish || 'NOT SET').toUpperCase()}</strong></div>
        <footer className="mp-v4-rate"><span>RATE</span><strong>Rs. {money(payload.mrpInclusive)}</strong><b>/{String(payload.priceUom || 'PC').toUpperCase()}</b></footer>
      </section>
    </div>
  </article>;
}

async function waitForPrintAssets() {
  if (typeof document === 'undefined') return;
  const ready = async () => {
    if (document.fonts?.ready) await document.fonts.ready;
    await Promise.all(Array.from(document.querySelectorAll<HTMLImageElement>('.mp-label-pages img, .label-sheet img')).map(async (image) => {
      if (!image.complete) await image.decode();
      if (!image.naturalWidth) throw new Error('A sticker QR could not load. Refresh this preview before printing.');
    }));
    const fitError = fitStickerText();
    if (fitError) throw new Error(fitError);
  };
  let timeout: ReturnType<typeof setTimeout>;
  try {
    await Promise.race([ready(), new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error('Print images took too long to load. Refresh this preview and try again.')), 15000); })]);
  } finally { clearTimeout(timeout!); }
}

// Fit real master values before printing rather than clipping text at fixed row edges.
function fitStickerText() {
  let invalid = false;
  const fit = (node: HTMLElement, width: number, height: number) => {
    const initial = Number(node.dataset.preferredSize || parseFloat(getComputedStyle(node).fontSize));
    node.dataset.preferredSize = String(initial);
    let size = initial;
    node.style.fontSize = `${size}px`;
    const exceeds = () => {
      const maxHeight = node.parentElement?.classList.contains('mp-v4-product') ? Math.min(height, parseFloat(getComputedStyle(node).lineHeight) * 2) : height;
      return node.scrollWidth > width + 0.5 || node.getBoundingClientRect().height > maxHeight + 0.5 || node.scrollHeight > maxHeight + 0.5;
    };
    while (exceeds() && size > 9.34) { size = Math.max(9.34, size - .5); node.style.fontSize = `${size}px`; }
    if (exceeds()) invalid = true;
  };
  for (const label of document.querySelectorAll<HTMLElement>('.mp-v4-label-page')) {
    for (const row of label.querySelectorAll<HTMLElement>('.mp-v4-brand, .mp-v4-product, .mp-v4-finish')) {
      const text = row.querySelector<HTMLElement>('strong');
      const caption = row.querySelector<HTMLElement>('span');
      if (!text || !caption) continue;
      const style = getComputedStyle(row);
      fit(text, row.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight), row.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom) - caption.offsetHeight - parseFloat(style.rowGap));
    }
    const sizeRow = label.querySelector<HTMLElement>('.mp-v4-size');
    const sizeText = sizeRow?.querySelector<HTMLElement>('strong');
    if (sizeRow && sizeText) {
      const style = getComputedStyle(sizeRow);
      fit(sizeText, sizeRow.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight), sizeRow.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom));
    }
    const rate = label.querySelector<HTMLElement>('.mp-v4-rate');
    const amount = rate?.querySelector<HTMLElement>('strong');
    if (rate && amount) {
      const style = getComputedStyle(rate);
      const otherWidth = Array.from(rate.children).filter((node) => node !== amount).reduce((sum, node) => sum + node.getBoundingClientRect().width, 0);
      fit(amount, rate.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight) - otherWidth - 2 * parseFloat(style.columnGap), rate.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom));
    }
  }
  return invalid ? 'A product code, finish or rate cannot fit legibly on this sticker. Use the PDF download for its checked layout or correct the printable master value.' : '';
}

function StandardFourByTwoLabel({ label }: { label: any }) {
  const payload = label.payload || {};
  const productCode = payload.productCode || payload.internalCode || payload.sku || 'PRODUCT CODE PENDING';
  const showWarehouseSku = payload.sku && String(payload.sku).toUpperCase() !== String(productCode).toUpperCase();
  const brandCode = payload.brandCode || 'CODE PENDING';
  const brandName = payload.brand || 'NAME PENDING';
  const identity = printIdentity(label);
  const locations = Array.isArray(payload.locations) ? payload.locations.filter(Boolean).join(', ') : '';
  const codeSize = String(productCode).length > 28 ? '8.6pt' : String(productCode).length > 20 ? '10pt' : '12.2pt';
  const brandNameSize = String(brandName).length > 30 ? '4.7pt' : String(brandName).length > 20 ? '5.2pt' : '5.8pt';

  return <article className="mp-label-page" aria-label={`Physical label ${label.labelCode}`}>
    <div className="mp-label-safe-frame">
      <section className="mp-label-qr-panel">
        <div className="mp-label-qr-frame"><img src={label.qrDataUrl} alt={`Scan ${label.labelCode}`} /></div>
        <p className="mp-label-human-code">{label.labelCode}</p>
        <p className="mp-label-scan-hint">SCAN TO VERIFY</p>
      </section>
      <section className="mp-label-copy">
        <header className="mp-label-header">
          <div className="mp-label-brand"><span className="mp-label-mark">MP</span><span>MARBLE PARK</span></div>
          <span className="mp-label-kind">{labelKind(label)}</span>
        </header>
        <div className="mp-label-product-brand" aria-label={`Brand code ${brandCode}; brand name ${brandName}`}>
          <p><span>BRAND CODE</span><strong>{brandCode}</strong></p>
          <p><span>BRAND NAME</span><strong style={{ fontSize: brandNameSize }}>{brandName}</strong></p>
        </div>
        <div className="mp-label-code-block">
          <p className="mp-label-code" style={{ fontSize: codeSize }}>{productCode}</p>
          {showWarehouseSku ? <p className="mp-label-sku">WAREHOUSE SKU {payload.sku}</p> : null}
        </div>
        <p className="mp-label-product-name">{payload.productName || 'Product name pending'}</p>
        <div className="mp-label-specs">
          <span>{payload.dimensions || 'SIZE PENDING'}</span>
          <span>{payload.finish || 'FINISH PENDING'}</span>
        </div>
        <div className="mp-label-price">
          <span className="mp-label-price-caption">MRP<br /><small>INCL. TAX</small></span>
          <strong>Rs. {money(payload.mrpInclusive)}</strong>
          <span className="mp-label-uom">PER {String(payload.priceUom || 'PC').toUpperCase()}</span>
        </div>
        <footer className="mp-label-footer">
          <p><b>{identity.heading}</b><span>{identity.value}</span></p>
          <p><b>TRACE</b><span>{[payload.sourceDocument, locations].filter(Boolean).join(' / ') || 'REGISTERED PRODUCT'}</span></p>
        </footer>
      </section>
    </div>
  </article>;
}

function LegacyLabel({ label, template }: { label: any; template: any }) {
  return <article className="overflow-hidden border border-black/30 bg-white p-[1.6mm] text-black [break-inside:avoid]" style={{ width: `${Number(template.widthMm || 70)}mm`, height: `${Number(template.heightMm || 37)}mm` }}>
    <div className="flex h-full items-center gap-[1.6mm]"><div className="shrink-0"><img src={label.qrDataUrl} alt={`QR ${label.labelCode}`} className="h-[23mm] w-[23mm]"/><p className="mt-[.4mm] text-center font-mono text-[5.6pt] font-bold">{label.labelCode}</p></div><div className="min-w-0 flex-1 text-[7pt] leading-[1.14]"><div className="mb-[.6mm] flex items-center justify-between border-b border-black/25 pb-[.5mm]"><p className="truncate text-[9.3pt] font-black">{label.payload.productCode || label.payload.internalCode || label.payload.sku}</p><span className="ml-1 rounded bg-[#a92f28] px-[1.2mm] py-[.3mm] text-[5.5pt] font-black tracking-wide text-white">MP</span></div><p className="line-clamp-2 font-bold">{label.payload.productName}</p><p className="truncate"><b>BRAND CODE</b> {label.payload.brandCode || 'CODE PENDING'} / <b>NAME</b> {label.payload.brand || 'NAME PENDING'}</p><p className="truncate">{[label.payload.dimensions, label.payload.finish].filter(Boolean).join(' / ')}</p><p className="mt-[.6mm] truncate text-[8pt] font-black">MRP Rs. {money(label.payload.mrpInclusive)} / {String(label.payload.priceUom || 'PC').toUpperCase()}</p><p className="mt-[.4mm] truncate font-black">{label.payload.lotNumber || label.payload.displaySample || 'PRODUCT / SHELF'}</p>{label.payload.sourceDocument ? <p className="truncate">{label.payload.sourceDocument}{label.payload.locations?.length ? ` / ${label.payload.locations.join(', ')}` : ''}</p> : null}</div></div>
  </article>;
}

export default function LabelPrintPage({ params }: { params: Promise<{ runId: string }> }) {
  const { runId } = use(params);
  const [dialogOpened, setDialogOpened] = useState(false);
  const [decision, setDecision] = useState('');
  const [printError, setPrintError] = useState('');
  const [busy, setBusy] = useState(false);
  const [nextOrientation, setNextOrientation] = useState('landscape');
  const [nextCopies, setNextCopies] = useState('1');
  const [nextReason, setNextReason] = useState('Correct printer layout or reprint labels');
  const [cancelReason, setCancelReason] = useState('Browser print dialog cancelled or printer did not complete');
  const { data, loading, error } = useQuery(RUN, { variables: { id: runId }, fetchPolicy: 'network-only' });
  const [confirm, confirmState] = useMutation(CONFIRM, { onCompleted: () => setDecision('confirmed') });
  const [cancel, cancelState] = useMutation(CANCEL, { onCompleted: () => setDecision('cancelled') });
  const [prepare, prepareState] = useMutation(PREPARE);
  const run = data?.internalLabelPrintRun;
  const template = run?.template || {};
  const labels = run?.labels || [];
  const uniqueLabelCount = Number(run?.metadata?.labelCount || labels.length);
  const sourceJobCount = Number(run?.metadata?.jobCount || run?.jobs?.length || 1);
  const bulkRun = uniqueLabelCount > 1 || sourceJobCount > 1;
  const standardFourByTwo = template.code === STANDARD_TEMPLATE;
  const finishFourByTwo = standardFourByTwo && Number(template.version || 0) >= 4;
  const portraitFourByTwo = standardFourByTwo && Number(template.version || 0) >= 2 && Number(template.version || 0) < 4;
  const compactPortraitFourByTwo = standardFourByTwo && Number(template.version || 0) === 3;
  const pageWidth = Number(template.pageWidthMm || template.widthMm || (portraitFourByTwo ? PORTRAIT_WIDTH_MM : LANDSCAPE_WIDTH_MM));
  const pageHeight = Number(template.pageHeightMm || template.heightMm || (portraitFourByTwo ? PORTRAIT_HEIGHT_MM : LANDSCAPE_HEIGHT_MM));
  const columns = Number(template.columns || 1);
  const portrait = pageHeight > pageWidth;
  const runStatus = decision || run?.status;
  const settled = runStatus === 'confirmed' || runStatus === 'cancelled';
  const historical = standardFourByTwo && !finishFourByTwo;
  const canPrint = Boolean(run && labels.length && !error && !settled && !historical && !busy);
  useEffect(() => {
    if (!run?.id) return;
    setNextOrientation(portrait ? 'portrait' : 'landscape');
    setNextCopies(String(run.copies || 1));
    setDialogOpened(false);
    setDecision('');
    setPrintError('');
  }, [runId, run?.id, run?.copies, portrait]);
  useEffect(() => {
    let active = true;
    document.fonts.ready.then(() => { if (active) fitStickerText(); });
    return () => { active = false; };
  }, [data, pageWidth, pageHeight]);
  const printCss = `
    @page { size: ${pageWidth}mm ${pageHeight}mm; margin: 0; }
    :root .label-sheet, :root .label-sheet article, :root .mp-label-page, :root .mp-portrait-label-page, :root .mp-v3-label-page,
    :root.dark .label-sheet, :root.dark .label-sheet article, :root.dark .mp-label-page, :root.dark .mp-portrait-label-page, :root.dark .mp-v3-label-page { background: #fff !important; color: #111 !important; }
    .mp-label-pages { display: grid; gap: 16px; justify-content: center; }
    .mp-portrait-label-page { box-sizing: border-box; width: ${PORTRAIT_WIDTH_MM}mm; height: ${PORTRAIT_HEIGHT_MM}mm; overflow: hidden; padding: 1.9mm; color: #111; background: #fff; font-family: Arial, Helvetica, sans-serif; box-shadow: 0 18px 45px -24px rgba(31, 20, 18, .55); -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .mp-portrait-safe-frame { box-sizing: border-box; display: grid; width: 100%; height: 100%; grid-template-rows: 7.4mm 47.2mm minmax(0, 1fr) 15.2mm; overflow: hidden; border: .38mm solid #111; }
    .mp-portrait-header { display: flex; min-width: 0; align-items: center; justify-content: space-between; gap: 1mm; padding: 1mm 1.2mm; border-bottom: .28mm solid #111; }
    .mp-portrait-brand { display: flex; min-width: 0; align-items: center; gap: .9mm; font: 900 6.5pt/1 Arial, sans-serif; letter-spacing: .55pt; white-space: nowrap; }
    .mp-portrait-mark { display: grid; width: 6.1mm; height: 4.7mm; flex: 0 0 auto; place-items: center; color: #fff; background: #111; font: 900 7pt/1 Arial, sans-serif; letter-spacing: -.3pt; }
    .mp-portrait-kind { flex: 0 0 auto; padding: .8mm 1mm .65mm; color: #fff; background: #111; font: 900 5.2pt/1 Arial, sans-serif; letter-spacing: .38pt; white-space: nowrap; }
    .mp-portrait-qr-panel { display: flex; min-width: 0; flex-direction: column; align-items: center; justify-content: center; overflow: hidden; border-bottom: .3mm solid #111; padding: .9mm 1mm .7mm; }
    .mp-portrait-qr-panel img { display: block; width: 40.8mm; height: 40.8mm; object-fit: contain; image-rendering: auto; }
    .mp-portrait-human-code { width: 100%; margin: .65mm 0 0; overflow: hidden; color: #111; font: 800 6.3pt/1 'Courier New', monospace; letter-spacing: -.08pt; text-align: center; text-overflow: ellipsis; white-space: nowrap; }
    .mp-portrait-code-panel { display: grid; min-height: 0; align-content: stretch; overflow: hidden; }
    .mp-portrait-code-panel.has-identity { grid-template-rows: 7.2mm minmax(13.4mm, 1fr) 6.8mm; }
    .mp-portrait-code-row { display: grid; min-width: 0; align-content: center; gap: .65mm; overflow: hidden; padding: 1.2mm 1.5mm 1.1mm; border-bottom: .22mm solid #777; }
    .mp-portrait-code-panel.has-identity .mp-portrait-code-row { gap: .35mm; padding-top: .45mm; padding-bottom: .45mm; }
    .mp-portrait-code-panel.has-identity .mp-portrait-code-row span { font-size: 4.2pt; }
    .mp-portrait-code-panel.has-identity .mp-portrait-code-row:first-child strong { font-size: 10.5pt; }
    .mp-portrait-code-row:last-child { border-bottom: 0; }
    .mp-portrait-code-row span { color: #333; font: 900 5.2pt/1 Arial, sans-serif; letter-spacing: .75pt; }
    .mp-portrait-code-row strong { min-width: 0; overflow: visible; color: #111; font-family: 'Arial Narrow', Arial, Helvetica, sans-serif; font-size: 14.5pt; font-weight: 900; line-height: 1.08; letter-spacing: -.18pt; overflow-wrap: anywhere; }
    .mp-portrait-identity-code strong { font-family: 'Courier New', monospace; }
    .mp-portrait-rate { display: grid; min-width: 0; grid-template-columns: 10.5mm minmax(0, 1fr); grid-template-rows: 1fr auto; align-items: center; gap: 0 1mm; overflow: hidden; padding: 1.5mm; border-top: .42mm solid #111; }
    .mp-portrait-rate span { grid-row: 1 / span 2; align-self: stretch; display: grid; place-items: center start; border-right: .28mm solid #111; color: #222; font: 900 7pt/1 Arial, sans-serif; letter-spacing: .8pt; }
    .mp-portrait-rate strong { min-width: 0; align-self: end; overflow: hidden; color: #111; font: 900 19.5pt/1.08 'Arial Narrow', Arial, Helvetica, sans-serif; letter-spacing: -.75pt; text-overflow: ellipsis; white-space: nowrap; }
    .mp-portrait-rate b { align-self: start; color: #111; font: 900 7pt/1 Arial, sans-serif; letter-spacing: .25pt; }
    .mp-v3-label-page { box-sizing: border-box; width: ${PORTRAIT_WIDTH_MM}mm; height: ${PORTRAIT_HEIGHT_MM}mm; overflow: hidden; padding: 1.9mm; color: #111; background: #fff; font-family: Arial, Helvetica, sans-serif; box-shadow: 0 18px 45px -24px rgba(31, 20, 18, .55); -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .mp-v3-safe-frame { box-sizing: border-box; display: grid; width: 100%; height: 100%; grid-template-rows: 7.4mm 48.4mm minmax(0, 1fr) 15.4mm; overflow: hidden; border: .38mm solid #111; }
    .mp-v3-header { display: flex; min-width: 0; align-items: center; justify-content: space-between; gap: 1mm; padding: 1mm 1.2mm; border-bottom: .28mm solid #111; }
    .mp-v3-brand { display: flex; min-width: 0; align-items: center; gap: .9mm; font: 900 6.5pt/1 Arial, sans-serif; letter-spacing: .55pt; white-space: nowrap; }
    .mp-v3-mark { display: grid; width: 6.1mm; height: 4.7mm; flex: 0 0 auto; place-items: center; color: #fff; background: #111; font: 900 7pt/1 Arial, sans-serif; letter-spacing: -.3pt; }
    .mp-v3-kind { flex: 0 0 auto; padding: .8mm 1mm .65mm; color: #fff; background: #111; font: 900 5.2pt/1 Arial, sans-serif; letter-spacing: .38pt; white-space: nowrap; }
    .mp-v3-qr-panel { display: flex; min-width: 0; flex-direction: column; align-items: center; justify-content: center; overflow: hidden; border-bottom: .3mm solid #111; padding: .75mm 1mm .65mm; }
    .mp-v3-qr-panel img { display: block; width: 42.3mm; height: 42.3mm; object-fit: contain; image-rendering: auto; }
    .mp-v3-human-code { width: 100%; margin: .55mm 0 0; overflow: hidden; color: #111; font: 800 6.3pt/1 'Courier New', monospace; letter-spacing: -.08pt; text-align: center; text-overflow: ellipsis; white-space: nowrap; }
    .mp-v3-code-panel { display: grid; min-height: 0; grid-template-rows: 8.4mm minmax(0, 1fr); overflow: hidden; }
    .mp-v3-code-row { display: grid; min-width: 0; align-content: center; gap: .45mm; overflow: hidden; padding: .8mm 1.5mm; border-bottom: .22mm solid #777; }
    .mp-v3-code-row:last-child { border-bottom: 0; }
    .mp-v3-code-row span { color: #444; font: 900 4.1pt/1 Arial, sans-serif; letter-spacing: .7pt; }
    .mp-v3-code-row strong { min-width: 0; overflow: hidden; color: #111; font-family: 'Arial Narrow', Arial, Helvetica, sans-serif; font-weight: 900; line-height: 1.02; letter-spacing: -.16pt; overflow-wrap: anywhere; }
    .mp-v3-brand-code strong { font-size: 14pt; letter-spacing: .15pt; white-space: nowrap; }
    .mp-v3-product-code strong { display: -webkit-box; max-height: 12.8mm; -webkit-box-orient: vertical; -webkit-line-clamp: 2; }
    .mp-v3-rate { display: grid; min-width: 0; grid-template-columns: 10.5mm minmax(0, 1fr); grid-template-rows: 1fr auto; align-items: center; gap: 0 1mm; overflow: hidden; padding: 1.5mm; border-top: .42mm solid #111; }
    .mp-v3-rate span { grid-row: 1 / span 2; align-self: stretch; display: grid; place-items: center start; border-right: .28mm solid #111; color: #222; font: 900 7pt/1 Arial, sans-serif; letter-spacing: .8pt; }
    .mp-v3-rate strong { min-width: 0; align-self: end; overflow: hidden; color: #111; font: 900 19.5pt/1.08 'Arial Narrow', Arial, Helvetica, sans-serif; letter-spacing: -.75pt; text-overflow: ellipsis; white-space: nowrap; }
    .mp-v3-rate b { align-self: start; color: #111; font: 900 7pt/1 Arial, sans-serif; letter-spacing: .25pt; }
    .mp-label-page { box-sizing: border-box; width: ${LANDSCAPE_WIDTH_MM}mm; height: ${LANDSCAPE_HEIGHT_MM}mm; overflow: hidden; padding: 2.2mm; color: #111; background: #fff; font-family: Arial, Helvetica, sans-serif; box-shadow: 0 18px 45px -24px rgba(31, 20, 18, .55); -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .mp-label-safe-frame { box-sizing: border-box; display: grid; grid-template-columns: 34.5mm minmax(0, 1fr); width: 100%; height: 100%; overflow: hidden; border: .34mm solid #111; }
    .mp-label-qr-panel { display: flex; min-width: 0; flex-direction: column; align-items: center; justify-content: center; overflow: hidden; border-right: .34mm solid #111; padding: 1.2mm 1.4mm 1mm; }
    .mp-label-qr-frame { display: grid; width: 29.6mm; height: 29.6mm; place-items: center; background: #fff; }
    .mp-label-qr-frame img { display: block; width: 29.6mm; height: 29.6mm; object-fit: contain; image-rendering: auto; }
    .mp-label-human-code { width: 100%; margin: .7mm 0 0; overflow: hidden; color: #111; font: 700 5.8pt/1.12 'Courier New', monospace; letter-spacing: -.08pt; text-align: center; white-space: nowrap; }
    .mp-label-scan-hint { margin: .6mm 0 0; color: #444; font: 700 4.8pt/1 Arial, sans-serif; letter-spacing: .75pt; }
    .mp-label-copy { display: grid; min-width: 0; height: 100%; grid-template-rows: auto auto auto minmax(0, 1fr) auto auto auto; overflow: hidden; padding: 1.35mm 1.65mm 1.2mm; }
    .mp-label-header { display: grid; min-width: 0; grid-template-columns: auto auto; align-items: center; justify-content: space-between; gap: 1.2mm; padding-bottom: .65mm; border-bottom: .22mm solid #111; }
    .mp-label-brand { display: flex; align-items: center; gap: .8mm; font: 800 5.7pt/1 Arial, sans-serif; letter-spacing: .55pt; white-space: nowrap; }
    .mp-label-mark { display: grid; width: 5.2mm; height: 4mm; place-items: center; color: #fff; background: #111; font: 900 6.2pt/1 Arial, sans-serif; letter-spacing: -.3pt; }
    .mp-label-kind { padding: .65mm .9mm .55mm; color: #fff; background: #111; font: 800 5pt/1 Arial, sans-serif; letter-spacing: .35pt; white-space: nowrap; }
    .mp-label-product-brand { display: grid; min-width: 0; grid-template-columns: 18mm minmax(0, 1fr); gap: 1.4mm; padding: .7mm 0 .65mm; border-bottom: .18mm solid #999; }
    .mp-label-product-brand p { display: grid; min-width: 0; margin: 0; gap: .22mm; }
    .mp-label-product-brand span { color: #555; font: 800 4.3pt/1 Arial, sans-serif; letter-spacing: .45pt; }
    .mp-label-product-brand strong { min-width: 0; overflow: hidden; color: #111; font-family: Arial, Helvetica, sans-serif; font-weight: 900; line-height: 1; letter-spacing: .08pt; text-overflow: ellipsis; white-space: nowrap; }
    .mp-label-product-brand p:first-child strong { font-size: 5.8pt; font-family: 'Courier New', monospace; }
    .mp-label-code-block { min-width: 0; padding-top: .8mm; }
    .mp-label-code { max-height: 8.2mm; margin: 0; overflow: hidden; color: #111; font-family: 'Arial Narrow', Arial, Helvetica, sans-serif; font-weight: 900; line-height: .94; letter-spacing: -.2pt; overflow-wrap: anywhere; }
    .mp-label-sku { margin: .5mm 0 0; overflow: hidden; font: 700 5.2pt/1 'Courier New', monospace; letter-spacing: .1pt; text-overflow: ellipsis; white-space: nowrap; }
    .mp-label-product-name { display: -webkit-box; align-self: center; max-height: 7.4mm; margin: .5mm 0; overflow: hidden; color: #111; font: 700 8.3pt/1.06 Arial, Helvetica, sans-serif; -webkit-box-orient: vertical; -webkit-line-clamp: 2; }
    .mp-label-specs { display: grid; min-width: 0; grid-template-columns: minmax(0, 1.15fr) minmax(0, .85fr); gap: 1mm; padding: .8mm 0; border-top: .18mm solid #bbb; color: #333; font: 700 6.1pt/1 Arial, sans-serif; letter-spacing: .08pt; text-transform: uppercase; }
    .mp-label-specs span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .mp-label-price { display: grid; min-width: 0; grid-template-columns: auto minmax(0, 1fr) auto; align-items: end; gap: 1.4mm; padding: 1mm 0 .9mm; border-top: .32mm solid #111; }
    .mp-label-price-caption { font: 800 5.4pt/.95 Arial, sans-serif; letter-spacing: .45pt; }
    .mp-label-price-caption small { font-size: 4.6pt; letter-spacing: .2pt; }
    .mp-label-price strong { min-width: 0; overflow: hidden; color: #111; font: 900 14.2pt/.9 'Arial Narrow', Arial, Helvetica, sans-serif; letter-spacing: -.5pt; text-overflow: ellipsis; white-space: nowrap; }
    .mp-label-uom { padding-bottom: .35mm; font: 900 6.6pt/1 Arial, sans-serif; white-space: nowrap; }
    .mp-label-footer { display: grid; min-width: 0; grid-template-columns: minmax(0, 1fr) minmax(0, 1.35fr); gap: 1.4mm; padding-top: .85mm; border-top: .18mm solid #777; }
    .mp-label-footer p { display: grid; min-width: 0; margin: 0; gap: .35mm; }
    .mp-label-footer b { font: 800 4.7pt/1 Arial, sans-serif; letter-spacing: .45pt; }
    .mp-label-footer span { overflow: hidden; font: 700 5.6pt/1.05 'Courier New', monospace; text-overflow: ellipsis; white-space: nowrap; }
    .mp-v4-label-page { box-sizing: border-box; width: ${pageWidth}mm; height: ${pageHeight}mm; padding: 1.8mm; background: #fff !important; color: #111 !important; font-family: Arial, Helvetica, sans-serif; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .mp-v4-frame { box-sizing: border-box; display: grid; grid-template-columns: 42mm minmax(0, 1fr); grid-template-rows: minmax(0, 1fr); width: 100%; height: 100%; border: .3mm solid #111; }
    .mp-v4-qr { display: flex; flex-direction: column; align-items: center; justify-content: center; min-width: 0; border-right: .3mm solid #111; }
    .mp-v4-qr img { display: block; width: 38mm; height: 38mm; object-fit: contain; }
    .mp-v4-qr p { margin: 1mm 0 0; font: bold 6pt/1 'Courier New', monospace; white-space: nowrap; }
    .mp-v4-copy { display: grid; min-width: 0; min-height: 0; grid-template-columns: minmax(0, 1fr); grid-template-rows: 6mm 7mm minmax(0, 1fr) 7mm 10mm; }
    .mp-v4-header { display: flex; align-items: center; gap: 1.4mm; padding: .7mm 1.5mm; border-bottom: .25mm solid #111; font: 900 7pt/1 Arial, sans-serif; letter-spacing: .5pt; }
    .mp-v4-header b { padding: .6mm; background: #111; color: #fff; }
    .mp-v4-brand, .mp-v4-product, .mp-v4-finish { display: flex; flex-direction: column; justify-content: center; min-width: 0; min-height: 0; gap: .5mm; padding: .6mm 1.5mm; }
    .mp-v4-copy strong, .mp-v4-copy span, .mp-v4-rate b { flex-shrink: 0; }
    .mp-v4-copy span { font: 800 4.5pt/1 Arial, sans-serif; letter-spacing: .7pt; }
    .mp-v4-brand strong { font: 800 11pt/1 Arial, sans-serif; }
    .mp-v4-product strong { display: -webkit-box; min-height: 0; max-height: 2.12em; overflow: hidden; font-weight: 900; line-height: 1.06; letter-spacing: -.2pt; overflow-wrap: anywhere; word-break: break-word; -webkit-box-orient: vertical; -webkit-line-clamp: 2; }
    .mp-v4-identity { display: grid; grid-template-columns: minmax(0, 1fr); min-width: 0; min-height: 0; }
    .mp-v4-identity.has-tile-size { grid-template-columns: minmax(0, 1fr) minmax(0, 1.8fr); }
    .mp-v4-size { display: flex; align-items: center; justify-content: flex-end; min-width: 0; min-height: 0; padding: .6mm 1.5mm .6mm 0; }
    .mp-v4-tile-size { font: 800 10pt/1.1 Arial, sans-serif; white-space: nowrap; letter-spacing: 0; }
    .mp-v4-finish strong { font: 800 10pt/1.05 Arial, sans-serif; overflow-wrap: anywhere; }
    .mp-v4-rate { display: flex; align-items: center; gap: 1.3mm; padding: 1mm 1.5mm; border-top: .35mm solid #111; }
    .mp-v4-rate strong { font: 900 19pt/1 Arial, sans-serif; letter-spacing: -.5pt; white-space: nowrap; }
    .mp-v4-rate b { font: 800 7pt/1 Arial, sans-serif; }
    .mp-v4-label-page.is-portrait .mp-v4-frame { grid-template-columns: 1fr; grid-template-rows: 43mm minmax(0, 1fr); }
    .mp-v4-label-page.is-portrait .mp-v4-qr { border-right: 0; border-bottom: .3mm solid #111; }
    .mp-v4-label-page.is-portrait .mp-v4-copy { grid-template-rows: 6mm 7mm minmax(0, 1fr) 8mm 11mm; }
    .mp-v4-label-page.is-portrait .mp-v4-qr img { width: 38mm; height: 38mm; }
    @media screen {
      .print-controls { background: #202126 !important; color: #fff !important; }
      .print-meta { color: #cbd5e1 !important; }
      .print-steps { background: #f8f5f3 !important; color: #171717 !important; }
    }
    @media print {
      html, body { width: ${pageWidth}mm !important; margin: 0 !important; padding: 0 !important; background: #fff !important; color: #111 !important; }
      body { min-height: 0 !important; background-image: none !important; }
      main { min-height: 0 !important; height: auto !important; margin: 0 !important; padding: 0 !important; }
      .print-controls { display: none !important; }
      .mp-label-pages { display: block !important; }
      .mp-label-page, .mp-portrait-label-page, .mp-v3-label-page { margin: 0 !important; box-shadow: none !important; break-inside: avoid !important; page-break-inside: avoid !important; }
      .mp-label-page:not(:last-child), .mp-portrait-label-page:not(:last-child), .mp-v3-label-page:not(:last-child) { break-after: page !important; page-break-after: always !important; }
      .label-sheet { box-shadow: none !important; margin: 0 !important; }
      .mp-v4-label-page { margin: 0 !important; break-inside: avoid !important; page-break-inside: avoid !important; }
      .mp-v4-label-page:not(:last-child) { break-after: page !important; page-break-after: always !important; }
    }
  `;

  async function openPrintDialog() {
    if (!canPrint) return;
    setPrintError(''); setBusy(true);
    try {
      await waitForPrintAssets();
      setDialogOpened(true);
      window.print();
    } catch (cause) { setPrintError(cause instanceof Error ? cause.message : 'Print preview could not open.'); }
    finally { setBusy(false); }
  }

  async function downloadPdf() {
    if (!canPrint || !finishFourByTwo) return;
    setPrintError(''); setBusy(true);
    try {
      const response = await fetch(`/api/pdf/labels/${encodeURIComponent(runId)}?download=1`);
      if (!response.ok || !response.headers.get('content-type')?.includes('application/pdf')) {
        const body = await response.json().catch(() => null);
        throw new Error(body?.error || 'Sticker PDF could not be generated. Refresh this preview and try again.');
      }
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement('a');
      link.href = url; link.download = `MarblePark_Labels_${run.runNumber.replaceAll('/', '-')}.pdf`;
      document.body.appendChild(link); link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
      setDialogOpened(true);
    } catch (cause) { setPrintError(cause instanceof Error ? cause.message : 'Sticker PDF download failed.'); }
    finally { setBusy(false); }
  }

  async function prepareNewRun() {
    const copies = Number(nextCopies);
    if (!Number.isInteger(copies) || copies < 1 || copies > 50 || !nextReason.trim() || busy) return;
    setPrintError(''); setBusy(true);
    try {
      if (!settled) await cancel({ variables: { id: runId, reason: `Replaced print setup: ${nextReason.trim()}` } });
      const result = await prepare({ variables: { input: {
        templateCode: STANDARD_TEMPLATE, labelIds: [...new Set(labels.map((label: any) => label.id))],
        copies, orientation: nextOrientation, reason: nextReason.trim(),
      } } });
      const id = result.data?.prepareInternalLabelPrintRun?.id;
      if (id) window.location.assign(`/print/labels/${id}`);
    } catch (cause) { setPrintError(cause instanceof Error ? cause.message : 'A new print run could not be prepared.'); }
    finally { setBusy(false); }
  }

  if (loading) return <div className="grid min-h-screen place-items-center bg-white text-black">Preparing sticker pages...</div>;

  return <main className="min-h-screen bg-[#f4f1ef] p-4 text-black print:bg-white print:p-0">
    <style dangerouslySetInnerHTML={{ __html: printCss }} />
    {[error, confirmState.error, cancelState.error, prepareState.error].map((item, index) => item ? <div key={index} className="print-controls mx-auto max-w-5xl"><QueryErrorBanner error={item}/></div> : null)}
    <section className="print-controls mx-auto mb-5 max-w-5xl overflow-hidden rounded-2xl border border-[#e4d8d3] shadow-[0_24px_70px_-48px_rgba(73,32,28,.7)]">
      <div className="h-1.5 bg-[linear-gradient(90deg,#2a201f,#a92f28,#d77761)]" />
      <div className="p-5 sm:p-6">
        <Link href="/dashboard/inventory/labels?tab=print" className="mb-4 inline-flex items-center gap-2 text-sm text-white/80"><ArrowLeft className="h-4 w-4"/>Back to label selection</Link>
        <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
          <div><p className="text-xs font-bold uppercase tracking-[.16em] text-[#e38a7f]">Sticker print - {run?.runNumber}</p>
            <h1 className="mt-2 text-2xl font-black !text-white">{historical ? 'Historical sticker preview' : `${bulkRun ? 'Bulk ' : ''}${portrait ? '2 × 4 inch portrait' : '4 × 2 inch landscape'} stickers`}</h1>
            <p className="print-meta mt-1 text-sm">{labels.length} sticker pages · {uniqueLabelCount} unique labels · {sourceJobCount} jobs · {run?.copies || 1} copies each.</p>
          </div>
          <div className="flex shrink-0 flex-col gap-2">
            <Button className="bg-[#a92f28] hover:bg-[#8d2722]" disabled={!canPrint} onClick={openPrintDialog}><Printer className="mr-2 h-4 w-4"/>{busy ? 'Preparing…' : `Print all ${labels.length} stickers`}</Button>
            {finishFourByTwo ? <Button variant="outline" className="bg-white text-black" disabled={!canPrint} onClick={downloadPdf}><Download className="mr-2 h-4 w-4"/>Download {labels.length}-page sticker PDF</Button> : null}
          </div>
        </div>
        <div className="print-steps mt-4 grid gap-3 rounded-xl p-4 text-xs sm:grid-cols-4">
          <p><b>Printer paper size</b><br/>{pageWidth} × {pageHeight} mm<br/>{portrait ? '2 in wide × 4 in feed' : '4 in wide × 2 in feed'}</p>
          <p><b>Orientation</b><br/>{portrait ? 'Portrait' : 'Landscape'}<br/>Change the run setup below, not only the printer dialog.</p>
          <p><b>Scaling</b><br/>100% / Actual size<br/>Margins none; headers off.</p>
          <p><b>All stickers together</b><br/>All pages; one page per sheet.<br/>Printer copies = 1 (copies are already included).</p>
        </div>
        <p className="print-meta mt-3 text-xs leading-5">If a label crosses a gap, stop the printer. Set its custom paper size to match this run and calibrate gap detection. The PDF contains one exact-size page per sticker.</p>
        {historical ? <p className="mt-4 rounded-lg bg-amber-50 p-3 text-sm font-semibold text-amber-950">This saved run uses an older fixed layout. Create a new run below for finish, correct orientation and multi-page PDF.</p> : null}
        {printError ? <p role="alert" className="mt-4 rounded-lg bg-red-50 p-3 text-sm font-semibold text-red-900">{printError}</p> : null}
        {dialogOpened && !settled ? <div className="mt-4 rounded-lg border border-blue-200 bg-blue-50 p-4 text-blue-950"><p className="font-bold">Did every sticker print correctly?</p><p className="mt-1 text-xs">Downloading is not confirmation. Check the physical stickers and scan a QR before confirming. Cancel if output was clipped, incomplete or did not print.</p><div className="mt-3 flex flex-col gap-2 sm:flex-row"><Button disabled={confirmState.loading || cancelState.loading} onClick={() => { void confirm({ variables: { id: runId } }).catch(() => {}); }}><CheckCircle2 className="mr-2 h-4 w-4"/>Confirm printed</Button><input aria-label="Print cancellation reason" value={cancelReason} onChange={(event) => setCancelReason(event.target.value)} className="h-10 min-w-0 flex-1 rounded-md border border-blue-200 bg-white px-3 text-sm"/><Button variant="outline" disabled={cancelState.loading || confirmState.loading || !cancelReason.trim()} onClick={() => { void cancel({ variables: { id: runId, reason: cancelReason } }).catch(() => {}); }}><XCircle className="mr-2 h-4 w-4"/>Cancel / failed</Button></div></div> : null}
        {settled ? <div aria-live="polite" className={`mt-4 rounded-lg p-3 text-sm font-bold ${runStatus === 'confirmed' ? 'bg-emerald-50 text-emerald-800' : 'bg-amber-50 text-amber-800'}`}>{runStatus === 'confirmed' ? 'Print confirmed and audited. Use a new run for more copies.' : 'Run cancelled; print counts unchanged. Create a new run to retry.'}</div> : null}
        {run ? <details className="mt-4 rounded-lg border border-white/20 p-3" open={historical || settled}>
          <summary className="cursor-pointer text-sm font-bold">Change orientation, copies or reprint</summary>
          <div className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
            <label>Printer layout<select aria-label="New run orientation" className="mt-1 h-10 w-full rounded-md bg-white px-3 text-black" value={nextOrientation} onChange={(event) => setNextOrientation(event.target.value)}><option value="landscape">Landscape · 4 × 2 inches</option><option value="portrait">Portrait · 2 × 4 inches</option></select></label>
            <label>Copies per selected sticker<input aria-label="New run copies" type="number" min={1} max={50} step={1} className="mt-1 h-10 w-full rounded-md bg-white px-3 text-black" value={nextCopies} onChange={(event) => setNextCopies(event.target.value)}/></label>
            <label className="sm:col-span-2">Reason for new run<input aria-label="New run reason" className="mt-1 h-10 w-full rounded-md bg-white px-3 text-black" value={nextReason} onChange={(event) => setNextReason(event.target.value)}/></label>
          </div>
          <p className="print-meta my-3 text-xs">Keeps the same selected labels. Any unconfirmed setup is cancelled without changing print counts; a new audited run is created.</p>
          <Button disabled={busy || !nextReason.trim() || !Number.isInteger(Number(nextCopies)) || Number(nextCopies) < 1 || Number(nextCopies) > 50 || uniqueLabelCount * Number(nextCopies) > 1000} onClick={prepareNewRun}>{busy ? 'Preparing…' : 'Create new print run'}</Button>
        </details> : null}
      </div>
    </section>
    {finishFourByTwo ? <section className="mp-label-pages">{labels.map((label: any, index: number) => <FinishFourByTwoLabelV4 key={`${label.id}-${label.copyIndex}-${index}`} label={label} portrait={portrait}/>)}</section> : compactPortraitFourByTwo ? <section className="mp-label-pages">{labels.map((label: any, index: number) => <CompactPortraitFourByTwoLabelV3 key={`${label.id}-${label.copyIndex}-${index}`} label={label}/>)}</section> : portraitFourByTwo ? <section className="mp-label-pages">{labels.map((label: any, index: number) => <PortraitFourByTwoLabelV2 key={`${label.id}-${label.copyIndex}-${index}`} label={label}/>)}</section> : standardFourByTwo ? <section className="mp-label-pages">{labels.map((label: any, index: number) => <StandardFourByTwoLabel key={`${label.id}-${label.copyIndex}-${index}`} label={label}/>)}</section> : <section className="label-sheet mx-auto grid bg-white shadow-xl" style={{ width: `${pageWidth}mm`, minHeight: `${pageHeight}mm`, gridTemplateColumns: `repeat(${columns}, ${Number(template.widthMm || 70)}mm)`, gridAutoRows: `${Number(template.heightMm || 37)}mm`, columnGap: `${Number(template.gapXMm || 0)}mm`, rowGap: `${Number(template.gapYMm || 0)}mm`, padding: `${Number(template.marginTopMm || 0)}mm ${Number(template.marginRightMm || 0)}mm ${Number(template.marginBottomMm || 0)}mm ${Number(template.marginLeftMm || 0)}mm` }}>{labels.map((label: any, index: number) => <LegacyLabel key={`${label.id}-${label.copyIndex}-${index}`} label={label} template={template}/>)}</section>}
  </main>;
}

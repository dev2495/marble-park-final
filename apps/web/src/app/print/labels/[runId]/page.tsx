'use client';

import { use, useState } from 'react';
import { gql, useMutation, useQuery } from '@apollo/client';
import { CheckCircle2, Printer, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { QueryErrorBanner } from '@/components/query-state';

const RUN = gql`query LabelPrintRun($id: ID!) { internalLabelPrintRun(id: $id) }`;
const CONFIRM = gql`mutation ConfirmLabelPrint($id: ID!) { confirmInternalLabelPrintRun(id: $id) }`;
const CANCEL = gql`mutation CancelLabelPrint($id: ID!, $reason: String!) { cancelInternalLabelPrintRun(id: $id, reason: $reason) }`;
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

async function waitForPrintAssets() {
  if (typeof document === 'undefined') return;
  if (document.fonts?.ready) await document.fonts.ready;
  await Promise.all(Array.from(document.images).map(async (image) => {
    if (image.complete) return;
    try { await image.decode(); } catch { /* The print preview exposes any failed image. */ }
  }));
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
  const [cancelReason, setCancelReason] = useState('Browser print dialog cancelled or printer did not complete');
  const { data, loading, error } = useQuery(RUN, { variables: { id: runId }, fetchPolicy: 'network-only' });
  const [confirm, confirmState] = useMutation(CONFIRM, { onCompleted: () => setDecision('confirmed') });
  const [cancel, cancelState] = useMutation(CANCEL, { onCompleted: () => setDecision('cancelled') });
  const run = data?.internalLabelPrintRun;
  const template = run?.template || {};
  const labels = run?.labels || [];
  const uniqueLabelCount = Number(run?.metadata?.labelCount || labels.length);
  const sourceJobCount = Number(run?.metadata?.jobCount || run?.jobs?.length || 1);
  const bulkRun = uniqueLabelCount > 1 || sourceJobCount > 1;
  const standardFourByTwo = template.code === STANDARD_TEMPLATE;
  const portraitFourByTwo = standardFourByTwo && Number(template.version || 0) >= 2;
  const compactPortraitFourByTwo = standardFourByTwo && Number(template.version || 0) >= 3;
  const pageWidth = Number(template.pageWidthMm || template.widthMm || (portraitFourByTwo ? PORTRAIT_WIDTH_MM : LANDSCAPE_WIDTH_MM));
  const pageHeight = Number(template.pageHeightMm || template.heightMm || (portraitFourByTwo ? PORTRAIT_HEIGHT_MM : LANDSCAPE_HEIGHT_MM));
  const columns = Number(template.columns || 1);
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
    @media screen {
      .print-controls { background: #202126 !important; color: #fff !important; }
      .print-meta { color: #cbd5e1 !important; }
      .print-steps { background: #f8f5f3 !important; color: #171717 !important; }
    }
    @media print {
      html, body { width: ${pageWidth}mm !important; margin: 0 !important; padding: 0 !important; background: #fff !important; color: #111 !important; }
      body { min-height: 0 !important; background-image: none !important; }
      .print-controls { display: none !important; }
      .mp-label-pages { display: block !important; }
      .mp-label-page, .mp-portrait-label-page, .mp-v3-label-page { margin: 0 !important; box-shadow: none !important; break-inside: avoid !important; page-break-inside: avoid !important; }
      .mp-label-page:not(:last-child), .mp-portrait-label-page:not(:last-child), .mp-v3-label-page:not(:last-child) { break-after: page !important; page-break-after: always !important; }
      .label-sheet { box-shadow: none !important; margin: 0 !important; }
    }
  `;

  async function openPrintDialog() {
    setDialogOpened(true);
    await waitForPrintAssets();
    window.print();
  }

  if (loading) return <div className="grid min-h-screen place-items-center bg-white text-black">Preparing exact 2 x 4 inch portrait labels...</div>;

  return <main className="min-h-screen bg-[#f4f1ef] p-4 text-black print:bg-white print:p-0">
    <style dangerouslySetInnerHTML={{ __html: printCss }} />
    {error ? <div className="print-controls mx-auto max-w-3xl"><QueryErrorBanner error={error}/></div> : null}
    <section className="print-controls mx-auto mb-5 max-w-5xl overflow-hidden rounded-2xl border border-[#e4d8d3] shadow-[0_24px_70px_-48px_rgba(73,32,28,.7)]">
      <div className="h-1.5 bg-[linear-gradient(90deg,#2a201f,#a92f28,#d77761)]" />
      <div className="p-5 sm:p-6"><div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center"><div><p className="text-xs font-bold uppercase tracking-[.16em] text-[#e38a7f]">Physical identity print - {run?.runNumber}</p><h1 className="mt-2 text-2xl font-black">{portraitFourByTwo ? `${bulkRun ? 'Bulk ' : ''}2 x 4 inch portrait sticker${bulkRun ? 's' : ''}` : standardFourByTwo ? 'Historic 4 x 2 inch sticker' : template.name}</h1><p className="print-meta mt-1 text-sm">{labels.length} physical sticker page{labels.length === 1 ? '' : 's'} · {uniqueLabelCount} unique label{uniqueLabelCount === 1 ? '' : 's'} from {sourceJobCount} job{sourceJobCount === 1 ? '' : 's'} · exact {pageWidth} × {pageHeight} mm.</p></div><Button className="bg-[#a92f28] hover:bg-[#8d2722]" disabled={!run || !labels.length || Boolean(error) || decision === 'confirmed' || decision === 'cancelled'} onClick={openPrintDialog}><Printer className="mr-2 h-4 w-4"/>Print all {labels.length} sticker{labels.length === 1 ? '' : 's'}</Button></div>
        <div className="print-steps mt-4 grid gap-2 rounded-xl p-3 text-xs sm:grid-cols-4"><p><b>Paper</b><br/>{portraitFourByTwo ? '2 x 4 inch / 50.8 x 101.6 mm.' : `${pageWidth} x ${pageHeight} mm.`}</p><p><b>Orientation</b><br/>{portraitFourByTwo ? 'Portrait.' : 'Use saved run setting.'}</p><p><b>Scale</b><br/>100% or Actual size.</p><p><b>Options</b><br/>One page per sheet; margins none; headers off.</p></div>
        {dialogOpened && !decision ? <div className="mt-4 rounded-lg border border-blue-200 bg-blue-50 p-4"><p className="font-bold text-blue-950">Did the printer complete this run at full sticker size?</p><p className="mt-1 text-xs text-blue-800">Confirm only after the physical 2 x 4 inch portrait output is readable and the QR scans. If the dialog was cancelled, scaled down, clipped, or the printer failed, cancel the run; print counts remain unchanged.</p><div className="mt-3 flex flex-col gap-2 sm:flex-row"><Button disabled={confirmState.loading} onClick={() => confirm({ variables: { id: runId } })}><CheckCircle2 className="mr-2 h-4 w-4"/>Confirm printed</Button><input value={cancelReason} onChange={(event) => setCancelReason(event.target.value)} className="h-10 flex-1 rounded-md border border-blue-200 bg-white px-3 text-sm"/><Button variant="outline" disabled={cancelState.loading || !cancelReason.trim()} onClick={() => cancel({ variables: { id: runId, reason: cancelReason } })}><XCircle className="mr-2 h-4 w-4"/>Cancel / failed</Button></div></div> : null}
        {decision ? <div aria-live="polite" className={`mt-4 rounded-lg p-3 text-sm font-bold ${decision === 'confirmed' ? 'bg-emerald-50 text-emerald-800' : 'bg-amber-50 text-amber-800'}`}>{decision === 'confirmed' ? 'Print confirmed and audited. Reprinting will create a new run.' : 'Run cancelled; no label print counts were changed.'}</div> : null}
      </div>
    </section>
    {compactPortraitFourByTwo ? <section className="mp-label-pages">{labels.map((label: any, index: number) => <CompactPortraitFourByTwoLabelV3 key={`${label.id}-${label.copyIndex}-${index}`} label={label}/>)}</section> : portraitFourByTwo ? <section className="mp-label-pages">{labels.map((label: any, index: number) => <PortraitFourByTwoLabelV2 key={`${label.id}-${label.copyIndex}-${index}`} label={label}/>)}</section> : standardFourByTwo ? <section className="mp-label-pages">{labels.map((label: any, index: number) => <StandardFourByTwoLabel key={`${label.id}-${label.copyIndex}-${index}`} label={label}/>)}</section> : <section className="label-sheet mx-auto grid bg-white shadow-xl" style={{ width: `${pageWidth}mm`, minHeight: `${pageHeight}mm`, gridTemplateColumns: `repeat(${columns}, ${Number(template.widthMm || 70)}mm)`, gridAutoRows: `${Number(template.heightMm || 37)}mm`, columnGap: `${Number(template.gapXMm || 0)}mm`, rowGap: `${Number(template.gapYMm || 0)}mm`, padding: `${Number(template.marginTopMm || 0)}mm ${Number(template.marginRightMm || 0)}mm ${Number(template.marginBottomMm || 0)}mm ${Number(template.marginLeftMm || 0)}mm` }}>{labels.map((label: any, index: number) => <LegacyLabel key={`${label.id}-${label.copyIndex}-${index}`} label={label} template={template}/>)}</section>}
  </main>;
}

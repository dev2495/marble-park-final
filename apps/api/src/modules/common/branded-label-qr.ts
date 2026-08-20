import * as QRCode from 'qrcode';

/**
 * A standards-valid QR with a small protected brand mark in the redundant
 * centre area. Error correction H is deliberate: scanners still recover the
 * complete MP-LABEL payload when the visual mark obscures centre modules.
 */
export async function brandedLabelQrDataUrl(value: string) {
  const svg = await QRCode.toString(value, {
    type: 'svg',
    errorCorrectionLevel: 'H',
    margin: 2,
    width: 360,
    color: { dark: '#111111', light: '#ffffff' },
  });
  const viewBox = svg.match(/viewBox="0 0 ([\d.]+) ([\d.]+)"/);
  const modules = Number(viewBox?.[1] || 37);
  const outer = modules * 0.18;
  const outerX = (modules - outer) / 2;
  const inner = outer * 0.82;
  const innerX = (modules - inner) / 2;
  const fixed = (value: number) => value.toFixed(3);
  const mark = [
    '<g aria-label="Marble Park MP mark">',
    `<rect x="${fixed(outerX)}" y="${fixed(outerX)}" width="${fixed(outer)}" height="${fixed(outer)}" rx="${fixed(outer * 0.18)}" fill="#ffffff"/>`,
    `<rect x="${fixed(innerX)}" y="${fixed(innerX)}" width="${fixed(inner)}" height="${fixed(inner)}" rx="${fixed(inner * 0.18)}" fill="#a92f28"/>`,
    `<text x="${fixed(modules / 2)}" y="${fixed(modules / 2 + outer * 0.15)}" text-anchor="middle" font-family="Arial,Helvetica,sans-serif" font-size="${fixed(outer * 0.4)}" font-weight="900" letter-spacing="-.12" fill="#ffffff">MP</text>`,
    '</g>',
  ].join('');
  const branded = svg.replace('</svg>', `${mark}</svg>`);
  return `data:image/svg+xml;base64,${Buffer.from(branded).toString('base64')}`;
}

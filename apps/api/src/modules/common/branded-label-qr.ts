import * as QRCode from 'qrcode';

/**
 * Generates a standards-valid, high-contrast MP identity QR. The data modules
 * are rounded for the Marble Park visual language while the three finder eyes
 * retain the exact QR geometry scanners expect. A protected MP mark occupies
 * only the error-correctable centre of an H-level symbol.
 */
export async function brandedLabelQrDataUrl(value: string) {
  const qr = QRCode.create(value, { errorCorrectionLevel: 'H' });
  const size = qr.modules.size;
  const margin = 3;
  const canvas = size + margin * 2;
  const inFinder = (row: number, col: number) => (
    (row < 7 && col < 7) ||
    (row < 7 && col >= size - 7) ||
    (row >= size - 7 && col < 7)
  );
  const dots: string[] = [];
  for (let row = 0; row < size; row += 1) {
    for (let col = 0; col < size; col += 1) {
      if (!qr.modules.get(row, col) || inFinder(row, col)) continue;
      const x = margin + col + 0.025;
      const y = margin + row + 0.025;
      dots.push(`<rect x="${x.toFixed(3)}" y="${y.toFixed(3)}" width=".95" height=".95" rx=".13" fill="#111111"/>`);
    }
  }
  const eye = (x: number, y: number) => [
    `<rect x="${x}" y="${y}" width="7" height="7" rx=".55" fill="#111111"/>`,
    `<rect x="${x + 1}" y="${y + 1}" width="5" height="5" rx=".28" fill="#ffffff"/>`,
    `<rect x="${x + 2}" y="${y + 2}" width="3" height="3" rx=".22" fill="#9f302a"/>`,
  ].join('');
  const markSize = Math.max(5.2, size * 0.18);
  const markX = margin + (size - markSize) / 2;
  const inner = markSize * 0.82;
  const innerX = margin + (size - inner) / 2;
  // Draw MP as geometry: server-side PDF rasterisation must not depend on OS fonts.
  const letterHeight = markSize * 0.4;
  const letterX = canvas / 2 - letterHeight * 0.8;
  const letterY = canvas / 2 - letterHeight / 2;
  const fixed = (number: number) => number.toFixed(3);
  const mark = [
    '<g aria-label="Marble Park MP brand mark">',
    `<rect x="${fixed(markX)}" y="${fixed(markX)}" width="${fixed(markSize)}" height="${fixed(markSize)}" rx="${fixed(markSize * 0.2)}" fill="#ffffff"/>`,
    `<rect x="${fixed(innerX)}" y="${fixed(innerX)}" width="${fixed(inner)}" height="${fixed(inner)}" rx="${fixed(inner * 0.2)}" fill="#9f302a"/>`,
    `<path d="M0 1V0L.32 .6 .64 0V1M1 1V0H1.34Q1.6 0 1.6 .27T1.34 .54H1" transform="translate(${fixed(letterX)} ${fixed(letterY)}) scale(${fixed(letterHeight)})" fill="none" stroke="#ffffff" stroke-width=".12" stroke-linejoin="round" stroke-linecap="square"/>`,
    '</g>',
  ].join('');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${canvas} ${canvas}" width="360" height="360" shape-rendering="geometricPrecision" role="img" aria-label="Marble Park scannable identity QR"><rect width="${canvas}" height="${canvas}" fill="#ffffff"/>${dots.join('')}${eye(margin, margin)}${eye(margin + size - 7, margin)}${eye(margin, margin + size - 7)}${mark}</svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
}

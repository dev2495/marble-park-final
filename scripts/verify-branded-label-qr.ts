import jsQR from 'jsqr';
import sharp from 'sharp';
import { brandedLabelQrDataUrl } from '../apps/api/src/modules/common/branded-label-qr';

async function main() {
  const values = [
    'MP-LABEL:LB/2026/0017-0001',
    'MP-LABEL:LB/2099/9999-0500',
    'MP-LABEL:DISPLAY-WALL-MT1NGCBP-0001',
  ];

  for (const value of values) {
    const dataUrl = await brandedLabelQrDataUrl(value);
    const svg = Buffer.from(dataUrl.split(',')[1], 'base64');
    const { data, info } = await sharp(svg).png().ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const decoded = jsQR(new Uint8ClampedArray(data.buffer, data.byteOffset, data.byteLength), info.width, info.height, { inversionAttempts: 'dontInvert' });
    if (decoded?.data !== value) throw new Error(`Branded QR failed round-trip: expected ${value}, decoded ${decoded?.data || 'nothing'}`);
  }

  if (process.env.QR_SAMPLE_OUTPUT) {
    const dataUrl = await brandedLabelQrDataUrl(values[0]);
    const svg = Buffer.from(dataUrl.split(',')[1], 'base64');
    await sharp(svg).png().resize(720, 720, { kernel: 'nearest' }).toFile(process.env.QR_SAMPLE_OUTPUT);
  }

  console.log(JSON.stringify({ ok: true, decodedPayloads: values.length, sample: process.env.QR_SAMPLE_OUTPUT || null }, null, 2));
}

main().catch((error) => { console.error(error); process.exitCode = 1; });

// Pulls the photos named in content/selection.json from the ERP's public
// catalogue-image route and writes web-ready textures to public/media.
//
//   npm run sync:media          (MP_ERP_ORIGIN overrides the source host)
//
// Products with role "cutout" have their background removed with the macOS
// Vision framework (scripts/cutout.swift), so this step needs a Mac.
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const origin = process.env.MP_ERP_ORIGIN || 'https://65-1-24-110.sslip.io';
const outDir = path.join(root, 'public', 'media');
const selection = JSON.parse(await readFile(path.join(root, 'content', 'selection.json'), 'utf8'));
const work = await mkdtemp(path.join(tmpdir(), 'marble-park-media-'));

await mkdir(outDir, { recursive: true });

async function fetchImage(src) {
  if (!src.startsWith('/catalogue-images/')) throw new Error(`Unexpected image path: ${src}`);
  const response = await fetch(origin + src);
  if (!response.ok) throw new Error(`${response.status} for ${src}`);
  return Buffer.from(await response.arrayBuffer());
}

const white = { r: 255, g: 255, b: 255, alpha: 1 };

function surface(item, input) {
  const image = sharp(input).rotate();
  switch (item.role) {
    case 'door':
      // Landscape slab turned upright and cropped to one door leaf.
      return image.rotate(90).resize(560, 1500, { fit: 'cover' }).webp({ quality: 84 });
    case 'slab':
      return image.resize(1024, 1024, { fit: 'inside', withoutEnlargement: true }).webp({ quality: 84 });
    case 'floor':
      return image.resize(1024, 683, { fit: 'cover' }).webp({ quality: 80 });
    default:
      return image.flatten({ background: white }).resize(1024, 1024, { fit: 'inside', withoutEnlargement: true }).webp({ quality: 84 });
  }
}

/**
 * Fallback for flat, front-on products (flush plates) where Vision finds no
 * subject: clear every near-white pixel connected to the border.
 */
async function keyOutWhite(input, output) {
  const { data, info } = await sharp(input).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width, height } = info;
  const isWhite = (i) => Math.min(data[i * 4], data[i * 4 + 1], data[i * 4 + 2]) > 242;
  const seen = new Uint8Array(width * height);
  const stack = [];
  for (let x = 0; x < width; x += 1) stack.push(x, (height - 1) * width + x);
  for (let y = 0; y < height; y += 1) stack.push(y * width, y * width + width - 1);
  while (stack.length) {
    const i = stack.pop();
    if (seen[i] || !isWhite(i)) continue;
    seen[i] = 1;
    data[i * 4 + 3] = 0;
    const x = i % width;
    if (x > 0) stack.push(i - 1);
    if (x < width - 1) stack.push(i + 1);
    if (i >= width) stack.push(i - width);
    if (i < width * (height - 1)) stack.push(i + width);
  }
  await sharp(data, { raw: info }).png().toFile(output);
}

/** A soft drop shadow from a cut-out's outline, on a canvas 30% larger so the blur is not clipped. */
async function shadow(subject, id) {
  const meta = await sharp(subject).metadata();
  const pad = Math.round(Math.max(meta.width, meta.height) * 0.15);
  const width = meta.width + pad * 2;
  const height = meta.height + pad * 2;
  const black = { create: { width, height, channels: 3, background: { r: 0, g: 0, b: 0 } } };
  const outline = await sharp(subject).ensureAlpha().extractChannel('alpha').toColourspace('b-w').png().toBuffer();
  const mask = await sharp(black).composite([{ input: outline, left: pad, top: pad }]).png().toBuffer();
  const soft = await sharp(mask).extractChannel(0).blur(Math.max(4, pad * 0.3)).png().toBuffer();
  // Join first, then shrink: sharp resizes before it joins channels within one pipeline.
  const full = await sharp(black).joinChannel(soft).png().toBuffer();
  await sharp(full).resize(Math.round(width / 3)).webp({ quality: 60, alphaQuality: 80 }).toFile(path.join(outDir, `${id}-shadow.webp`));
  return [width / meta.width, height / meta.height];
}

/** Crop a cut-out to its subject and make a soft drop shadow from its outline. */
async function cutout(item, png) {
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let left = info.width, top = info.height, right = 0, bottom = 0;
  for (let y = 0; y < info.height; y += 1) {
    for (let x = 0; x < info.width; x += 1) {
      if (data[(y * info.width + x) * 4 + 3] > 12) {
        if (x < left) left = x; if (x > right) right = x; if (y < top) top = y; if (y > bottom) bottom = y;
      }
    }
  }
  if (right <= left || bottom <= top) throw new Error(`Nothing left after background removal: ${item.id}`);
  const box = { left, top, width: right - left + 1, height: bottom - top + 1 };
  const subject = await sharp(png).extract(box).resize(900, 900, { fit: 'inside', withoutEnlargement: true }).png().toBuffer();
  const meta = await sharp(subject).metadata();
  await sharp(subject).webp({ quality: 88, alphaQuality: 92 }).toFile(path.join(outDir, `${item.id}.webp`));

  const shadowScale = await shadow(subject, item.id);
  return { width: meta.width, height: meta.height, shadowScale };
}

if (process.argv.includes('--shadows')) {
  for (const item of selection.filter((entry) => entry.role === 'cutout')) await shadow(await readFile(path.join(outDir, `${item.id}.webp`)), item.id);
  console.log('Shadows regenerated.');
  process.exit(0);
}

const manifest = [];
const cutouts = [];
for (const item of selection) {
  const source = await fetchImage(item.src);
  const entry = { id: item.id, role: item.role, sku: item.sku, title: item.title, brand: item.brand, meta: item.meta, file: `/media/${item.id}.webp` };
  if (item.role === 'cutout') {
    const input = path.join(work, `${item.id}.png`);
    await sharp(source).rotate().flatten({ background: white }).png().toFile(input);
    cutouts.push({ item, entry, input, output: path.join(work, `${item.id}-cut.png`) });
  } else {
    const info = await surface(item, source).toFile(path.join(outDir, `${item.id}.webp`));
    entry.aspect = Number((info.width / info.height).toFixed(4));
    console.log(`${item.id}.webp  ${info.width}x${info.height}  ${(info.size / 1024).toFixed(0)} kB`);
  }
  manifest.push(entry);
}

if (cutouts.length) {
  if (process.platform !== 'darwin') throw new Error('Background removal uses the macOS Vision framework; run this on a Mac.');
  console.log(`\nRemoving backgrounds from ${cutouts.length} product photos…`);
  execFileSync('swift', [path.join(root, 'scripts', 'cutout.swift'), ...cutouts.flatMap((c) => [c.input, c.output])], { stdio: ['ignore', 'ignore', 'inherit'] });
  for (const { item, entry, input, output } of cutouts) {
    if (!existsSync(output)) await keyOutWhite(input, output);
    const info = await cutout(item, output);
    entry.aspect = Number((info.width / info.height).toFixed(4));
    entry.shadow = `/media/${item.id}-shadow.webp`;
    entry.shadowScale = info.shadowScale.map((value) => Number(value.toFixed(4)));
    console.log(`${item.id}.webp  ${info.width}x${info.height}  cut out`);
  }
}

await rm(work, { recursive: true, force: true });
await writeFile(path.join(root, 'src', 'media.json'), JSON.stringify(manifest, null, 1) + '\n');
console.log(`\n${manifest.length} images written to public/media`);

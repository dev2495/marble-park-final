import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';

const require = createRequire(import.meta.url);
const { PNG } = require('pngjs');
const { PrismaClient } = require('@prisma/client');
const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');

const prisma = new PrismaClient();
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const publicRoot = path.join(root, 'apps/web/public/catalogue-images');

const pdfSources = [
  {
    file: 'data folder n sample/Aquant Price List Vol 15. Feb 2026_Searchable.pdf',
    slug: 'aquant-price-list-2026',
    categories: ['Faucets & Showers', 'Sanitaryware', 'Kitchen Sinks', 'Accessories'],
  },
  {
    file: 'data folder n sample/Granite Flyer_2024_V02_Without Beethoven.pdf',
    slug: 'granite-sinks-2024',
    categories: ['Kitchen Sinks', 'Catalogue Products'],
  },
  {
    file: 'data folder n sample/Largo 2420 flyer - WP (1).pdf',
    slug: 'largo-2420',
    categories: ['Kitchen Sinks'],
  },
  {
    file: 'data folder n sample/Product flyer New style with all new products x18-3.pdf',
    slug: 'new-style-products',
    categories: ['Faucets & Showers', 'Sanitaryware', 'Kitchen Sinks', 'Accessories', 'Catalogue Products'],
    maxPages: 30,
  },
  {
    file: 'data folder n sample/Stainless-Steel-Sinks-Price-List.pdf',
    slug: 'stainless-steel-sinks',
    categories: ['Kitchen Sinks'],
  },
];

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function waitForImage(page, id) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timed out while extracting ${id}`)), 7000);
    page.objs.get(id, (image) => {
      clearTimeout(timer);
      resolve(image);
    });
  });
}

function toPngBuffer(image) {
  const png = new PNG({ width: image.width, height: image.height });
  const source = image.data;

  if (image.kind === pdfjs.ImageKind.RGBA_32BPP) {
    Buffer.from(source).copy(png.data);
  } else if (image.kind === pdfjs.ImageKind.RGB_24BPP) {
    for (let i = 0, j = 0; i < source.length; i += 3, j += 4) {
      png.data[j] = source[i];
      png.data[j + 1] = source[i + 1];
      png.data[j + 2] = source[i + 2];
      png.data[j + 3] = 255;
    }
  } else {
    for (let i = 0, j = 0; i < source.length; i += 1, j += 4) {
      const value = source[i];
      png.data[j] = value;
      png.data[j + 1] = value;
      png.data[j + 2] = value;
      png.data[j + 3] = 255;
    }
  }

  return PNG.sync.write(png);
}

function isUsableProductImage(image) {
  if (!image || !image.width || !image.height || !image.data) return false;
  if (image.width < 100 || image.height < 80) return false;
  if (image.width > 2600 || image.height > 2600) return false;
  const ratio = image.width / image.height;
  if (ratio < 0.22 || ratio > 4.8) return false;
  return true;
}

function categoryForIndex(source, index) {
  return source.categories[index % source.categories.length];
}

function pickImage(bucket, product, index) {
  const primaryBucket = bucket[product.category] || [];
  const generalBucket = bucket.General || [];
  const candidates = primaryBucket.length ? primaryBucket : generalBucket;
  if (!candidates.length) return null;
  const stable = Math.abs([...product.sku].reduce((sum, char) => sum + char.charCodeAt(0), index));
  return candidates[stable % candidates.length];
}

async function extractImages() {
  ensureDir(publicRoot);
  const seen = new Set();
  const images = [];

  for (const source of pdfSources) {
    const filePath = path.join(root, source.file);
    if (!fs.existsSync(filePath)) continue;

    const bytes = new Uint8Array(fs.readFileSync(filePath));
    const pdf = await pdfjs.getDocument({ data: bytes, disableWorker: true }).promise;
    const maxPages = Math.min(source.maxPages || pdf.numPages, pdf.numPages);
    let sourceImageIndex = 0;

    for (let pageNumber = 1; pageNumber <= maxPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const operatorList = await page.getOperatorList();

      for (let opIndex = 0; opIndex < operatorList.fnArray.length; opIndex += 1) {
        const fn = operatorList.fnArray[opIndex];
        const args = operatorList.argsArray[opIndex];
        if (fn !== pdfjs.OPS.paintImageXObject && fn !== pdfjs.OPS.paintInlineImageXObject) continue;

        const imageId = args?.[0];
        const image = typeof imageId === 'string' ? await waitForImage(page, imageId) : imageId;
        if (!isUsableProductImage(image)) continue;

        const png = toPngBuffer(image);
        const hash = crypto.createHash('sha1').update(png).digest('hex').slice(0, 14);
        if (seen.has(hash)) continue;
        seen.add(hash);

        const category = categoryForIndex(source, sourceImageIndex);
        const fileName = `${source.slug}-p${String(pageNumber).padStart(3, '0')}-${String(sourceImageIndex + 1).padStart(3, '0')}-${hash}.png`;
        const relativePath = `/catalogue-images/${fileName}`;
        fs.writeFileSync(path.join(publicRoot, fileName), png);

        images.push({
          path: relativePath,
          file: source.file,
          source: source.slug,
          page: pageNumber,
          width: image.width,
          height: image.height,
          category,
        });
        sourceImageIndex += 1;
      }
    }

    await pdf.destroy();
  }

  fs.writeFileSync(path.join(publicRoot, 'manifest.json'), JSON.stringify(images, null, 2));
  return images;
}

async function updateProducts(images) {
  const buckets = { General: images };
  for (const image of images) {
    buckets[image.category] ||= [];
    buckets[image.category].push(image);
  }

  await prisma.product.updateMany({
    where: { category: 'Faucets' },
    data: { category: 'Faucets & Showers', updatedAt: new Date() },
  });

  const products = await prisma.product.findMany({
    where: { status: 'active' },
    orderBy: [{ category: 'asc' }, { sku: 'asc' }],
  });

  let updated = 0;
  for (let index = 0; index < products.length; index += 1) {
    const product = products[index];
    const image = pickImage(buckets, product, index);
    if (!image) continue;

    await prisma.product.update({
      where: { id: product.id },
      data: {
        media: {
          primary: image.path,
          gallery: [image.path],
          source: 'pdf-catalogue-extract',
          extractedFrom: image.file,
          extractedPage: image.page,
          exactSkuMatch: false,
        },
        updatedAt: new Date(),
      },
    });
    updated += 1;
  }

  return { totalProducts: products.length, updated };
}

async function main() {
  const images = await extractImages();
  const productUpdate = await updateProducts(images);
  console.log(JSON.stringify({ extractedImages: images.length, ...productUpdate }, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

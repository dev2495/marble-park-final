import fs from 'fs';
import path from 'path';
import { PrismaClient } from '@prisma/client';
import { fileURLToPath } from 'url';

const prisma = new PrismaClient();
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifestPath = path.join(root, 'apps/web/public/catalogue-images/manifest.json');

function area(image) { return Number(image.width || 0) * Number(image.height || 0); }
function quality(image) {
  const a = area(image);
  if (a >= 900000) return '4k-source';
  if (a >= 250000) return 'large-source';
  if (a >= 120000) return 'medium-source';
  return 'thumbnail-source';
}
function bucketCategory(category) {
  if (!category) return 'Catalogue Products';
  if (category === 'Faucets') return 'Faucets & Showers';
  return category;
}
function pickImage(buckets, product, index) {
  const category = bucketCategory(product.category);
  const candidates = buckets[category]?.length ? buckets[category] : buckets.General;
  if (!candidates?.length) return null;
  const stable = Math.abs([...product.sku].reduce((sum, char) => sum + char.charCodeAt(0), index));
  return candidates[stable % candidates.length];
}

async function main() {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const eligible = manifest
    .filter((image) => area(image) >= 250000)
    .sort((a, b) => area(b) - area(a));
  if (!eligible.length) throw new Error('No high-resolution catalogue images found');

  const buckets = { General: eligible };
  for (const image of eligible) {
    const category = bucketCategory(image.category);
    buckets[category] ||= [];
    buckets[category].push(image);
  }

  await prisma.product.updateMany({ where: { category: 'Faucets' }, data: { category: 'Faucets & Showers', updatedAt: new Date() } });
  const products = await prisma.product.findMany({ where: { status: 'active' }, orderBy: [{ category: 'asc' }, { sku: 'asc' }] });
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
          source: 'pdf-catalogue-highres-remap',
          extractedFrom: image.file,
          extractedPage: image.page,
          originalWidth: image.width,
          originalHeight: image.height,
          displayQuality: quality(image),
          exactSkuMatch: false,
        },
        updatedAt: new Date(),
      },
    });
    updated += 1;
  }
  const stats = eligible.reduce((acc, image) => {
    acc[quality(image)] = (acc[quality(image)] || 0) + 1;
    return acc;
  }, {});
  console.log(JSON.stringify({ eligibleImages: eligible.length, stats, updatedProducts: updated }, null, 2));
}

main().finally(async () => prisma.$disconnect());

import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcrypt';
import { ulid } from 'ulid';

const prisma = new PrismaClient();

async function optionalDelete(modelName) {
  if (!prisma[modelName]) return;
  await prisma[modelName].deleteMany().catch(() => null);
}

async function clearBusinessData() {
  const orderedModels = [
    'returnLine', 'returnOrder', 'deliveryProof', 'shipment', 'dispatchLine', 'dispatchPackage',
    'stockAdjustmentApproval', 'stockCountLine', 'stockCountSession', 'stockLedgerEntry', 'stockBalanceByLocation', 'stockLocation',
    'productVendor', 'reorderPolicy', 'paymentReceipt', 'documentJob', 'salesOrderLine', 'quoteLine',
    'goodsReceiptLine', 'goodsReceiptNote', 'purchaseOrderLine', 'purchaseOrder', 'purchaseDemand', 'sequenceCounter',
    'dispatchChallan', 'dispatchJob', 'reservation', 'salesOrder', 'activity', 'followUpTask', 'quote', 'leadIntent', 'lead',
    'inventoryMovement', 'inventoryInwardBatch', 'inventoryBalance', 'notification', 'auditEvent', 'customer', 'vendor',
    'product', 'productBrand', 'productCategory', 'productFinish', 'tileSize', 'passwordResetToken', 'session',
  ];
  for (const modelName of orderedModels) await optionalDelete(modelName);
}

async function ensureAdmin() {
  const passwordHash = await bcrypt.hash(process.env.CLIENT_RESET_ADMIN_PASSWORD || 'password123', 10);
  await prisma.user.deleteMany({ where: { email: { not: 'admin@marblepark.com' } } });
  await prisma.user.upsert({
    where: { email: 'admin@marblepark.com' },
    update: {
      name: 'Marble Park Admin',
      role: 'admin',
      phone: '9820098199',
      active: true,
      passwordHash,
    },
    create: {
      id: ulid(),
      email: 'admin@marblepark.com',
      passwordHash,
      name: 'Marble Park Admin',
      role: 'admin',
      phone: '9820098199',
      active: true,
    },
  });
}

async function countProductsWithImages() {
  const products = await prisma.product.findMany({ select: { media: true } });
  return products.filter((product) => {
    const media = product.media || {};
    return Boolean(media.primary || (Array.isArray(media.gallery) && media.gallery.length));
  }).length;
}

async function main() {
  await clearBusinessData();
  await ensureAdmin();
  const counts = {
    users: await prisma.user.count(),
    products: await prisma.product.count(),
    productImages: await countProductsWithImages(),
    customers: await prisma.customer.count(),
    leads: await prisma.lead.count(),
    quotes: await prisma.quote.count(),
    inventoryBalances: await prisma.inventoryBalance.count(),
  };
  console.log(JSON.stringify({ ok: true, counts }, null, 2));
}

main().finally(async () => prisma.$disconnect());

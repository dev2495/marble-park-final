import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcrypt';
import { ulid } from 'ulid';

const prisma = new PrismaClient();

async function clearBusinessData() {
  await prisma.dispatchChallan.deleteMany();
  await prisma.dispatchJob.deleteMany();
  await prisma.reservation.deleteMany();
  await prisma.salesOrder.deleteMany();
  await prisma.activity.deleteMany();
  await prisma.followUpTask.deleteMany();
  await prisma.quote.deleteMany();
  await prisma.leadIntent.deleteMany();
  await prisma.lead.deleteMany();
  await prisma.inventoryMovement.deleteMany();
  await prisma.inventoryInwardBatch.deleteMany();
  await prisma.inventoryBalance.deleteMany();
  await prisma.importRow.deleteMany();
  await prisma.importBatch.deleteMany();
  await prisma.catalogReviewTask.deleteMany();
  await prisma.sourceFile.deleteMany();
  await prisma.notification.deleteMany();
  await prisma.auditEvent.deleteMany();
  await prisma.customer.deleteMany();
  await prisma.vendor.deleteMany();
  await prisma.product.deleteMany();
  await prisma.productBrand.deleteMany();
  await prisma.productCategory.deleteMany();
  await prisma.productFinish.deleteMany();
  await prisma.passwordResetToken.deleteMany();
  await prisma.session.deleteMany();
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

async function main() {
  await clearBusinessData();
  await ensureAdmin();
  const counts = {
    users: await prisma.user.count(),
    products: await prisma.product.count(),
    customers: await prisma.customer.count(),
    leads: await prisma.lead.count(),
    quotes: await prisma.quote.count(),
    imports: await prisma.importBatch.count(),
    catalogueImagesPending: await prisma.catalogReviewTask.count(),
    inventoryBalances: await prisma.inventoryBalance.count(),
  };
  console.log(JSON.stringify({ ok: true, counts }, null, 2));
}

main().finally(async () => prisma.$disconnect());

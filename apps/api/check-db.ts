import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
async function main() {
  const products = await prisma.product.count();
  const leads = await prisma.lead.count();
  const quotes = await prisma.quote.count();
  console.log({ products, leads, quotes });
}
main().catch(console.error).finally(() => prisma.$disconnect());

import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcrypt');
const { ulid } = require('ulid');

const prisma = new PrismaClient();

const roleUsers = [
  { email: 'admin@marblepark.com', name: 'Marble Park Admin', role: 'admin', phone: '9820098299' },
  { email: 'owner@marblepark.com', name: 'Aditya Mehta', role: 'owner', phone: '9820098200' },
  { email: 'manager@marblepark.com', name: 'Nisha Shah', role: 'sales_manager', phone: '9820098201' },
  { email: 'sales@marblepark.com', name: 'Rajesh Sharma', role: 'sales', phone: '9810098100' },
  { email: 'sales2@marblepark.com', name: 'Meera Contractor Desk', role: 'sales', phone: '9810098103' },
  { email: 'sales3@marblepark.com', name: 'Kabir Retail Walk-ins', role: 'sales', phone: '9810098104' },
  { email: 'inventory@marblepark.com', name: 'Vikram Store', role: 'inventory_manager', phone: '9810098101' },
  { email: 'dispatch@marblepark.com', name: 'Imran Dispatch', role: 'dispatch_ops', phone: '9810098102' },
];

function quoteTotal(lines) {
  return lines.reduce((sum, line) => sum + Number(line.qty || 0) * Number(line.price || 0), 0);
}

async function upsertUsers() {
  const passwordHash = await bcrypt.hash('password123', 10);
  const users = {};

  for (const user of roleUsers) {
    const saved = await prisma.user.upsert({
      where: { email: user.email },
      create: {
        id: ulid(),
        ...user,
        passwordHash,
        active: true,
      },
      update: {
        name: user.name,
        role: user.role,
        phone: user.phone,
        active: true,
      },
    });
    users[user.email] = saved;
  }

  return users;
}

async function upsertCustomer(input) {
  const existing = await prisma.customer.findFirst({ where: { name: input.name } });
  if (existing) return existing;
  return prisma.customer.create({
    data: {
      id: ulid(),
      name: input.name,
      email: input.email || '',
      mobile: input.mobile,
      architectName: input.architectName || '',
      siteAddress: input.siteAddress,
      city: input.city,
      updatedAt: new Date(),
    },
  });
}

async function createLeadAndQuote({ owner, customer, title, stage, source, value, status, projectName, product }) {
  let lead = await prisma.lead.findFirst({ where: { title } });
  if (!lead) {
    lead = await prisma.lead.create({
      data: {
        id: ulid(),
        customerId: customer.id,
        ownerId: owner.id,
        title,
        source,
        stage,
        expectedValue: value,
        lastContactAt: new Date(Date.now() - 86400000),
        nextActionAt: new Date(Date.now() + 86400000 * 2),
        notes: `${projectName} pipeline sample for role-wise analytics.`,
        updatedAt: new Date(),
      },
    });
  }

  const existingQuote = await prisma.quote.findFirst({ where: { title: projectName } });
  if (existingQuote) return { lead, quote: existingQuote };

  const lines = [{
    productId: product.id,
    sku: product.sku,
    name: product.name,
    qty: status === 'confirmed' ? 4 : 2,
    price: product.sellPrice,
    total: Number(product.sellPrice) * (status === 'confirmed' ? 4 : 2),
    media: product.media,
  }];
  const year = new Date().getFullYear();
  const count = await prisma.quote.count({ where: { quoteNumber: { startsWith: `QT/${year}` } } });

  const quote = await prisma.quote.create({
    data: {
      id: ulid(),
      quoteNumber: `QT/${year}/${String(count + 1).padStart(4, '0')}`,
      leadId: lead.id,
      customerId: customer.id,
      ownerId: owner.id,
      title: projectName,
      status,
      approvalStatus: 'approved',
      discountPercent: status === 'sent' ? 5 : 0,
      projectName,
      validUntil: new Date(Date.now() + 86400000 * 20),
      sentAt: ['sent', 'confirmed'].includes(status) ? new Date(Date.now() - 86400000) : null,
      confirmedAt: status === 'confirmed' ? new Date() : null,
      coverImage: product.media?.primary || '',
      notes: `Auto sample quote total ${quoteTotal(lines)}`,
      lines,
      versions: [],
      updatedAt: new Date(),
    },
  });

  return { lead, quote };
}

async function main() {
  const users = await upsertUsers();
  await prisma.product.updateMany({
    where: { category: 'Faucets' },
    data: { category: 'Faucets & Showers', updatedAt: new Date() },
  });

  const products = await prisma.product.findMany({ take: 8, orderBy: { name: 'asc' } });
  if (!products.length) {
    console.log(JSON.stringify({ users: Object.keys(users).length, samples: 0 }, null, 2));
    return;
  }

  const customers = await Promise.all([
    upsertCustomer({ name: 'Patel Bungalow Bath Selection', email: 'patel.family@example.com', mobile: '9833300011', architectName: 'Studio Stone', siteAddress: 'Bodakdev, Ahmedabad', city: 'Ahmedabad' }),
    upsertCustomer({ name: 'Arihant Developers Sample Flat', email: 'purchase@arihant.example', mobile: '9833300012', architectName: 'Arc. Neel Parekh', siteAddress: 'Borivali West, Mumbai', city: 'Mumbai' }),
    upsertCustomer({ name: 'Zenith Hotel Washroom Upgrade', email: 'projects@zenith.example', mobile: '9833300013', architectName: 'Hospitality Design Co', siteAddress: 'Pune Nagar Road', city: 'Pune' }),
  ]);

  await createLeadAndQuote({
    owner: users['sales@marblepark.com'],
    customer: customers[0],
    title: 'Patel bungalow full bath package',
    stage: 'quoted',
    source: 'Architect referral',
    value: 365000,
    status: 'sent',
    projectName: 'Patel Bungalow Bath Package',
    product: products[0],
  });
  await createLeadAndQuote({
    owner: users['sales2@marblepark.com'],
    customer: customers[1],
    title: 'Arihant sample flat sanitaryware set',
    stage: 'won',
    source: 'Builder visit',
    value: 510000,
    status: 'confirmed',
    projectName: 'Arihant Sample Flat Package',
    product: products[1] || products[0],
  });
  await createLeadAndQuote({
    owner: users['sales3@marblepark.com'],
    customer: customers[2],
    title: 'Zenith hotel washroom replacement',
    stage: 'contacted',
    source: 'Walk-in BOQ',
    value: 780000,
    status: 'draft',
    projectName: 'Zenith Hotel Washroom Replacement',
    product: products[2] || products[0],
  });

  const summary = {
    users: await prisma.user.count({ where: { active: true } }),
    products: await prisma.product.count(),
    categories: await prisma.product.groupBy({ by: ['category'], _count: { _all: true } }),
    leads: await prisma.lead.count(),
    quotes: await prisma.quote.count(),
  };
  console.log(JSON.stringify(summary, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => prisma.$disconnect());

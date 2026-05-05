const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcrypt');
const { ulid } = require('ulid');

const prisma = new PrismaClient();

async function main() {
  console.log('Seeding Database for Marble Park retail ops...');

  await prisma.activity.deleteMany();
  await prisma.followUpTask.deleteMany();
  await prisma.leadIntent.deleteMany();
  await prisma.salesOrder.deleteMany();
  await prisma.reservation.deleteMany();
  await prisma.dispatchChallan.deleteMany();
  await prisma.dispatchJob.deleteMany();
  await prisma.quote.deleteMany();
  await prisma.lead.deleteMany();
  await prisma.inventoryMovement.deleteMany();
  await prisma.inventoryBalance.deleteMany();
  await prisma.product.deleteMany();
  await prisma.customer.deleteMany();
  await prisma.user.deleteMany();

  const passwordHash = await bcrypt.hash('password123', 10);
  const users = await Promise.all([
    prisma.user.create({ data: { id: ulid(), email: 'owner@marblepark.com', passwordHash, name: 'Aditya Mehta', role: 'owner', phone: '9820098200', active: true } }),
    prisma.user.create({ data: { id: ulid(), email: 'manager@marblepark.com', passwordHash, name: 'Nisha Shah', role: 'sales_manager', phone: '9820098201', active: true } }),
    prisma.user.create({ data: { id: ulid(), email: 'sales@marblepark.com', passwordHash, name: 'Rajesh Sharma', role: 'sales', phone: '9810098100', active: true } }),
    prisma.user.create({ data: { id: ulid(), email: 'inventory@marblepark.com', passwordHash, name: 'Vikram Store', role: 'inventory_manager', phone: '9810098101', active: true } }),
    prisma.user.create({ data: { id: ulid(), email: 'dispatch@marblepark.com', passwordHash, name: 'Imran Dispatch', role: 'dispatch_ops', phone: '9810098102', active: true } }),
    prisma.user.create({ data: { id: ulid(), email: 'office@marblepark.com', passwordHash, name: 'Pooja Office', role: 'office_staff', phone: '9810098103', active: true } }),
  ]);
  const sales = users[2];

  const products = [
    { sku: 'GRO-23571003', name: 'Grohe Eurostyle Basin Mixer', category: 'Faucets', brand: 'Grohe', finish: 'Chrome', dimensions: 'Single lever, 1/2 inch', unit: 'PC', sellPrice: 8950, floorPrice: 8050, description: 'Premium CP basin mixer imported from Grohe CP catalogue with quote-ready pricing.' },
    { sku: 'HSG-71400000', name: 'Hansgrohe Vernis Blend Pillar Tap', category: 'Faucets', brand: 'Hansgrohe', finish: 'Chrome', dimensions: 'Standard pillar mount', unit: 'PC', sellPrice: 6250, floorPrice: 5525, description: 'Fast-moving retail faucet SKU for bathroom projects and replacement sales.' },
    { sku: 'HIN-WC-ARIA-RIM', name: 'Hindware Aria Rimless Wall Hung WC', category: 'Sanitaryware', brand: 'Hindware', finish: 'Gloss White', dimensions: '520 x 365 x 355 mm', unit: 'PC', sellPrice: 18600, floorPrice: 16200, description: 'Wall-hung WC with rimless bowl, seat cover, and quote image placeholder.' },
    { sku: 'HIN-BSN-EDGE-550', name: 'Hindware Edge Table Top Basin', category: 'Sanitaryware', brand: 'Hindware', finish: 'Gloss White', dimensions: '550 x 380 mm', unit: 'PC', sellPrice: 7400, floorPrice: 6550, description: 'Retail basin SKU for architect-led bathroom selections.' },
    { sku: 'AQ-SS-2418-HM', name: 'Aquant Handmade SS Sink 24x18', category: 'Kitchen Sinks', brand: 'Aquant', finish: 'Satin Steel', dimensions: '24 x 18 x 10 inch', unit: 'PC', sellPrice: 12800, floorPrice: 11200, description: 'Handmade stainless steel sink with catalogue source trace and dispatch-ready stock.' },
    { sku: 'AQ-GRAN-LARGO-2420', name: 'Aquant Largo Granite Sink 2420', category: 'Kitchen Sinks', brand: 'Aquant', finish: 'Granite Black', dimensions: '24 x 20 inch', unit: 'PC', sellPrice: 22800, floorPrice: 19800, description: 'Granite sink line from Largo flyer for premium kitchen quotes.' },
    { sku: 'TIL-STAT-6001200', name: 'Statuario Porcelain Tile 600x1200', category: 'Tiles', brand: 'Marble Park Select', finish: 'Polished', dimensions: '600 x 1200 mm', unit: 'BOX', sellPrice: 1450, floorPrice: 1250, description: 'Large-format polished tile with box-wise inventory and project quotation support.' },
    { sku: 'TIL-CONC-MATT-600', name: 'Concrete Grey Matt Tile 600x600', category: 'Tiles', brand: 'Marble Park Select', finish: 'Matt', dimensions: '600 x 600 mm', unit: 'BOX', sellPrice: 780, floorPrice: 690, description: 'Commercial bathroom and utility floor tile for bulk dispatch planning.' },
  ];

  const createdProducts: any[] = [];
  for (const productInput of products) {
    const product = await prisma.product.create({
      data: {
        id: ulid(),
        ...productInput,
        status: 'active',
        tags: { segment: 'retail', quoteReady: true },
        media: { swatch: productInput.finish, source: 'seed' },
        sourceRefs: { catalog: productInput.brand, importedFrom: 'seed catalogue baseline' },
        taxClass: 'GST_18',
        updatedAt: new Date(),
      },
    });
    createdProducts.push(product);

    const onHand = productInput.category === 'Tiles' ? 120 : 18;
    const reserved = productInput.category === 'Kitchen Sinks' ? 2 : 0;
    await prisma.inventoryBalance.create({
      data: {
        id: ulid(),
        productId: product.id,
        onHand,
        reserved,
        available: onHand - reserved,
        damaged: 0,
        hold: 0,
        updatedAt: new Date(),
      },
    });
  }

  const customer1 = await prisma.customer.create({
    data: {
      id: ulid(),
      name: 'Gupta Residence Upgrade',
      email: 'gaurav@guptaco.in',
      mobile: '9833398333',
      architectName: 'Arc. Gauravbhai Patel',
      siteAddress: 'Satellite Road, Ahmedabad',
      city: 'Ahmedabad',
      updatedAt: new Date(),
    },
  });

  const customer2 = await prisma.customer.create({
    data: {
      id: ulid(),
      name: 'Nexus Commercial Washroom Project',
      email: 'procurement@nexus.in',
      mobile: '9844498444',
      architectName: 'Studio Nexus',
      siteAddress: 'Andheri Kurla Road',
      city: 'Mumbai',
      updatedAt: new Date(),
    },
  });

  const lead1 = await prisma.lead.create({
    data: {
      id: ulid(),
      title: 'Premium bathroom renovation package',
      stage: 'quoted',
      source: 'Architect referral',
      expectedValue: 485000,
      lastContactAt: new Date(),
      nextActionAt: new Date(Date.now() + 86400000 * 2),
      notes: 'Client needs Grohe faucets, Hindware sanitaryware, Aquant sink, and tiles in one polished quote.',
      customerId: customer1.id,
      ownerId: sales.id,
      updatedAt: new Date(),
    },
  });

  await prisma.lead.create({
    data: {
      id: ulid(),
      title: 'Commercial washroom BOQ import and quote',
      stage: 'contacted',
      source: 'Walk-in BOQ',
      expectedValue: 925000,
      lastContactAt: new Date(),
      nextActionAt: new Date(Date.now() + 86400000),
      notes: 'Bulk sanitaryware and CP fitting quote awaiting PDF catalogue review.',
      customerId: customer2.id,
      ownerId: sales.id,
      updatedAt: new Date(),
    },
  });

  await prisma.quote.create({
    data: {
      id: ulid(),
      quoteNumber: 'MP/QT/2026/001',
      title: 'Bathroom Selection Proposal - Gupta Residence',
      leadId: lead1.id,
      customerId: customer1.id,
      ownerId: sales.id,
      status: 'sent',
      approvalStatus: 'approved',
      discountPercent: 7.5,
      projectName: 'Gupta Residence Ahmedabad',
      validUntil: new Date(Date.now() + 86400000 * 14),
      coverImage: 'catalogue-bathroom-selection',
      notes: 'Quote layout should preserve product images, SKU detail, totals, and terms for client sharing.',
      lines: [
        { sku: 'GRO-23571003', name: 'Grohe Eurostyle Basin Mixer', qty: 4, price: 8950, total: 35800 },
        { sku: 'HIN-WC-ARIA-RIM', name: 'Hindware Aria Rimless Wall Hung WC', qty: 3, price: 18600, total: 55800 },
        { sku: 'AQ-SS-2418-HM', name: 'Aquant Handmade SS Sink 24x18', qty: 1, price: 12800, total: 12800 },
        { sku: 'TIL-STAT-6001200', name: 'Statuario Porcelain Tile 600x1200', qty: 42, price: 1450, total: 60900 },
      ],
      versions: [],
      updatedAt: new Date(),
    },
  });

  await prisma.followUpTask.create({
    data: {
      id: ulid(),
      leadId: lead1.id,
      ownerId: sales.id,
      dueAt: new Date(Date.now() - 3600000),
      status: 'pending',
      notes: 'Confirm selected finishes and convert quote to stock reservation.',
      updatedAt: new Date(),
    },
  });

  console.log('--- SEEDING COMPLETE ---');
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

export {};

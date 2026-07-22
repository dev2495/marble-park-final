import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function ids(model, where) {
  return (await prisma[model].findMany({ where, select: { id: true } }).catch(() => [])).map((row) => row.id);
}

async function remove(model, where) {
  if (!where || !prisma[model]) return 0;
  const result = await prisma[model].deleteMany({ where }).catch((error) => {
    throw new Error(`Cleanup failed at ${model}: ${error.message}`);
  });
  return result.count;
}

async function main() {
  const productIds = await ids('product', { sku: { startsWith: 'CLIENT-FLOW-' } });
  const customerIds = await ids('customer', { OR: [{ email: { endsWith: '@example.test' } }, { name: { startsWith: 'Client workflow customer' } }] });
  const leadIds = await ids('lead', customerIds.length ? { customerId: { in: customerIds } } : { id: { in: [] } });
  const quoteIds = await ids('quote', { OR: [customerIds.length ? { customerId: { in: customerIds } } : undefined, leadIds.length ? { leadId: { in: leadIds } } : undefined].filter(Boolean) });
  const orderIds = await ids('salesOrder', { OR: [quoteIds.length ? { quoteId: { in: quoteIds } } : undefined, customerIds.length ? { customerId: { in: customerIds } } : undefined].filter(Boolean) });
  const orderLineIds = await ids('salesOrderLine', { OR: [orderIds.length ? { salesOrderId: { in: orderIds } } : undefined, productIds.length ? { productId: { in: productIds } } : undefined].filter(Boolean) });
  const demandIds = await ids('purchaseDemand', { OR: [productIds.length ? { productId: { in: productIds } } : undefined, quoteIds.length ? { sourceQuoteId: { in: quoteIds } } : undefined, orderIds.length ? { sourceOrderId: { in: orderIds } } : undefined].filter(Boolean) });
  const purchaseOrderLineIds = await ids('purchaseOrderLine', { OR: [productIds.length ? { productId: { in: productIds } } : undefined, demandIds.length ? { purchaseDemandId: { in: demandIds } } : undefined].filter(Boolean) });
  const purchaseOrderIds = purchaseOrderLineIds.length
    ? [...new Set((await prisma.purchaseOrderLine.findMany({ where: { id: { in: purchaseOrderLineIds } }, select: { purchaseOrderId: true } })).map((row) => row.purchaseOrderId))]
    : [];
  const goodsReceiptIds = await ids('goodsReceiptNote', purchaseOrderIds.length ? { purchaseOrderId: { in: purchaseOrderIds } } : { id: { in: [] } });
  const lotIds = await ids('inventoryLot', productIds.length ? { productId: { in: productIds } } : { id: { in: [] } });
  const reservationIds = await ids('reservation', { OR: [productIds.length ? { productId: { in: productIds } } : undefined, quoteIds.length ? { quoteId: { in: quoteIds } } : undefined, orderIds.length ? { salesOrderId: { in: orderIds } } : undefined].filter(Boolean) });
  const pickListIds = await ids('pickList', orderIds.length ? { salesOrderId: { in: orderIds } } : { id: { in: [] } });
  const pickLineIds = await ids('pickLine', { OR: [pickListIds.length ? { pickListId: { in: pickListIds } } : undefined, productIds.length ? { productId: { in: productIds } } : undefined].filter(Boolean) });
  const dispatchJobIds = await ids('dispatchJob', { OR: [quoteIds.length ? { quoteId: { in: quoteIds } } : undefined, orderIds.length ? { salesOrderId: { in: orderIds } } : undefined, customerIds.length ? { customerId: { in: customerIds } } : undefined].filter(Boolean) });
  const challanIds = await ids('dispatchChallan', { OR: [dispatchJobIds.length ? { dispatchJobId: { in: dispatchJobIds } } : undefined, quoteIds.length ? { quoteId: { in: quoteIds } } : undefined, orderIds.length ? { salesOrderId: { in: orderIds } } : undefined].filter(Boolean) });
  const dispatchLineIds = await ids('dispatchLine', { OR: [dispatchJobIds.length ? { dispatchJobId: { in: dispatchJobIds } } : undefined, challanIds.length ? { challanId: { in: challanIds } } : undefined, orderIds.length ? { salesOrderId: { in: orderIds } } : undefined, productIds.length ? { productId: { in: productIds } } : undefined].filter(Boolean) });
  const returnOrderIds = await ids('returnOrder', { OR: [orderIds.length ? { salesOrderId: { in: orderIds } } : undefined, challanIds.length ? { challanId: { in: challanIds } } : undefined, customerIds.length ? { customerId: { in: customerIds } } : undefined].filter(Boolean) });

  const entityIds = [...productIds, ...customerIds, ...leadIds, ...quoteIds, ...orderIds, ...demandIds, ...purchaseOrderIds, ...goodsReceiptIds, ...lotIds, ...pickListIds, ...dispatchJobIds, ...challanIds, ...returnOrderIds];
  const deleted = {};
  const drop = async (model, where) => { deleted[model] = await remove(model, where); };

  await drop('creditNote', returnOrderIds.length || orderIds.length ? { OR: [returnOrderIds.length ? { returnOrderId: { in: returnOrderIds } } : undefined, orderIds.length ? { salesOrderId: { in: orderIds } } : undefined].filter(Boolean) } : null);
  await drop('returnLine', returnOrderIds.length || dispatchLineIds.length || productIds.length ? { OR: [returnOrderIds.length ? { returnOrderId: { in: returnOrderIds } } : undefined, dispatchLineIds.length ? { dispatchLineId: { in: dispatchLineIds } } : undefined, productIds.length ? { productId: { in: productIds } } : undefined].filter(Boolean) } : null);
  await drop('returnOrder', returnOrderIds.length ? { id: { in: returnOrderIds } } : null);
  await drop('deliveryProof', challanIds.length ? { challanId: { in: challanIds } } : null);
  await drop('shipment', challanIds.length || dispatchJobIds.length ? { OR: [challanIds.length ? { challanId: { in: challanIds } } : undefined, dispatchJobIds.length ? { dispatchJobId: { in: dispatchJobIds } } : undefined].filter(Boolean) } : null);
  await drop('dispatchPackage', challanIds.length || dispatchJobIds.length ? { OR: [challanIds.length ? { challanId: { in: challanIds } } : undefined, dispatchJobIds.length ? { dispatchJobId: { in: dispatchJobIds } } : undefined].filter(Boolean) } : null);
  await drop('dispatchLine', dispatchLineIds.length ? { id: { in: dispatchLineIds } } : null);
  await drop('dispatchChallan', challanIds.length ? { id: { in: challanIds } } : null);
  await drop('pickLine', pickLineIds.length ? { id: { in: pickLineIds } } : null);
  await drop('pickList', pickListIds.length ? { id: { in: pickListIds } } : null);
  await drop('lotReservation', reservationIds.length || lotIds.length || orderLineIds.length ? { OR: [reservationIds.length ? { reservationId: { in: reservationIds } } : undefined, lotIds.length ? { lotId: { in: lotIds } } : undefined, orderLineIds.length ? { salesOrderLineId: { in: orderLineIds } } : undefined].filter(Boolean) } : null);
  await drop('reservation', reservationIds.length ? { id: { in: reservationIds } } : null);
  await drop('paymentReceipt', orderIds.length ? { salesOrderId: { in: orderIds } } : null);
  await drop('goodsReceiptLine', goodsReceiptIds.length || productIds.length || lotIds.length ? { OR: [goodsReceiptIds.length ? { goodsReceiptNoteId: { in: goodsReceiptIds } } : undefined, productIds.length ? { productId: { in: productIds } } : undefined, lotIds.length ? { lotId: { in: lotIds } } : undefined].filter(Boolean) } : null);
  await drop('inventoryLotLedgerEntry', productIds.length || lotIds.length ? { OR: [productIds.length ? { productId: { in: productIds } } : undefined, lotIds.length ? { lotId: { in: lotIds } } : undefined].filter(Boolean) } : null);
  await drop('stockLedgerEntry', productIds.length || lotIds.length ? { OR: [productIds.length ? { productId: { in: productIds } } : undefined, lotIds.length ? { lotId: { in: lotIds } } : undefined].filter(Boolean) } : null);
  await drop('stockBalanceByLocation', productIds.length ? { productId: { in: productIds } } : null);
  await drop('inventoryLotBalance', lotIds.length ? { lotId: { in: lotIds } } : null);
  await drop('inventoryLot', lotIds.length ? { id: { in: lotIds } } : null);
  await drop('goodsReceiptNote', goodsReceiptIds.length ? { id: { in: goodsReceiptIds } } : null);
  await drop('purchaseOrderLine', purchaseOrderLineIds.length ? { id: { in: purchaseOrderLineIds } } : null);
  await drop('purchaseOrder', purchaseOrderIds.length ? { id: { in: purchaseOrderIds } } : null);
  await drop('purchaseDemand', demandIds.length ? { id: { in: demandIds } } : null);
  await drop('salesOrderLine', orderLineIds.length ? { id: { in: orderLineIds } } : null);
  await drop('dispatchJob', dispatchJobIds.length ? { id: { in: dispatchJobIds } } : null);
  await drop('salesOrder', orderIds.length ? { id: { in: orderIds } } : null);
  await drop('activity', quoteIds.length || leadIds.length ? { OR: [quoteIds.length ? { quoteId: { in: quoteIds } } : undefined, leadIds.length ? { leadId: { in: leadIds } } : undefined].filter(Boolean) } : null);
  await drop('quoteLine', quoteIds.length ? { quoteId: { in: quoteIds } } : null);
  await drop('leadIntent', quoteIds.length || leadIds.length ? { OR: [quoteIds.length ? { quoteId: { in: quoteIds } } : undefined, quoteIds.length ? { referencesQuoteId: { in: quoteIds } } : undefined, leadIds.length ? { leadId: { in: leadIds } } : undefined].filter(Boolean) } : null);
  await drop('quote', quoteIds.length ? { id: { in: quoteIds } } : null);
  await drop('followUpTask', leadIds.length ? { leadId: { in: leadIds } } : null);
  await drop('lead', leadIds.length ? { id: { in: leadIds } } : null);
  await drop('inventoryBalance', productIds.length ? { productId: { in: productIds } } : null);
  await drop('productAlias', productIds.length ? { productId: { in: productIds } } : null);
  await drop('notification', entityIds.length ? { entityId: { in: entityIds } } : null);
  await drop('auditEvent', entityIds.length ? { entityId: { in: entityIds } } : null);
  await drop('product', productIds.length ? { id: { in: productIds } } : null);
  await drop('customer', customerIds.length ? { id: { in: customerIds } } : null);

  console.log(JSON.stringify({ ok: true, matched: { products: productIds.length, customers: customerIds.length, quotes: quoteIds.length, orders: orderIds.length, purchaseOrders: purchaseOrderIds.length, lots: lotIds.length, challans: challanIds.length, returns: returnOrderIds.length }, deleted }, null, 2));
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
}).finally(async () => prisma.$disconnect());

async function safeDelete(prisma, model, where) {
  if (!prisma[model] || !where) return;
  await prisma[model].deleteMany({ where }).catch(() => null);
}

export async function cleanupE2eRecords(prisma, context = {}) {
  const productIds = [...new Set((context.productIds || []).filter(Boolean))];
  const customerIds = [...new Set((context.customerIds || []).filter(Boolean))];
  const quoteIds = [...new Set((context.quoteIds || []).filter(Boolean))];
  const leadIds = [...new Set((context.leadIds || []).filter(Boolean))];
  const brandIds = [...new Set((context.brandIds || []).filter(Boolean))];
  const explicitOrderIds = [...new Set((context.orderIds || []).filter(Boolean))];
  const quoteOrderIds = quoteIds.length
    ? (await prisma.salesOrder.findMany({ where: { quoteId: { in: quoteIds } }, select: { id: true } }).catch(() => [])).map((row) => row.id)
    : [];
  const orderIds = [...new Set([...explicitOrderIds, ...quoteOrderIds])];

  const invoiceIds = orderIds.length
    ? (await prisma.salesInvoice.findMany({ where: { salesOrderId: { in: orderIds } }, select: { id: true } }).catch(() => [])).map((row) => row.id)
    : [];
  const paymentIds = customerIds.length
    ? (await prisma.customerPayment.findMany({ where: { customerId: { in: customerIds } }, select: { id: true } }).catch(() => [])).map((row) => row.id)
    : [];
  const grnIds = productIds.length
    ? (await prisma.inventoryLot.findMany({ where: { productId: { in: productIds }, sourceType: 'manual_grn' }, select: { sourceId: true } }).catch(() => [])).map((row) => row.sourceId).filter(Boolean)
    : [];
  const lotIds = productIds.length
    ? (await prisma.inventoryLot.findMany({ where: { productId: { in: productIds } }, select: { id: true } }).catch(() => [])).map((row) => row.id)
    : [];
  const pickListIds = orderIds.length
    ? (await prisma.pickList.findMany({ where: { salesOrderId: { in: orderIds } }, select: { id: true } }).catch(() => [])).map((row) => row.id)
    : [];
  const challanIds = quoteIds.length || orderIds.length
    ? (await prisma.dispatchChallan.findMany({ where: { OR: [quoteIds.length ? { quoteId: { in: quoteIds } } : undefined, orderIds.length ? { salesOrderId: { in: orderIds } } : undefined].filter(Boolean) }, select: { id: true } }).catch(() => [])).map((row) => row.id)
    : [];
  await safeDelete(prisma, 'customerAllocation', invoiceIds.length || paymentIds.length ? { OR: [invoiceIds.length ? { salesInvoiceId: { in: invoiceIds } } : undefined, paymentIds.length ? { sourceType: 'CustomerPayment', sourceId: { in: paymentIds } } : undefined].filter(Boolean) } : null);
  await safeDelete(prisma, 'salesInvoiceLine', invoiceIds.length ? { salesInvoiceId: { in: invoiceIds } } : null);
  await safeDelete(prisma, 'customerLedgerEntry', customerIds.length ? { customerId: { in: customerIds } } : null);
  await safeDelete(prisma, 'collectionTask', customerIds.length ? { customerId: { in: customerIds } } : null);
  await safeDelete(prisma, 'customerPayment', paymentIds.length ? { id: { in: paymentIds } } : null);
  await safeDelete(prisma, 'salesInvoice', invoiceIds.length ? { id: { in: invoiceIds } } : null);
  await safeDelete(prisma, 'customerCreditProfile', customerIds.length ? { customerId: { in: customerIds } } : null);
  await safeDelete(prisma, 'deliveryProof', challanIds.length ? { challanId: { in: challanIds } } : null);
  await safeDelete(prisma, 'shipment', challanIds.length ? { challanId: { in: challanIds } } : null);
  await safeDelete(prisma, 'dispatchPackage', challanIds.length ? { challanId: { in: challanIds } } : null);
  await safeDelete(prisma, 'dispatchLine', challanIds.length ? { challanId: { in: challanIds } } : null);
  await safeDelete(prisma, 'pickLine', pickListIds.length ? { pickListId: { in: pickListIds } } : null);
  await safeDelete(prisma, 'pickList', pickListIds.length ? { id: { in: pickListIds } } : null);
  await safeDelete(prisma, 'dispatchChallan', challanIds.length ? { id: { in: challanIds } } : null);
  await safeDelete(prisma, 'documentJob', { OR: [quoteIds.length ? { entityId: { in: quoteIds } } : undefined, orderIds.length ? { entityId: { in: orderIds } } : undefined].filter(Boolean) });
  await safeDelete(prisma, 'paymentReceipt', orderIds.length ? { salesOrderId: { in: orderIds } } : null);
  await safeDelete(prisma, 'purchaseDemand', quoteIds.length || orderIds.length ? { OR: [quoteIds.length ? { sourceQuoteId: { in: quoteIds } } : undefined, orderIds.length ? { sourceOrderId: { in: orderIds } } : undefined].filter(Boolean) } : null);
  await safeDelete(prisma, 'dispatchJob', quoteIds.length || orderIds.length ? { OR: [quoteIds.length ? { quoteId: { in: quoteIds } } : undefined, orderIds.length ? { salesOrderId: { in: orderIds } } : undefined].filter(Boolean) } : null);
  await safeDelete(prisma, 'lotReservation', orderIds.length ? { reservation: { salesOrderId: { in: orderIds } } } : null);
  await safeDelete(prisma, 'reservation', quoteIds.length || orderIds.length ? { OR: [quoteIds.length ? { quoteId: { in: quoteIds } } : undefined, orderIds.length ? { salesOrderId: { in: orderIds } } : undefined].filter(Boolean) } : null);
  await safeDelete(prisma, 'salesOrderLine', orderIds.length ? { salesOrderId: { in: orderIds } } : null);
  await safeDelete(prisma, 'salesOrder', orderIds.length ? { id: { in: orderIds } } : null);
  await safeDelete(prisma, 'activity', quoteIds.length || leadIds.length ? { OR: [quoteIds.length ? { quoteId: { in: quoteIds } } : undefined, leadIds.length ? { leadId: { in: leadIds } } : undefined].filter(Boolean) } : null);
  await safeDelete(prisma, 'quoteLine', quoteIds.length ? { quoteId: { in: quoteIds } } : null);
  await safeDelete(prisma, 'leadIntent', quoteIds.length || leadIds.length ? { OR: [quoteIds.length ? { quoteId: { in: quoteIds } } : undefined, quoteIds.length ? { referencesQuoteId: { in: quoteIds } } : undefined, leadIds.length ? { leadId: { in: leadIds } } : undefined].filter(Boolean) } : null);
  await safeDelete(prisma, 'quote', quoteIds.length ? { id: { in: quoteIds } } : null);
  await safeDelete(prisma, 'followUpTask', leadIds.length ? { leadId: { in: leadIds } } : null);
  await safeDelete(prisma, 'lead', leadIds.length ? { id: { in: leadIds } } : null);
  await safeDelete(prisma, 'notification', { OR: [...quoteIds, ...orderIds, ...productIds, ...customerIds].map((id) => ({ entityId: id })) });
  await safeDelete(prisma, 'auditEvent', { entityId: { in: [...quoteIds, ...orderIds, ...productIds, ...customerIds, ...brandIds] } });
  await safeDelete(prisma, 'inventoryLotLedgerEntry', lotIds.length ? { lotId: { in: lotIds } } : null);
  await safeDelete(prisma, 'stockLedgerEntry', productIds.length ? { productId: { in: productIds } } : null);
  await safeDelete(prisma, 'inventoryBalance', productIds.length ? { productId: { in: productIds } } : null);
  await safeDelete(prisma, 'inventoryLot', lotIds.length ? { id: { in: lotIds } } : null);
  await safeDelete(prisma, 'goodsReceiptLine', grnIds.length ? { goodsReceiptNoteId: { in: grnIds } } : null);
  await safeDelete(prisma, 'goodsReceiptNote', grnIds.length ? { id: { in: grnIds } } : null);
  await safeDelete(prisma, 'productAlias', productIds.length ? { productId: { in: productIds } } : null);
  await safeDelete(prisma, 'product', productIds.length ? { id: { in: productIds } } : null);
  await safeDelete(prisma, 'customer', customerIds.length ? { id: { in: customerIds } } : null);
  await safeDelete(prisma, 'productBrand', brandIds.length ? { id: { in: brandIds } } : null);
}

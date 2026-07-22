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
  const orderIds = quoteIds.length
    ? (await prisma.salesOrder.findMany({ where: { quoteId: { in: quoteIds } }, select: { id: true } }).catch(() => [])).map((row) => row.id)
    : [];

  await safeDelete(prisma, 'dispatchChallan', quoteIds.length ? { quoteId: { in: quoteIds } } : null);
  await safeDelete(prisma, 'documentJob', { OR: [quoteIds.length ? { entityId: { in: quoteIds } } : undefined, orderIds.length ? { entityId: { in: orderIds } } : undefined].filter(Boolean) });
  await safeDelete(prisma, 'paymentReceipt', orderIds.length ? { salesOrderId: { in: orderIds } } : null);
  await safeDelete(prisma, 'purchaseDemand', quoteIds.length || orderIds.length ? { OR: [quoteIds.length ? { sourceQuoteId: { in: quoteIds } } : undefined, orderIds.length ? { sourceOrderId: { in: orderIds } } : undefined].filter(Boolean) } : null);
  await safeDelete(prisma, 'dispatchJob', quoteIds.length ? { quoteId: { in: quoteIds } } : null);
  await safeDelete(prisma, 'lotReservation', orderIds.length ? { reservation: { salesOrderId: { in: orderIds } } } : null);
  await safeDelete(prisma, 'reservation', quoteIds.length ? { quoteId: { in: quoteIds } } : null);
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
  await safeDelete(prisma, 'inventoryBalance', productIds.length ? { productId: { in: productIds } } : null);
  await safeDelete(prisma, 'productAlias', productIds.length ? { productId: { in: productIds } } : null);
  await safeDelete(prisma, 'product', productIds.length ? { id: { in: productIds } } : null);
  await safeDelete(prisma, 'customer', customerIds.length ? { id: { in: customerIds } } : null);
  await safeDelete(prisma, 'productBrand', brandIds.length ? { id: { in: brandIds } } : null);
}

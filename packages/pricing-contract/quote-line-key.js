/**
 * The one key for a quote line, used by the API (quote lines, order lines,
 * reservations) and by the quote screen to look up what is already ordered.
 * A product appears once per room, so product + room identifies the line.
 */
function quoteLineKey(line, index) {
  const productId = String((line && line.productId) || '').trim();
  const tileCode = String((line && (line.tileCode || line.sku)) || '').trim();
  const area = String((line && (line.area || line.room || line.section)) || '').trim();
  return productId ? `product:${productId}:${area || index}` : `tile:${tileCode || index}:${area || index}`;
}

module.exports = { quoteLineKey };

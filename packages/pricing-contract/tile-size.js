/** Physical face dimensions only: never pack quantity, finish or description. */
function compactTileSize(product) {
  if (String(product?.category || '').trim().toLowerCase() !== 'tiles') return '';
  const master = product.tileSizeMaster || {};
  for (const value of [product.tileSize, master.name, product.dimensions]) {
    const match = String(value || '').match(/(\d+(?:\.\d+)?)\s*[x×X*]\s*(\d+(?:\.\d+)?)(?:\s*(mm|cm|inches|inch|in|ft|["′″']))?/i);
    if (match) return `${match[1]} x ${match[2]}${match[3] ? ` ${match[3].toLowerCase()}` : ''}`;
  }
  if (Number(master.widthMm) > 0 && Number(master.heightMm) > 0) return `${Number(master.widthMm)} x ${Number(master.heightMm)} mm`;
  return '';
}

module.exports = { compactTileSize };

'use strict';

// Display grouping only: never rewrite stored section names or merge distinct rooms.
function groupQuoteLines(lines) {
  const groups = new Map();
  for (const line of lines) {
    const area = String(line.area || line.room || line.section || 'General Selection').trim().replace(/\s+/g, ' ') || 'General Selection';
    const key = area.toLocaleLowerCase('en-IN');
    if (!groups.has(key)) groups.set(key, { area, rows: [] });
    groups.get(key).rows.push(line);
  }
  return [...groups.values()];
}

function requestedQuantityLabel(line) {
  const area = Number(line.requestedArea || 0);
  const pieces = Number(line.requestedPieces || 0);
  const unit = String(line.pricingUom || 'SQFT').toUpperCase();
  if (area > 0) return `Requested: ${area} ${unit}`;
  if (pieces > 0) return `Requested: ${pieces} PC`;
  return '';
}

module.exports = { groupQuoteLines, requestedQuantityLabel };

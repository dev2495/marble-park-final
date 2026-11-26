'use strict';

/**
 * How a tile quantity reads on dispatch documents, order screens and quotes.
 * Stock, picks and dispatch lines count pieces (the base unit); a tile reads
 * as boxes with the piece count kept beside it so the warehouse can still count:
 *   sold by the box, 380 pc at 10 a box -> "38 Box" (380 pc); 344 pc at 9 -> "39 Box" (never a part box)
 *   sold by the piece, 344 pc at 9 a box -> "38 Box + 2 pc"; 5 pc -> "5 pc"
 * Anything that is not a boxed tile reads exactly as before.
 * Presentation only: never use this to post, reserve or price stock.
 * The API's stockFactor (apps/api/src/modules/common/stock-units.ts) uses boxFactor.
 */

const PACK_UNITS = ['BOX', 'PACK', 'CARTON'];

/** Pieces in one selling unit for a boxed tile (base unit PC, sold by BOX/PACK/CARTON), else 1. */
function boxFactor(product) {
  if (!product) return 1;
  const base = String(product.baseUom || 'PC').trim().toUpperCase();
  const selling = String(product.unit || product.salesUom || product.purchaseUom || base).trim().toUpperCase();
  if (base !== 'PC' || !PACK_UNITS.includes(selling)) return 1;
  return Math.max(1, Math.trunc(Number(product.piecesPerPack || 1)));
}

const PIECE_UNITS = ['PC', 'PCS', 'PIECE', 'NOS'];

/**
 * How a product is sold, from Product Master: the selling unit `unit` (falling
 * back to salesUom, then purchaseUom) with base unit PC and piecesPerPack.
 *   'BOX'   sold by the box (unit BOX/PACK/CARTON, N > 1 pieces a box): whole boxes only.
 *   'PIECE' a tile sold by the piece (unit PC) that still comes N > 1 a box: single tiles may be sold.
 *   null    anything else (reads as its own unit, unchanged).
 */
function tileSoldBy(product) {
  if (!product) return null;
  if (boxFactor(product) > 1) return 'BOX';
  const base = String(product.baseUom || 'PC').trim().toUpperCase();
  const selling = String(product.unit || product.salesUom || product.purchaseUom || base).trim().toUpperCase();
  const isTile = String(product.category || '').trim().toLowerCase() === 'tiles';
  const perBox = Math.trunc(Number(product.piecesPerPack || 1));
  return isTile && base === 'PC' && PIECE_UNITS.includes(selling) && perBox > 1 ? 'PIECE' : null;
}

/** What a line needs to read in boxes later: { piecesPerBox, soldBy } (piecesPerBox 1, soldBy null when not a boxed tile). */
function boxReading(product) {
  const soldBy = tileSoldBy(product);
  return { piecesPerBox: soldBy ? Math.max(1, Math.trunc(Number(product.piecesPerPack || 1))) : 1, soldBy };
}

// factor: pieces per selling unit (stock conversion, > 1 only for box-sold);
// perBox / soldBy: how the quantity reads. Takes a number (pieces per box of a
// box-sold tile), a dispatch/order line { piecesPerUnit, unit, orderUnit,
// piecesPerBox?, soldBy? }, or a product.
function resolveUnits(unitInfo) {
  if (typeof unitInfo === 'number') {
    const factor = Math.max(1, Math.trunc(unitInfo || 1));
    return { factor, perBox: factor, soldBy: factor > 1 ? 'BOX' : null, selling: 'BOX', base: 'PC' };
  }
  const info = unitInfo || {};
  if (info.piecesPerUnit != null && info.piecesPerPack == null) {
    const factor = Math.max(1, Math.trunc(Number(info.piecesPerUnit) || 1));
    const base = factor > 1 ? 'PC' : String(info.unit || 'PC').trim().toUpperCase();
    if (factor > 1) {
      const selling = String(info.orderUnit || info.sellingUnit || 'BOX').trim().toUpperCase();
      return { factor, perBox: factor, soldBy: 'BOX', selling: PACK_UNITS.includes(selling) ? selling : 'BOX', base };
    }
    const perBox = Math.trunc(Number(info.piecesPerBox || 1));
    if (String(info.soldBy || '').toUpperCase() === 'PIECE' && perBox > 1) return { factor: 1, perBox, soldBy: 'PIECE', selling: 'BOX', base: 'PC' };
    return { factor: 1, perBox: 1, soldBy: null, selling: base, base };
  }
  const factor = boxFactor(info);
  const soldBy = tileSoldBy(info);
  const base = String(info.baseUom || (factor > 1 ? 'PC' : info.unit) || 'PC').trim().toUpperCase();
  const selling = String(info.unit || info.salesUom || info.purchaseUom || base).trim().toUpperCase();
  if (soldBy === 'BOX') return { factor, perBox: factor, soldBy, selling, base };
  if (soldBy === 'PIECE') return { factor: 1, perBox: Math.trunc(Number(info.piecesPerPack)), soldBy, selling: 'BOX', base: 'PC' };
  return { factor: 1, perBox: 1, soldBy: null, selling, base };
}

function tidy(value) {
  return Number(Number(value || 0).toFixed(3));
}

function unitWord(code) {
  const text = String(code || '').toLowerCase();
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : '';
}

/** Whole boxes for a box-sold tile, rounded up (344 pc at 9 a box is 39 boxes). Same rule as toSellingQtyCeil in the API. */
function wholeBoxesUp(pieces, perBox) {
  return Math.max(0, Math.ceil(Math.max(0, Number(pieces || 0)) / Math.max(1, perBox) - 1e-9));
}

/**
 * A base quantity (pieces) for reading.
 * Returns { isBoxed, soldBy, boxes, loosePieces, partBox, pieces, piecesPerBox, label, unitLabel, piecesLabel, fullLabel }.
 * Tile sold by the BOX: always whole boxes, rounded up: 344 pc at 9 -> "39 Box" (partBox true).
 * Tile sold by the PIECE (N a box): "38 Box + 2 pc", under one box "5 pc".
 * Both keep piecesLabel "344 pc". Otherwise: boxes is the quantity itself, label "5 PC", piecesLabel "".
 */
function formatBoxQuantity(baseQty, unitInfo) {
  const { perBox, soldBy, selling, base } = resolveUnits(unitInfo);
  const quantity = Math.max(0, tidy(baseQty));
  if (!soldBy || perBox <= 1) {
    const unit = base || 'PC';
    return { isBoxed: false, soldBy: null, boxes: quantity, loosePieces: 0, partBox: false, pieces: quantity, piecesPerBox: 1, label: `${quantity} ${unit}`, unitLabel: unit, piecesLabel: '', fullLabel: `${quantity} ${unit}` };
  }
  const pieces = Math.round(quantity);
  const word = unitWord(selling);
  const piecesLabel = `${pieces} pc`;
  if (soldBy === 'BOX') {
    const boxes = wholeBoxesUp(pieces, perBox);
    const label = `${boxes} ${word}`;
    return { isBoxed: true, soldBy, boxes, loosePieces: 0, partBox: pieces % perBox !== 0, pieces, piecesPerBox: perBox, label, unitLabel: selling, piecesLabel, fullLabel: `${label} (${piecesLabel})` };
  }
  const boxes = Math.floor(pieces / perBox);
  const loosePieces = pieces - boxes * perBox;
  const label = boxes > 0 || !loosePieces
    ? `${boxes} ${word}${loosePieces ? ` + ${loosePieces} pc` : ''}`
    : `${loosePieces} pc`;
  return { isBoxed: true, soldBy, boxes, loosePieces, partBox: false, pieces, piecesPerBox: perBox, label, unitLabel: 'BOX', piecesLabel, fullLabel: `${label} (${piecesLabel})` };
}

/** A selling-unit quantity (boxes for a box-sold tile, pieces for a piece-sold one) for reading: same shape as formatBoxQuantity. */
function formatSellingQuantity(sellingQty, unitInfo) {
  const { factor, soldBy, base } = resolveUnits(unitInfo);
  if (soldBy === 'BOX') return formatBoxQuantity(Math.round(Math.max(0, Number(sellingQty || 0)) * factor), unitInfo);
  if (soldBy === 'PIECE') return formatBoxQuantity(sellingQty, unitInfo);
  const quantity = Math.max(0, tidy(sellingQty));
  const unit = (unitInfo && typeof unitInfo === 'object' && (unitInfo.unit || unitInfo.orderUnit)) ? String(unitInfo.orderUnit || unitInfo.unit).toUpperCase() : (base || 'PC');
  return { isBoxed: false, soldBy: null, boxes: quantity, loosePieces: 0, partBox: false, pieces: quantity, piecesPerBox: 1, label: `${quantity} ${unit}`, unitLabel: unit, piecesLabel: '', fullLabel: `${quantity} ${unit}` };
}

/**
 * The full-box rule for a tile sold by the box, checked per ORDER LINE (one
 * rule for the API and the pick/pack screens). totalPieces is that order line's
 * pieces added across its lot rows in one save; systemPieces is everything the
 * system holds or offers for that line on the same rows (reserved, picked or
 * packed). Refused when the total is not whole boxes and is not that whole
 * amount, so a part box the reservation itself holds can still leave as the
 * final remainder. A single lot row may hold any piece count. Piece-sold tiles
 * and anything that is not a boxed tile are never refused.
 */
function refusesPartBox(totalPieces, systemPieces, unitInfo) {
  const { perBox, soldBy } = resolveUnits(unitInfo);
  const total = Math.max(0, Number(totalPieces || 0));
  if (soldBy !== 'BOX' || perBox <= 1 || total <= 0) return false;
  return total % perBox !== 0 && total !== Number(systemPieces || 0);
}

module.exports = { boxFactor, tileSoldBy, boxReading, wholeBoxesUp, formatBoxQuantity, formatSellingQuantity, refusesPartBox };

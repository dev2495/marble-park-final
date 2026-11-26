import { stockFactor, toBaseQty, toSellingQtyFloor, toSellingQtyCeil, describeBaseQty } from '../../src/modules/common/stock-units';

const boxedTile = { baseUom: 'PC', unit: 'BOX', piecesPerPack: 10 };

describe('stockFactor', () => {
  it('is pieces per box for a tile stocked in pieces and sold by the box', () => {
    expect(stockFactor(boxedTile)).toBe(10);
    expect(stockFactor({ baseUom: 'pc', unit: 'carton', piecesPerPack: 6 })).toBe(6);
    expect(stockFactor({ baseUom: 'PC', salesUom: 'PACK', piecesPerPack: 4 })).toBe(4);
  });
  it('is 1 for everything else', () => {
    expect(stockFactor(null)).toBe(1);
    expect(stockFactor({ baseUom: 'PC', unit: 'PC', piecesPerPack: 10 })).toBe(1);
    expect(stockFactor({ baseUom: 'SQFT', unit: 'BOX', piecesPerPack: 10 })).toBe(1);
    expect(stockFactor({ baseUom: 'PC', unit: 'BOX' })).toBe(1);
  });
  it('never goes below 1 and truncates fractions', () => {
    expect(stockFactor({ baseUom: 'PC', unit: 'BOX', piecesPerPack: 0 })).toBe(1);
    expect(stockFactor({ baseUom: 'PC', unit: 'BOX', piecesPerPack: -3 })).toBe(1);
    expect(stockFactor({ baseUom: 'PC', unit: 'BOX', piecesPerPack: 7.9 })).toBe(7);
  });
});

describe('toBaseQty', () => {
  it('38 boxes of 10 is 380 pieces', () => expect(toBaseQty(boxedTile, 38)).toBe(380));
  it('whole pieces only, never negative', () => {
    expect(toBaseQty(boxedTile, 0.25)).toBe(3); // 2.5 rounds to 3
    expect(toBaseQty(boxedTile, -2)).toBe(0);
    expect(toBaseQty(boxedTile, undefined)).toBe(0);
  });
  it('non-boxed products are unchanged', () => expect(toBaseQty({ baseUom: 'PC', unit: 'PC' }, 5)).toBe(5));
});

describe('toSellingQtyFloor / Ceil', () => {
  it('15 pieces at 10 per box is 1 full box, 2 boxes to cover', () => {
    expect(toSellingQtyFloor(boxedTile, 15)).toBe(1);
    expect(toSellingQtyCeil(boxedTile, 15)).toBe(2);
  });
  it('exact multiples are not bumped by float noise', () => {
    expect(toSellingQtyFloor(boxedTile, 30)).toBe(3);
    expect(toSellingQtyCeil(boxedTile, 30)).toBe(3);
  });
  it('zero and negative give zero', () => {
    expect(toSellingQtyFloor(boxedTile, -5)).toBe(0);
    expect(toSellingQtyCeil(boxedTile, 0) + 0).toBe(0);
  });
  it('round trip: boxes to pieces and back', () => {
    for (const boxes of [0, 1, 7, 38, 120]) expect(toSellingQtyFloor(boxedTile, toBaseQty(boxedTile, boxes))).toBe(boxes);
  });
});

describe('describeBaseQty', () => {
  it('shows boxes and loose pieces for a boxed tile', () => {
    expect(describeBaseQty(boxedTile, 380)).toBe('38 BOX (380 PC)');
    expect(describeBaseQty(boxedTile, 385)).toBe('38 BOX + 5 PC (385 PC)');
  });
  it('plain units otherwise', () => {
    expect(describeBaseQty({ baseUom: 'PC', unit: 'PC' }, 5)).toBe('5 PC');
    expect(describeBaseQty(null, 2)).toBe('2 PC');
  });
});

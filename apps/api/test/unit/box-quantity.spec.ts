import { boxQuantity, boxQuantityFromSelling, stockFactor, toSellingQtyCeil } from '../../src/modules/common/stock-units';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const shared = require('@marble-park/pricing-contract/box-quantity');

const tile10 = { baseUom: 'PC', unit: 'BOX', piecesPerPack: 10 };
const tile9 = { baseUom: 'PC', unit: 'BOX', piecesPerPack: 9 };

describe('tile quantities read in boxes (shared formatter)', () => {
  it('the client slip: 380, 100, 342 and 9 pieces read 38, 10, 38 and 1 boxes', () => {
    expect(boxQuantity(tile10, 380)).toMatchObject({ isBoxed: true, boxes: 38, loosePieces: 0, piecesPerBox: 10, label: '38 Box', unitLabel: 'BOX', piecesLabel: '380 pc' });
    expect(boxQuantity(tile10, 100).label).toBe('10 Box');
    expect(boxQuantity(tile9, 342)).toMatchObject({ boxes: 38, loosePieces: 0, label: '38 Box', piecesLabel: '342 pc' });
    expect(boxQuantity(tile9, 9)).toMatchObject({ boxes: 1, loosePieces: 0, label: '1 Box', piecesLabel: '9 pc' });
  });
  it('a tile sold by the BOX is always whole boxes, rounded up', () => {
    expect(boxQuantity(tile9, 342)).toMatchObject({ soldBy: 'BOX', boxes: 38, partBox: false, label: '38 Box' });
    expect(boxQuantity(tile9, 344)).toMatchObject({ soldBy: 'BOX', boxes: 39, loosePieces: 0, partBox: true, label: '39 Box', fullLabel: '39 Box (344 pc)' });
    expect(boxQuantity(tile9, 9).label).toBe('1 Box');
    expect(boxQuantity(tile9, 1)).toMatchObject({ boxes: 1, partBox: true, label: '1 Box', piecesLabel: '1 pc' });
    // The count is the API's ceil helper, and the shared formatter agrees.
    for (const pieces of [0, 1, 8, 9, 10, 342, 344, 350]) {
      const ceil = Math.max(0, toSellingQtyCeil(tile9, pieces)); // the helper gives -0 for 0
      expect(boxQuantity(tile9, pieces).boxes).toBe(ceil);
      expect(shared.formatBoxQuantity(pieces, tile9).boxes).toBe(ceil);
    }
    expect(boxQuantityFromSelling(tile9, 344 / 9).label).toBe('39 Box');
  });
  it('a tile sold by the PIECE (9 a box) shows a broken box as loose pieces', () => {
    const pieceTile = { category: 'Tiles', baseUom: 'PC', unit: 'PC', salesUom: 'PC', purchaseUom: 'PC', piecesPerPack: 9 };
    expect(boxQuantity(pieceTile, 344)).toMatchObject({ soldBy: 'PIECE', boxes: 38, loosePieces: 2, label: '38 Box + 2 pc', fullLabel: '38 Box + 2 pc (344 pc)', unitLabel: 'BOX' });
    expect(boxQuantity(pieceTile, 5)).toMatchObject({ boxes: 0, loosePieces: 5, label: '5 pc' });
    expect(boxQuantity(pieceTile, 342).label).toBe('38 Box');
    // Orders of a piece-sold tile count pieces: the selling quantity is the piece count.
    expect(boxQuantityFromSelling(pieceTile, 344).label).toBe('38 Box + 2 pc');
    // Dispatch and order lines carry { piecesPerBox, soldBy } for it.
    expect(shared.formatBoxQuantity(344, { unit: 'PC', piecesPerUnit: 1, piecesPerBox: 9, soldBy: 'PIECE' }).label).toBe('38 Box + 2 pc');
    // Not a tile: a faucet in a pack of 2 sold by the piece stays as it is.
    expect(boxQuantity({ category: 'Faucets', baseUom: 'PC', unit: 'PC', piecesPerPack: 2 }, 5).label).toBe('5 PC');
  });
  it('zero', () => {
    expect(boxQuantity(tile10, 0)).toMatchObject({ boxes: 0, loosePieces: 0, label: '0 Box', piecesLabel: '0 pc' });
    expect(boxQuantity(tile10, undefined).label).toBe('0 Box');
    expect(boxQuantity({ baseUom: 'PC', unit: 'PC' }, 0).label).toBe('0 PC');
  });
  it('anything that is not a boxed tile is unchanged', () => {
    expect(boxQuantity({ baseUom: 'PC', unit: 'PC', piecesPerPack: 10 }, 5)).toMatchObject({ isBoxed: false, boxes: 5, loosePieces: 0, piecesPerBox: 1, label: '5 PC', unitLabel: 'PC', piecesLabel: '' });
    expect(boxQuantity({ baseUom: 'KG', unit: 'KG' }, 2.5).label).toBe('2.5 KG');
    expect(boxQuantity(null, 3).label).toBe('3 PC');
  });
  it('order lines count boxes: a selling quantity reads the same way', () => {
    expect(boxQuantityFromSelling(tile10, 38).label).toBe('38 Box');
    expect(boxQuantityFromSelling(tile9, 38).label).toBe('38 Box');
    expect(boxQuantityFromSelling({ baseUom: 'PC', unit: 'NOS' }, 4).label).toBe('4 NOS');
  });
  it('dispatch and challan lines carry the factor instead of the product', () => {
    expect(shared.formatBoxQuantity(380, { unit: 'PC', orderUnit: 'BOX', piecesPerUnit: 10 }).label).toBe('38 Box');
    expect(shared.formatBoxQuantity(7, { unit: 'PC', orderUnit: 'PC', piecesPerUnit: 1 }).label).toBe('7 PC');
    expect(shared.formatBoxQuantity(342, 9).label).toBe('38 Box');
    // Old challan lines without the factor read exactly as stored.
    expect(shared.formatBoxQuantity(38, { unit: 'BOX' }).label).toBe('38 BOX');
  });
  it('the API factor and the shared factor are one rule', () => {
    for (const product of [tile10, tile9, { baseUom: 'PC', unit: 'PC', piecesPerPack: 10 }, { baseUom: 'SQFT', unit: 'BOX', piecesPerPack: 10 }, { baseUom: 'PC', salesUom: 'PACK', piecesPerPack: 4 }, null]) {
      expect(stockFactor(product)).toBe(shared.boxFactor(product));
    }
  });
});

export type BoxUnitInfo = number | null | undefined | {
  baseUom?: unknown; unit?: unknown; salesUom?: unknown; purchaseUom?: unknown; piecesPerPack?: unknown;
  piecesPerUnit?: unknown; orderUnit?: unknown; sellingUnit?: unknown; piecesPerBox?: unknown; soldBy?: unknown; category?: unknown;
};
export type TileSoldBy = 'BOX' | 'PIECE' | null;
export type BoxQuantity = {
  isBoxed: boolean; soldBy: TileSoldBy; boxes: number; loosePieces: number; partBox: boolean; pieces: number; piecesPerBox: number;
  label: string; unitLabel: string; piecesLabel: string; fullLabel: string;
};
export function boxFactor(product: Record<string, any> | null | undefined): number;
export function tileSoldBy(product: Record<string, any> | null | undefined): TileSoldBy;
export function boxReading(product: Record<string, any> | null | undefined): { piecesPerBox: number; soldBy: TileSoldBy };
export function wholeBoxesUp(pieces: unknown, perBox: number): number;
export function formatBoxQuantity(baseQty: unknown, unitInfo: BoxUnitInfo | Record<string, any>): BoxQuantity;
export function formatSellingQuantity(sellingQty: unknown, unitInfo: BoxUnitInfo | Record<string, any>): BoxQuantity;

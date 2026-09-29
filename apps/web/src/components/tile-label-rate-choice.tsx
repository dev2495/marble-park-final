"use client";

import { SQM_PER_SQFT, tilePriceUom, type TilePriceUom } from "@/lib/tile-rate";

export type TileLabelPriceUom = TilePriceUom;

export function isTileProduct(product: any) {
  return String(product?.category || "").trim().toLowerCase() === "tiles";
}

export function defaultPriceUomOf(product: any): TileLabelPriceUom {
  return tilePriceUom(
    product?.priceUom ||
      (String(product?.priceRateBasis || "").toUpperCase() === "PIECE"
        ? "PC"
        : "SQFT"),
  );
}

export function tileLabelRateReady(product: any, unit: TileLabelPriceUom = defaultPriceUomOf(product)) {
  return previewRate(product, unit) !== null;
}

function canConvert(product: any) {
  return (
    Number(product?.coveragePerPack) > 0 &&
    Number.isInteger(Number(product?.piecesPerPack)) &&
    Number(product?.piecesPerPack) > 0
  );
}

export function previewRate(product: any, unit: TileLabelPriceUom) {
  const rate = Number(product?.defaultMrpInclusive);
  if (!Number.isFinite(rate) || rate <= 0) return null;
  const source = defaultPriceUomOf(product);
  if (source === unit) return Number(rate.toFixed(2));
  if (!canConvert(product)) return null;
  const pieces = Number(product.piecesPerPack);
  const areaSqFt = Number(product.coveragePerPack);
  const unitsPerPack = (value: TileLabelPriceUom) =>
    value === "PC" ? pieces : value === "SQM" ? areaSqFt * SQM_PER_SQFT : areaSqFt;
  const amount = Number((rate * unitsPerPack(source) / unitsPerPack(unit)).toFixed(2));
  return amount > 0 ? amount : null;
}

export function TileLabelRateChoice({
  product,
  value,
  onChange,
  id,
}: {
  product: any;
  value: TileLabelPriceUom;
  onChange: (value: TileLabelPriceUom) => void;
  id: string;
}) {
  if (!isTileProduct(product)) return null;
  const masterRate = Number(product?.defaultMrpInclusive);
  const masterUnit = defaultPriceUomOf(product);
  const hasCoverage = canConvert(product);
  const amount = previewRate(product, value);
  const format = (rate: number) =>
    `₹${rate.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  return (
    <label className="mt-3 block rounded-xl border border-[#eadbd5] bg-[#fff8f4] p-3 text-xs font-semibold text-[var(--ink-3)]">
      Rate unit on new tile labels
      <select
        data-testid={id}
        value={value}
        onChange={(event) => onChange(event.target.value as TileLabelPriceUom)}
        className="mt-1.5 h-11 w-full rounded-md border border-[var(--line)] bg-white px-3 text-sm font-bold text-[var(--ink)]"
      >
        <option value="PC" disabled={!hasCoverage && masterUnit !== "PC"}>Per piece (PC)</option>
        <option value="SQM" disabled={!hasCoverage && masterUnit !== "SQM"}>Per square metre (SQM)</option>
        <option value="SQFT" disabled={!hasCoverage && masterUnit !== "SQFT"}>Per square foot (SQFT)</option>
      </select>
      <small className="mt-2 block font-normal leading-5 text-[var(--ink-4)]">
        Product Master MRP: {Number.isFinite(masterRate) && masterRate > 0 ? `${format(masterRate)} / ${masterUnit}` : "rate pending"}.
        {amount !== null ? ` Label preview: ${format(amount)} / ${value}.` : " The selected rate cannot be printed; review MRP and tile coverage."}
        {!hasCoverage ? " Complete pieces and area per pack in Tile Master to enable other rate units." : " The server will save this rate on each label for stable reprints."}
      </small>
    </label>
  );
}

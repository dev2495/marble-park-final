import { cache } from 'react';

// Server-side only: customer pages read the API over the internal network.
const API_URL = process.env.QUOTE_PDF_API_URL || process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/graphql';

export type Showroom = {
  companyName: string;
  logoUrl: string;
  address: string;
  phone: string;
  whatsapp: string;
  email: string;
  website: string;
  tagline: string;
};

export type PublicPrice = { amount: number; mrp: number | null; label: string; unit: string } | null;

export type PublicProductCard = {
  token: string;
  name: string;
  brand: string;
  category: string;
  finish: string;
  size: string;
  code: string;
  thumbnail: string;
  price: PublicPrice;
  isTile: boolean;
  relation?: 'design' | 'brand' | 'category';
};

export type PublicProductDetail = PublicProductCard & {
  photos: string[];
  description: string;
  design: { name: string; collection: string; material: string; surface: string; colour: string; pattern: string; usage: string[]; origin: string } | null;
  specs: Array<[string, string]>;
};

async function publicQuery<T>(query: string, variables: Record<string, unknown>, field: string): Promise<T | null> {
  try {
    const response = await fetch(API_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query, variables }),
      cache: 'no-store',
    });
    if (!response.ok) return null;
    const body = await response.json();
    return (body?.data?.[field] ?? null) as T | null;
  } catch {
    return null;
  }
}

// cache() keeps generateMetadata and the page to one API call (and one view count) per request.
export const getPublicProduct = cache((token: string) => publicQuery<{
  enabled: boolean;
  showroom: Showroom;
  url?: string;
  product: PublicProductDetail | null;
  similar: PublicProductCard[];
}>('query PublicProduct($token:String!){publicCatalogueProduct(token:$token)}', { token }, 'publicCatalogueProduct'));

export const getPublicShare = cache((token: string) => publicQuery<{
  enabled: boolean;
  showroom: Showroom;
  status?: 'active' | 'expired' | 'not_found';
  share: { title: string; note: string; expiresAt: string; sharedBy: string } | null;
  products: PublicProductCard[];
}>('query PublicShare($token:String!){publicCatalogueShare(token:$token)}', { token }, 'publicCatalogueShare'));

export const getPublicShowroom = cache(() => publicQuery<{ enabled: boolean; showroom: Showroom }>(
  'query PublicShowroom{publicShowroom}', {}, 'publicShowroom',
));

export function rupees(amount: number) {
  return `₹${Number(amount).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
}

/** Managed uploads live on the API host; everything else is same-origin. */
export function publicImage(url: string) {
  if (!url) return '';
  return url.startsWith('/catalogue-images/manual/') ? `${process.env.NEXT_PUBLIC_CATALOGUE_IMAGE_ORIGIN || ''}${url}` : url;
}

export function firstPhone(phone: string) {
  return String(phone || '').split(/[·,/|;]+/).map((part) => part.trim()).find((part) => part.replace(/\D/g, '').length >= 10) || '';
}

export function whatsappLink(number: string, text: string) {
  return number ? `https://wa.me/${number}?text=${encodeURIComponent(text)}` : '';
}

export const SHARE_TOKEN = /^[0-9A-Z]{24}$/;

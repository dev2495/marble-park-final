import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Readable text for a stored status code: "challan_created" becomes "Challan created". */
export function statusLabel(value: unknown): string {
  const text = String(value ?? '').trim().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ');
  return text ? text.charAt(0).toUpperCase() + text.slice(1).toLowerCase() : '';
}
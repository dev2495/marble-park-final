// How a customer or quote is named on screen so two people with the same name
// are never confused: the phone (last 4 digits) travels with the name.

/** Last 10 digits of a phone, or '' when shorter. Same rule as the API. */
export function mobileKey(input: unknown) {
  const digits = String(input ?? '').replace(/\D/g, '');
  return digits.length >= 10 ? digits.slice(-10) : '';
}

/** "••2345" */
export function maskedMobile(input: unknown) {
  const digits = String(input ?? '').replace(/\D/g, '');
  return digits.length >= 4 ? `••${digits.slice(-4)}` : '';
}

/** "Amita Khairo · ••5678" */
export function customerTag(customer: { name?: string | null; mobile?: string | null; phone?: string | null } | null | undefined) {
  if (!customer) return '';
  return [customer.name, maskedMobile(customer.mobile || customer.phone)].filter(Boolean).join(' · ');
}

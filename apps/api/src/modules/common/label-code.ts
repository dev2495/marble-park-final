/**
 * Reads the label code out of anything a scanner can hand back from a printed
 * sticker: the current `MP-LABEL:<code>` text, legacy JSON payloads, lookup
 * URLs, or the plain printed code. Returns '' for empty input.
 */
export function parseLabelCode(raw: string) {
  const value = String(raw || '').trim();
  if (!value) return '';
  const prefixed = value.match(/^MP-LABEL:([^\s]+)$/i);
  if (prefixed) return prefixed[1].trim().toUpperCase();
  try {
    const parsed = JSON.parse(value);
    const jsonCode = String(parsed?.labelCode || parsed?.code || '').trim();
    if (jsonCode) return jsonCode.toUpperCase();
  } catch {
    // The rendered QR may be a plain label code rather than legacy JSON.
  }
  try {
    const url = new URL(value);
    const queryCode = url.searchParams.get('label') || url.searchParams.get('code');
    const pathCode = url.pathname.match(/\/labels?\/([^/]+)$/i)?.[1];
    const urlCode = String(queryCode || pathCode || '').trim();
    if (urlCode) return decodeURIComponent(urlCode).toUpperCase();
  } catch {
    // The rendered QR may be a plain label code rather than a lookup URL.
  }
  return value.toUpperCase();
}

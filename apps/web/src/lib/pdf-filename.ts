// Downloaded PDFs are named after the document's own number (quote, order,
// invoice...), so the file a customer receives matches what the system shows.
// Renderer scripts announce that number on stderr with this marker.
export const DOCUMENT_NUMBER_MARKER = 'MP_DOCUMENT_NUMBER=';

/** The last number a renderer announced, or '' when it announced none. */
export function documentNumberFromRendererLog(stderr: string) {
  let found = '';
  for (const line of String(stderr || '').split(/\r?\n/)) {
    const at = line.indexOf(DOCUMENT_NUMBER_MARKER);
    if (at === -1) continue;
    try {
      const value = JSON.parse(line.slice(at + DOCUMENT_NUMBER_MARKER.length));
      if (typeof value === 'string') found = value;
    } catch {
      // A malformed marker is ignored; the caller falls back to its default name.
    }
  }
  return found.trim();
}

/** Makes a document number safe as a filename: `QT/2026/0063b` -> `QT-2026-0063b`. */
export function filenameSafe(value: string) {
  return String(value || '')
    .replace(/[\\/]+/g, '-')
    .replace(/[<>:"|?*\u0000-\u001f]+/g, '')
    .replace(/\s+/g, ' ')
    .replace(/^[\s.-]+|[\s.-]+$/g, '')
    .slice(0, 120)
    .trim();
}

/** `Content-Disposition` with a plain-ASCII name plus the exact UTF-8 name. */
export function pdfContentDisposition(disposition: 'inline' | 'attachment', filename: string) {
  const ascii = filename.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_') || 'document.pdf';
  return `${disposition}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

/**
 * The download name for a rendered PDF. `pattern` turns the safe number into a
 * name (default `<number>.pdf`); without a usable number the route's fallback is kept.
 */
export function pdfDownloadName(documentNumber: string, fallback: string, pattern?: (safeNumber: string) => string) {
  const safe = filenameSafe(documentNumber);
  if (!safe) return fallback;
  const name = pattern ? pattern(safe) : `${safe}.pdf`;
  return /\.pdf$/i.test(name) ? name : `${name}.pdf`;
}

// Checks how downloaded PDFs are named from the number a renderer announces.
// Run: npx tsx scripts/verify-pdf-filenames.ts
import assert from 'node:assert/strict';
import { documentNumberFromRendererLog, filenameSafe, pdfContentDisposition, pdfDownloadName } from '../apps/web/src/lib/pdf-filename';

const announce = (value: string) => `\nMP_DOCUMENT_NUMBER=${JSON.stringify(value)}\n`;

// The renderer may log image warnings around the marker; the marker still wins.
assert.equal(documentNumberFromRendererLog(`[quote-pdf] image could not be converted${announce('Captain-0069a')}`), 'Captain-0069a');
assert.equal(documentNumberFromRendererLog(''), '');
assert.equal(documentNumberFromRendererLog('MP_DOCUMENT_NUMBER=not-json'), '');
assert.equal(documentNumberFromRendererLog(`${announce('first')}${announce('QT/2026/0063b')}`), 'QT/2026/0063b');

// Slashes become hyphens; characters Windows or phones refuse are dropped.
assert.equal(filenameSafe('QT/2026/0063b'), 'QT-2026-0063b');
assert.equal(filenameSafe('SO\\2026\\0012'), 'SO-2026-0012');
assert.equal(filenameSafe('  Ramesh-27-0001a  '), 'Ramesh-27-0001a');
assert.equal(filenameSafe('A:B*C?"D"<E>|F'), 'ABCDEF');
assert.equal(filenameSafe('///'), '');

// Every document type: the number, or the route's old name when none was announced.
assert.equal(pdfDownloadName('Captain-0069a', 'MarblePark_Quote_01M83.pdf'), 'Captain-0069a.pdf');
assert.equal(pdfDownloadName('QT/2026/0063b', 'MarblePark_Quote_01M83.pdf'), 'QT-2026-0063b.pdf');
assert.equal(pdfDownloadName('Ramesh-27-0001', 'x.pdf'), 'Ramesh-27-0001.pdf');
assert.equal(pdfDownloadName('SO/2026/0012', 'x.pdf'), 'SO-2026-0012.pdf');
assert.equal(pdfDownloadName('INV/2026/0004', 'x.pdf'), 'INV-2026-0004.pdf');
assert.equal(pdfDownloadName('', 'MarblePark_Quote_01M83.pdf'), 'MarblePark_Quote_01M83.pdf');
assert.equal(pdfDownloadName('Captain-0069a', 'x.pdf', (n) => `${n} Architect Selection.pdf`), 'Captain-0069a Architect Selection.pdf');
assert.equal(pdfDownloadName('Amita Khairo', 'x.pdf', (n) => `Statement ${n}`), 'Statement Amita Khairo.pdf');

// Header: ASCII fallback for old browsers, exact UTF-8 name for the rest.
assert.equal(pdfContentDisposition('attachment', 'QT-2026-0063b.pdf'), `attachment; filename="QT-2026-0063b.pdf"; filename*=UTF-8''QT-2026-0063b.pdf`);
assert.equal(pdfContentDisposition('inline', 'Statement રમેશ.pdf'), `inline; filename="Statement ____.pdf"; filename*=UTF-8''Statement%20%E0%AA%B0%E0%AA%AE%E0%AB%87%E0%AA%B6.pdf`);

console.log('PDF filename checks passed.');

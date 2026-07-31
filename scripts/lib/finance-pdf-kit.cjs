/* eslint-disable */
const React = require('react');
const { Document, Page, Text, View, StyleSheet, Image, renderToBuffer } = require('@react-pdf/renderer');

const styles = StyleSheet.create({
  page: { padding: 34, fontFamily: 'Helvetica', color: '#18181b', backgroundColor: '#fffefd' },
  rule: { height: 4, backgroundColor: '#a52a24', marginBottom: 18 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  identity: { flexDirection: 'row', gap: 12, maxWidth: 340 },
  logo: { width: 52, height: 52, objectFit: 'contain' },
  logoFallback: { width: 52, height: 52, backgroundColor: '#19191b', color: '#ffffff', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 900 },
  company: { fontSize: 19, fontWeight: 900 },
  title: { fontSize: 22, fontWeight: 900, textAlign: 'right' },
  reference: { marginTop: 4, color: '#a52a24', fontSize: 10, fontWeight: 900, textAlign: 'right' },
  label: { fontSize: 7, color: '#a52a24', fontWeight: 900, letterSpacing: 1.2, textTransform: 'uppercase' },
  value: { marginTop: 5, fontSize: 11, fontWeight: 900 },
  small: { marginTop: 3, fontSize: 8, lineHeight: 1.35, color: '#6b6865' },
  panels: { flexDirection: 'row', gap: 12, marginTop: 21 },
  panel: { flex: 1, minHeight: 78, borderWidth: 1, borderColor: '#e5ddd7', padding: 11 },
  table: { marginTop: 18, borderWidth: 1, borderColor: '#e5ddd7' },
  tr: { flexDirection: 'row', minHeight: 32, paddingHorizontal: 7, paddingVertical: 7, borderBottomWidth: 1, borderBottomColor: '#eee8e4' },
  th: { backgroundColor: '#1b1b1e', color: '#ffffff' },
  total: { marginTop: 14, marginLeft: 'auto', width: 220, borderTopWidth: 2, borderTopColor: '#1b1b1e', paddingTop: 8, flexDirection: 'row', justifyContent: 'space-between', fontSize: 13, fontWeight: 900 },
  note: { marginTop: 18, minHeight: 52, borderWidth: 1, borderColor: '#e5ddd7', padding: 11 },
  footer: { position: 'absolute', bottom: 20, left: 34, right: 34, borderTopWidth: 1, borderTopColor: '#e5ddd7', paddingTop: 7, flexDirection: 'row', justifyContent: 'space-between', fontSize: 7, color: '#77716c' },
});

function money(value) { return `Rs. ${Number(value || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`; }
function date(value) { const valueDate = value ? new Date(value) : null; return valueDate && !Number.isNaN(valueDate.getTime()) ? valueDate.toLocaleDateString('en-IN') : '-'; }
function absolute(raw, base) { if (!raw) return null; try { return new URL(String(raw), base).href; } catch { return null; } }
async function embeddedImage(raw, requestUrl, apiUrl) {
  const url = absolute(raw, requestUrl); if (!url || url.startsWith('data:')) return url;
  const parsed = new URL(url); const candidates = [];
  if (parsed.pathname.startsWith('/catalogue-images/')) candidates.push(`${new URL(apiUrl).origin}${parsed.pathname}${parsed.search}`);
  else if (/^\/(?:brand|catalogue-art)\//.test(parsed.pathname)) candidates.push(`http://127.0.0.1:${process.env.PORT || 3000}${parsed.pathname}${parsed.search}`);
  candidates.push(url);
  for (const candidate of candidates) { try { const response = await fetch(candidate); if (!response.ok) continue; const bytes = Buffer.from(await response.arrayBuffer()); if (!bytes.length) continue; const mime = response.headers.get('content-type')?.split(';')[0] || (parsed.pathname.endsWith('.png') ? 'image/png' : 'image/jpeg'); return `data:${mime};base64,${bytes.toString('base64')}`; } catch {} }
  return null;
}
function token() { const value = String(process.env.PDF_SESSION_TOKEN || '').trim(); if (!value) throw new Error('Login required'); return value; }
async function fetchGql(query, variables, apiUrl) {
  const response = await fetch(apiUrl, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token()}` }, body: JSON.stringify({ query, variables }) });
  const payload = await response.json();
  if (!response.ok || payload.errors?.length) throw new Error(payload.errors?.[0]?.message || 'Document data was not found');
  return payload.data;
}
function header(e, settings, title, reference, requestUrl) {
  const logo = absolute(settings.logoUrl, requestUrl);
  return e(View, { style: styles.header },
    e(View, { style: styles.identity }, logo ? e(Image, { src: logo, style: styles.logo }) : e(View, { style: styles.logoFallback }, e(Text, null, 'MP')), e(View, null,
      e(Text, { style: styles.company }, settings.companyName || 'Marble Park'),
      settings.companyAddress ? e(Text, { style: styles.small }, settings.companyAddress) : null,
      settings.gstNumber ? e(Text, { style: styles.small }, `GSTIN ${settings.gstNumber}`) : null,
    )),
    e(View, null, e(Text, { style: styles.title }, title), e(Text, { style: styles.reference }, reference)),
  );
}

module.exports = { React, Document, Page, Text, View, Image, StyleSheet, renderToBuffer, styles, money, date, embeddedImage, fetchGql, header };

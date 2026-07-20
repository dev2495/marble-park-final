import { PrismaClient } from '@prisma/client';
import { readFile, rm, stat } from 'node:fs/promises';
import path from 'node:path';

const GRAPHQL = process.env.API_URL || 'http://localhost:4000/graphql';
const HTTP = new URL(GRAPHQL).origin;
const TEST_EMAIL = process.env.TEST_EMAIL || 'admin@marblepark.com';
const TEST_PASSWORD = process.env.TEST_PASSWORD || 'password123';
const SAMPLE = path.resolve('apps/web/public/help/Marble-Park-ERP-User-Guide.pdf');
const VIDEO = path.resolve('reports/marble-park-user-training-2026-07-17/videos/01-master-data-and-tiles.mp4');
const prisma = new PrismaClient();
const createdAssetIds = [];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function gql(query, variables = {}, token) {
  const response = await fetch(GRAPHQL, { method: 'POST', headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify({ query, variables }) });
  const payload = await response.json();
  if (!response.ok || payload.errors?.length) throw new Error(payload.errors?.map((row) => row.message).join('; ') || `GraphQL request failed (${response.status})`);
  return payload.data;
}

async function upload(token, bytes, filename, category = 'Catalogues', contentType = 'application/pdf') {
  const form = new FormData();
  form.append('file', new Blob([bytes], { type: contentType }), filename);
  form.append('category', category);
  form.append('description', 'Document vault release verification');
  const response = await fetch(`${HTTP}/api/document-vault/files`, { method: 'POST', headers: token ? { authorization: `Bearer ${token}` } : {}, body: form });
  const payload = await response.json().catch(() => ({}));
  return { response, payload };
}

async function cleanup() {
  if (!createdAssetIds.length) return;
  const assets = await prisma.vaultAsset.findMany({ where: { id: { in: createdAssetIds } } });
  await prisma.vaultShare.deleteMany({ where: { assetId: { in: createdAssetIds } } });
  await prisma.auditEvent.deleteMany({ where: { entityType: 'VaultAsset', entityId: { in: createdAssetIds } } });
  await prisma.vaultAsset.deleteMany({ where: { id: { in: createdAssetIds } } });
  const storageRoot = process.env.DOCUMENT_VAULT_STORAGE_DIR || path.resolve('apps/web/public/catalogue-images/document-vault');
  for (const asset of assets) await rm(path.join(storageRoot, asset.storageKey), { force: true });
}

async function main() {
  try {
    const token = (await gql(`mutation($input: LoginInput!) { login(input: $input) { token } }`, { input: { email: TEST_EMAIL, password: TEST_PASSWORD } })).login.token;
    const pdf = await readFile(SAMPLE);

    const denied = await upload('', pdf, 'unauthorised.pdf');
    assert(denied.response.status === 401, 'unauthenticated upload must be rejected before storage');

    const mismatch = await upload(token, Buffer.from('not a real pdf'), 'spoofed.pdf');
    assert(mismatch.response.status === 400, 'content that does not match its extension must be rejected');

    const suffix = Date.now().toString(36).toUpperCase();
    const uploaded = await upload(token, pdf, `vault-${suffix}.pdf`);
    assert(uploaded.response.status === 201, `PDF upload should return 201, received ${uploaded.response.status}: ${JSON.stringify(uploaded.payload)}`);
    const asset = uploaded.payload;
    createdAssetIds.push(asset.id);
    assert(asset.mediaKind === 'pdf' && asset.category === 'Catalogues' && asset.checksum?.length === 64, 'upload must persist validated PDF metadata and checksum');

    const internal = await fetch(`${HTTP}/api/document-vault/files/${asset.id}/content`, { headers: { authorization: `Bearer ${token}` } });
    assert(internal.status === 200 && internal.headers.get('content-type')?.includes('application/pdf'), 'authenticated PDF preview must stream inline');
    assert(internal.headers.get('content-disposition')?.startsWith('inline'), 'PDF preview must use inline disposition');

    const updated = (await gql(`mutation($assetId: ID!, $input: JSON!) { updateVaultAsset(assetId: $assetId, input: $input) }`, { assetId: asset.id, input: { title: `Showroom catalogue ${suffix}`, category: 'Showroom samples', description: 'Updated during smoke verification' } }, token)).updateVaultAsset;
    assert(updated.title.includes(suffix) && updated.category === 'Showroom samples', 'vault metadata must be editable');

    const listed = (await gql(`query($search: String) { vaultAssets(search: $search, take: 10) }`, { search: suffix }, token)).vaultAssets;
    assert(listed.some((row) => row.id === asset.id), 'search must find updated vault metadata');

    const viewOnly = (await gql(`mutation($assetId: ID!, $input: JSON!) { createVaultShare(assetId: $assetId, input: $input) }`, { assetId: asset.id, input: { allowDownload: false, expiresAt: new Date(Date.now() + 86400000).toISOString() } }, token)).createVaultShare;
    assert(viewOnly.token?.length >= 40, 'share token must have high entropy');
    const publicMeta = await fetch(`${HTTP}/api/document-vault/public/${viewOnly.token}/meta`);
    const publicPayload = await publicMeta.json();
    assert(publicMeta.status === 200 && publicPayload.allowDownload === false && !publicPayload.storageKey, 'public metadata must be minimal and respect view-only access');
    const publicContent = await fetch(`${HTTP}/api/document-vault/public/${viewOnly.token}/content`);
    assert(publicContent.status === 200, 'active public link must stream the file');
    const blockedDownload = await fetch(`${HTTP}/api/document-vault/public/${viewOnly.token}/content?download=1`);
    assert(blockedDownload.status === 404, 'view-only public link must block download mode');

    await gql(`mutation($shareId: ID!) { revokeVaultShare(shareId: $shareId) }`, { shareId: viewOnly.id }, token);
    assert((await fetch(`${HTTP}/api/document-vault/public/${viewOnly.token}/meta`)).status === 404, 'revoked share must stop working immediately');

    const downloadable = (await gql(`mutation($assetId: ID!, $input: JSON!) { createVaultShare(assetId: $assetId, input: $input) }`, { assetId: asset.id, input: { allowDownload: true } }, token)).createVaultShare;
    const download = await fetch(`${HTTP}/api/document-vault/public/${downloadable.token}/content?download=1`);
    assert(download.status === 200 && download.headers.get('content-disposition')?.startsWith('attachment'), 'download-enabled share must return attachment content');

    await gql(`mutation($assetId: ID!, $archived: Boolean!) { setVaultAssetArchived(assetId: $assetId, archived: $archived) }`, { assetId: asset.id, archived: true }, token);
    assert((await fetch(`${HTTP}/api/document-vault/public/${downloadable.token}/meta`)).status === 404, 'archiving must revoke active public links');
    assert((await fetch(`${HTTP}/api/document-vault/files/${asset.id}/content`, { headers: { authorization: `Bearer ${token}` } })).status === 404, 'archived content must not stream internally');

    await gql(`mutation($assetId: ID!, $archived: Boolean!) { setVaultAssetArchived(assetId: $assetId, archived: $archived) }`, { assetId: asset.id, archived: false }, token);
    assert((await fetch(`${HTTP}/api/document-vault/files/${asset.id}/content`, { headers: { authorization: `Bearer ${token}` } })).status === 200, 'restored file must be available internally');

    const auditCount = await prisma.auditEvent.count({ where: { entityType: 'VaultAsset', entityId: asset.id } });
    assert(auditCount >= 7, 'upload, update, share, revoke, archive and restore must be audited');

    const videoBytes = await readFile(VIDEO);
    const uploadedVideo = await upload(token, videoBytes, `training-${suffix}.mp4`, 'Training', 'video/mp4');
    assert(uploadedVideo.response.status === 201 && uploadedVideo.payload.mediaKind === 'video', 'MP4 upload must be detected as playable video');
    createdAssetIds.push(uploadedVideo.payload.id);
    const videoRange = await fetch(`${HTTP}/api/document-vault/files/${uploadedVideo.payload.id}/content`, { headers: { authorization: `Bearer ${token}`, range: 'bytes=0-99' } });
    assert(videoRange.status === 206 && videoRange.headers.get('content-range')?.startsWith('bytes 0-99/'), 'video streaming must support HTTP range requests');

    await gql(`mutation($assetId: ID!, $archived: Boolean!) { setVaultAssetArchived(assetId: $assetId, archived: $archived) }`, { assetId: uploadedVideo.payload.id, archived: true }, token);
    await gql(`mutation($assetId: ID!) { deleteVaultAssetPermanently(assetId: $assetId) }`, { assetId: uploadedVideo.payload.id }, token);
    assert(!(await prisma.vaultAsset.findUnique({ where: { id: uploadedVideo.payload.id } })), 'owner purge must remove archived metadata');
    const videoPath = path.join(process.env.DOCUMENT_VAULT_STORAGE_DIR || path.resolve('apps/web/public/catalogue-images/document-vault'), uploadedVideo.payload.storageKey);
    assert(!(await stat(videoPath).catch(() => null)), 'owner purge must reclaim the stored file');
    assert(await prisma.auditEvent.findFirst({ where: { entityType: 'VaultAsset', entityId: uploadedVideo.payload.id, action: 'vault.delete' } }), 'permanent deletion must retain audit evidence');

    console.log(JSON.stringify({ ok: true, upload: true, checksum: true, search: true, inlinePdf: true, videoUpload: true, videoRangeStreaming: true, viewOnlyShare: true, downloadableShare: true, revoke: true, archiveRestore: true, ownerPurge: true, auditEvents: auditCount }, null, 2));
  } finally {
    await cleanup().catch((error) => console.error(`Cleanup warning: ${error.message}`));
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});

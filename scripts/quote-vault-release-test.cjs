const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { ulid } = require('ulid');
const { PrismaClient } = require('@prisma/client');
const { DocumentsService } = require('../apps/api/dist/src/modules/documents/documents.service');
const { DocumentsResolver } = require('../apps/api/dist/src/modules/documents/documents.resolver');
const { AuditService } = require('../apps/api/dist/src/modules/audit/audit.service');
const { hasPermission } = require('../apps/api/dist/src/modules/auth/rbac');
const { groupQuoteLines, requestedQuantityLabel } = require('../packages/pricing-contract/quote-display');
const { buildDocument } = require('../apps/web/scripts/render-quote-pdf.cjs');
const { renderToBuffer } = require('@react-pdf/renderer');

const url = new URL(process.env.DATABASE_URL);
assert(['localhost', '127.0.0.1'].includes(url.hostname) && url.pathname === '/marble_quote_vault_20260908', 'Disposable test database only');
const p = new PrismaClient();
async function main() {
  const output = path.resolve('output/quote-vault');
  fs.mkdirSync(output, { recursive: true });
  process.env.DOCUMENT_VAULT_STORAGE_DIR = path.join(output, 'test-vault');
  const service = new DocumentsService(p, new AuditService(p));
  const resolver = new DocumentsResolver(service, p);
  const users = await p.user.findMany();
  const admin = users.find(u => u.role === 'admin');
  const sales = users.find(u => u.role === 'sales');
  assert(hasPermission(admin, 'documents.delete'));
  assert(hasPermission({role:'owner'}, 'documents.delete'));
  assert(!hasPermission(sales, 'documents.delete'));
  assert(!hasPermission({role:'sales_manager'}, 'documents.delete'));
  async function context(user) {
    const token = ulid();
    await p.session.create({data:{id:ulid(),token,userId:user.id,expiresAt:new Date(Date.now()+3600000)}});
    return {req:{headers:{authorization:`Bearer ${token}`}}};
  }
  const adminCtx = await context(admin), salesCtx = await context(sales);
  const id = ulid(), storageKey = `${id}.pdf`;
  fs.writeFileSync(path.join(service.vaultRoot(), storageKey), '%PDF-1.4 disposable test only');
  await p.vaultAsset.create({data:{id,title:'Disposable release test',originalName:'test.pdf',storageKey,contentType:'application/pdf',extension:'.pdf',sizeBytes:28,checksum:'test-only',mediaKind:'pdf',uploadedBy:admin.id,updatedAt:new Date()}});
  await assert.rejects(resolver.deleteVaultAssetPermanently(id, {}), /Login required/);
  await assert.rejects(resolver.deleteVaultAssetPermanently(id, salesCtx), /restricted/);
  await assert.rejects(resolver.deleteVaultAssetPermanently(id, adminCtx), /Archive/);
  await service.setVaultAssetArchived(id, true, admin.id);
  await p.vaultShare.create({data:{id:ulid(),token:ulid(),assetId:id,createdBy:admin.id,expiresAt:new Date(Date.now()+3600000)}});
  const originalTransaction = p.$transaction.bind(p);
  p.$transaction = async () => { throw new Error('simulated transaction failure'); };
  await assert.rejects(service.purgeVaultAsset(id, admin.id), /simulated/);
  assert(fs.existsSync(path.join(service.vaultRoot(), storageKey)), 'failed database deletion restores file');
  p.$transaction = originalTransaction;
  await p.user.update({where:{id:sales.id},data:{permissionOverrides:{'documents.delete':true}}});
  await resolver.deleteVaultAssetPermanently(id, salesCtx);
  assert.equal(await p.vaultAsset.findUnique({where:{id}}), null);
  assert.equal(await p.vaultShare.count({where:{assetId:id}}),0);
  assert(!fs.existsSync(path.join(service.vaultRoot(), storageKey)));
  assert.equal(await p.auditEvent.count({where:{entityId:id,action:'vault.delete'}}),1);
  await p.user.update({where:{id:sales.id},data:{permissionOverrides:{'documents.delete':false}}});
  await assert.rejects(resolver.deleteVaultAssetPermanently(id, salesCtx), /restricted/);
  const lines = [5,6,2].map((requestedArea,i)=>({
    sku:`SAMPLE-${i+1}`,name:`Illustrative tile ${i+1}`,category:'Tiles',type:'tile',
    area:i === 1 ? ' MASTER  BATHROOM WALL ' : 'Master Bathroom Wall',
    qty:1,quantity:1,requestedArea,coveragePerPack:15.5,piecesPerPack:4,unit:'BOX',inventoryUom:'BOX',pricingUom:'SQFT',
    rateBasis:'AREA',priceRateBasis:'AREA',mrpRateBasis:'AREA',pricingQuantity:15.5,
    mrpInclusive:105,nrpMode:'PERCENT_OFF_MRP',nrpInput:0,specialMode:'NONE',specialInput:0,taxRate:18,pricingVersion:'unified_retail_v1'
  }));
  assert.equal(groupQuoteLines(lines).length,1);
  assert.equal(groupQuoteLines([...lines,{area:'Master Bathroom Floor'}]).length,2);
  assert.equal(requestedQuantityLabel(lines[0]),'Requested: 5 SQFT');
  const base = await p.quote.findFirst();
  assert(base, 'Demo quote required');
  const quote = await p.quote.update({where:{id:base.id},data:{lines,quoteType:'tile',status:'draft',pricingVersion:'unified_retail_v1',title:'ILLUSTRATIVE RELEASE TEST',quoteMeta:{remarks:'Illustrative test values; not a client quotation.'}}});
  const payload = {quote:{...quote,customer:{name:'ILLUSTRATIVE SAMPLE'},owner:{name:'Release test'}},settings:{logoUrl:`data:image/png;base64,${fs.readFileSync('apps/web/public/brand/marble-park-logo.png').toString('base64')}`},brands:[]};
  fs.writeFileSync(path.join(output,'sample-quote.pdf'), await renderToBuffer(buildDocument(payload,'http://localhost:3000')));
  fs.writeFileSync(path.join(output,'test-result.json'), JSON.stringify({pass:true,quoteId:quote.id,checks:['admin/owner access','unauthenticated denial','sales denial','archive gate','override grant','override revocation','binary removal','audit retention','normalized grouping','distinct sections preserved','requested quantity labels','rendered PDF']},null,2));
  console.log(JSON.stringify({pass:true,quoteId:quote.id,output}));
}
main().finally(()=>p.$disconnect()).catch(e=>{console.error(e);process.exitCode=1;});

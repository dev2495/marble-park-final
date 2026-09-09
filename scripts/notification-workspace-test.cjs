/* Disposable PostgreSQL integration gate. Never run against a business database. */
const assert = require('node:assert/strict');
const { PrismaClient, Prisma } = require('@prisma/client');
const bcrypt = require('bcrypt');
const { NotificationsService } = require('../apps/api/dist/src/modules/notifications/notifications.service');
const { NotificationsWorker } = require('../apps/api/dist/src/modules/notifications/notifications.worker');
const { LeadsService } = require('../apps/api/dist/src/modules/leads/leads.service');
const { effectivePermissionsForUser } = require('../apps/api/dist/src/modules/auth/rbac');
if (!process.env.DATABASE_URL?.includes('/marble_notifications_test_')) throw Error('Disposable notification test database required');
const db = new PrismaClient();
const service = new NotificationsService(db), worker = new NotificationsWorker(db);
const now = new Date(), yesterday = new Date(Date.now() - 86400000);
let passed = 0;
async function check(name, fn) { await fn(); passed++; console.log(`PASS ${name}`); }
async function fixture(model, data) {
  const shape = Prisma.dmmf.datamodel.models.find(m => m.name === model);
  const result = {};
  for (const f of shape.fields) if (f.kind !== 'object' && f.isRequired && !f.hasDefaultValue && !f.isUpdatedAt && !f.isList) {
    result[f.name] = f.type === 'DateTime' ? now : f.type === 'Json' ? [] : ['Float','Int','Decimal'].includes(f.type) ? 1 : f.type === 'Boolean' ? false : `${model}-${f.name}`;
  }
  const delegate = model[0].toLowerCase()+model.slice(1);
  return db[delegate].create({ data: { ...result, ...data } });
}
async function main() {
  await check('legacy migration preserves personal reads and archives duplicates',async()=>{
    const { Client }=require('pg');const client=new Client({connectionString:process.env.DATABASE_URL});await client.connect();
    try {
      await client.query('BEGIN');await client.query('CREATE SCHEMA notification_legacy_acceptance');await client.query('SET LOCAL search_path TO notification_legacy_acceptance');
      await client.query('CREATE TABLE "User" (id text PRIMARY KEY, role text, active boolean); CREATE TABLE "Notification" (id text PRIMARY KEY, type text, "entityId" text, "targetUserId" text, "targetRole" text, "readAt" timestamp, "createdAt" timestamp DEFAULT CURRENT_TIMESTAMP)');
      await client.query(`INSERT INTO "User" VALUES ('a','owner',true),('b','owner',true),('s','sales',true); INSERT INTO "Notification" (id,type,"entityId","targetUserId","targetRole","readAt","createdAt") VALUES ('old','quote_ready','q',null,'owner',CURRENT_TIMESTAMP,'2026-01-01'),('new','quote_ready','q',null,'owner',null,'2026-02-01'),('personal','info','s','s',null,CURRENT_TIMESTAMP,'2026-02-01'),('broadcast','info','x',null,null,null,'2026-02-01')`);
      await client.query(require('fs').readFileSync(require('path').join(__dirname,'../apps/api/prisma/migrations/20260909100000_notification_workspace/migration.sql'),'utf8'));
      const rows=(await client.query('SELECT * FROM "NotificationRecipient"')).rows;assert.equal(rows.length,5);assert(rows.filter(r=>r.notificationId==='old').every(r=>r.archivedAt && !r.readAt));assert(rows.find(r=>r.notificationId==='personal').readAt);assert.equal((await client.query('SELECT count(*) FROM "Notification"')).rows[0].count,'4');
    } finally {await client.query('ROLLBACK');await client.end();}
  });
  const roles = ['owner','owner','sales','office_staff','inventory_manager','dispatch_ops','admin'];
  const users = [];
  for (let i=0;i<roles.length;i++) {
    const u = await fixture('User', { id: `notify-test-${i}`, role: roles[i], name: `Test ${roles[i]} ${i}`, email: `notify-${i}@example.test`, passwordHash: await bcrypt.hash('LocalTest-Only-928!', 4), phone: '' });
    users.push({ ...u, effectivePermissions: effectivePermissionsForUser(u) });
  }
  const [a,b,sales,office,inventory,dispatch,admin] = users;
  const n = await service.create({ title:'Owner update', message:'Restricted team update', type:'test_info', targetRole:'owner' });
  await worker.deliver();
  await check('per-user receipts', async()=>{ await service.markRead(n.id,a); assert.equal((await service.forUser(a)).find(x=>x.id===n.id).readAt instanceof Date,true); assert.equal((await service.forUser(b)).find(x=>x.id===n.id).readAt,null); });
  await check('cross-role read rejected',async()=>{await assert.rejects(()=>service.markRead(n.id,sales));});
  await check('bulk cross-role update is atomic',async()=>{ const own=await service.create({title:'Own',message:'Own',targetUserId:sales.id});await worker.deliver();await assert.rejects(()=>service.change([own.id,n.id],'read',sales));assert.equal((await service.forUser(sales)).find(x=>x.id===own.id).readAt,null); });
  await check('query bounds',async()=>{for(const take of [0,-1,1.2,101,1000000]) await assert.rejects(()=>service.inbox(a,{take}));});
  await check('no implicit broadcasts',async()=>{assert.equal(await service.create({title:'No audience',message:'Must not broadcast'}),null);});
  const customer = await fixture('Customer',{id:'nt-customer',name:'Notification test customer',mobile:'9000000001'});
  const lead = await fixture('Lead',{id:'nt-lead',customerId:customer.id,ownerId:sales.id,title:'Bathroom renovation',stage:'quoted'});
  await fixture('LeadIntent',{id:'nt-intent',leadId:lead.id,customerId:customer.id,ownerId:sales.id,createdBy:sales.id,status:'pending_quote',intentType:'products',rows:[],submittedAt:yesterday});
  await fixture('FollowUpTask',{id:'nt-followup',leadId:lead.id,ownerId:sales.id,status:'pending',dueAt:yesterday,notes:'Confirm customer selection'});
  await fixture('CollectionTask',{id:'nt-collection',customerId:customer.id,ownerId:sales.id,createdBy:a.id,status:'open',dueAt:yesterday,note:'Confirm payment date'});
  await fixture('PurchaseOrder',{id:'nt-po',poNumber:'PO/TEST/001',vendorName:'Test supplier',status:'ordered',expectedDate:yesterday,createdBy:office.id});
  await fixture('PurchaseOrderLine',{id:'nt-po-line',purchaseOrderId:'nt-po',sku:'NOTIFY-TILE',unitCost:0,netUnitCost:0,costStatus:'missing'});
  await fixture('SalesInvoice',{id:'nt-invoice',invoiceNumber:'INV/TEST/001',customerId:customer.id,status:'posted',openAmount:500,totalAmount:500,dueDate:yesterday,createdBy:a.id});
  await fixture('AuditEvent',{id:'nt-import',actorUserId:office.id,action:'excel_import.blocked',entityType:'ImportBatch',entityId:'nt-import',summary:'Correct invalid spreadsheet rows before importing'});
  await fixture('Product',{id:'nt-product',sku:'NOTIFY-TILE',name:'Parker Grey',status:'active',tags:[],defaultMrpInclusive:100});
  await fixture('InventoryBalance',{id:'nt-balance',productId:'nt-product',onHand:1,available:1,reserved:0,hold:0,damaged:0,lowStockThreshold:5,criticalStockThreshold:2});
  await fixture('InventoryLot',{id:'nt-lot',lotNumber:'LOT/TEST/001',productId:'nt-product',createdBy:inventory.id,unitCost:0,costStatus:'pending',status:'active',receivedAt:yesterday});
  const quote=await fixture('Quote',{id:'nt-quote',quoteNumber:'QT/TEST/001',customerId:customer.id,leadId:lead.id,ownerId:sales.id,status:'incomplete_pricing',pricingStatus:'incomplete',approvalStatus:'incomplete',lines:[],versions:[]});
  await fixture('DispatchJob',{id:'nt-dispatch',customerId:customer.id,ownerId:sales.id,status:'pending',dueDate:yesterday});
  await fixture('DocumentJob',{id:'nt-document',entityType:'Quote',entityId:quote.id,documentType:'quote_pdf',status:'failed',generatedBy:sales.id});
  await fixture('StockCountSession',{id:'nt-count',countNumber:'SC/TEST/001',status:'submitted',createdBy:inventory.id});
  await fixture('StockLocation',{id:'nt-location',code:'NT-LOC',name:'Test godown',type:'warehouse',status:'active'});
  await fixture('OpeningStockSession',{id:'nt-opening',sessionNumber:'OS/TEST/001',locationId:'nt-location',createdBy:inventory.id,status:'submitted'});
  await fixture('StockAdjustmentApproval',{id:'nt-adjustment',productId:'nt-product',status:'pending',requestedBy:inventory.id,reason:'Count discrepancy'});
  await worker.tick(); assert.equal(worker.lastError,null);
  await check('all 14 source-rule tasks projected',async()=>{ assert.equal(await db.notification.count({where:{category:'action',status:'open'}}),14); });
  await check('audit-backed import update reaches uploader only',async()=>{const item=await db.notification.findUnique({where:{taskKey:'import-event:nt-import'}});assert(item);assert((await service.inbox(office,{view:'updates'})).items.some(n=>n.id===item.id));await assert.rejects(()=>service.markRead(item.id,sales));});
  await check('supplier rates and invoices route to authorized teams',async()=>{assert((await service.inbox(a,{view:'team'})).items.some(n=>n.type==='work_po_cost'));assert(!(await service.inbox(sales,{view:'open'})).items.some(n=>n.type==='work_po_cost'));assert((await service.inbox(a,{view:'team'})).items.some(n=>n.type==='work_invoice'));assert(!(await service.inbox(office,{view:'team'})).items.some(n=>n.type==='work_invoice'));});
  await check('correct teams and personal routing',async()=>{
    const officeTypes=(await service.inbox(office,{view:'open'})).items.map(n=>n.type);
    assert(officeTypes.includes('work_intent')); assert(officeTypes.includes('work_po')); assert(!officeTypes.includes('work_quote'));assert(!officeTypes.includes('work_cost'));
    const salesTypes=(await service.inbox(sales,{view:'action'})).items.map(n=>n.type);assert(salesTypes.includes('work_followup'));assert(salesTypes.includes('work_collection'));assert(salesTypes.includes('work_quote'));assert(!salesTypes.includes('work_cost'));
    assert((await service.inbox(dispatch,{view:'team'})).items.some(n=>n.type==='work_dispatch'));
  });
  await check('source reconciliation idempotency',async()=>{ const count=await db.notification.count(); await worker.tick();assert.equal(worker.lastError,null); assert.equal(await db.notification.count(),count); });
  await check('follow-up outcome authorization, audit and source resolution',async()=>{const leads=new LeadsService(db,null,service);await assert.rejects(()=>leads.completeFollowUp('nt-followup','Wrong team',office));await assert.rejects(()=>leads.completeFollowUp('nt-followup','',sales));await leads.completeFollowUp('nt-followup','Customer confirmed the selection',sales);assert.equal(await db.auditEvent.count({where:{action:'followup.complete',entityId:'nt-followup'}}),1);await worker.tick();assert.equal((await db.notification.findUnique({where:{taskKey:'work_followup:nt-followup'}})).status,'resolved');});
  const intentTask=await db.notification.findUnique({where:{taskKey:'work_intent:nt-intent'}});
  await check('concurrent team claims: only one succeeds',async()=>{ const results=await Promise.allSettled([service.change([intentTask.id],'claim',a),service.change([intentTask.id],'claim',b)]);assert.equal(results.filter(r=>r.status==='fulfilled').length,1);});
  await check('open work cannot be archived',async()=>{await assert.rejects(()=>service.change([intentTask.id],'archive',a));});
  await check('read does not resolve work',async()=>{await service.markRead(intentTask.id,office);assert.equal((await db.notification.findUnique({where:{id:intentTask.id}})).status,'open');});
  await check('snooze is personal and reversible',async()=>{await service.change([intentTask.id],'snooze',office);assert(!(await service.inbox(office,{view:'open'})).items.some(n=>n.id===intentTask.id));assert((await service.inbox(office,{view:'snoozed'})).items.some(n=>n.id===intentTask.id));await service.change([intentTask.id],'unsnooze',office);});
  await check('source completion resolves without setting read',async()=>{await db.leadIntent.update({where:{id:'nt-intent'},data:{status:'converted'}});await worker.tick();assert.equal(worker.lastError,null);assert.equal((await db.notification.findUnique({where:{id:intentTask.id}})).status,'resolved');});
  await check('reopened work resets personal state',async()=>{await db.leadIntent.update({where:{id:'nt-intent'},data:{status:'pending_quote'}});await worker.tick();assert.equal((await db.notificationRecipient.findUnique({where:{notificationId_userId:{notificationId:intentTask.id,userId:office.id}}})).readAt,null);});
  await check('cost completion auto-resolves',async()=>{await db.inventoryLot.update({where:{id:'nt-lot'},data:{unitCost:60,costStatus:'complete'}});await worker.tick();assert.equal((await db.notification.findUnique({where:{taskKey:'work_cost:nt-lot'}})).status,'resolved');});
  await check('quote approval changes recipient',async()=>{await db.quote.update({where:{id:quote.id},data:{pricingStatus:'complete',approvalStatus:'pending',status:'pending_approval'}});await worker.tick();const task=await db.notification.findUnique({where:{taskKey:'work_quote:nt-quote'}});assert.equal(task.targetRole,'owner_admin');await assert.rejects(()=>service.markRead(task.id,sales));});
  await check('permission revocation removes access',async()=>{const revoked={...office,effectivePermissions:[]};assert(!(await service.inbox(revoked,{view:'open'})).items.some(n=>n.type==='work_intent'));});
  await check('critical stock recovery resolves task',async()=>{await db.inventoryBalance.update({where:{id:'nt-balance'},data:{available:10,onHand:10}});await worker.tick();assert.equal((await db.notification.findUnique({where:{taskKey:'work_stock:nt-product'}})).status,'resolved');});
  await check('delivery replay does not duplicate recipients',async()=>{await db.notification.update({where:{id:n.id},data:{deliveredAt:null}});const count=await db.notificationRecipient.count({where:{notificationId:n.id}});await worker.deliver();assert.equal(await db.notificationRecipient.count({where:{notificationId:n.id}}),count);});
  await check('failed delivery persists retry and then recovers',async()=>{const event=await service.create({title:'Retry fixture',message:'Replay safely',targetRole:'owner'});const transaction=db.$transaction.bind(db);db.$transaction=async()=>{throw Error('Injected delivery failure')};try{await worker.deliver();}finally{db.$transaction=transaction;}const failed=await db.notification.findUnique({where:{id:event.id}});assert.equal(failed.deliveryAttempts,1);assert.equal(failed.deliveredAt,null);await db.notification.update({where:{id:event.id},data:{retryAt:new Date(0)}});await worker.deliver();assert((await db.notification.findUnique({where:{id:event.id}})).deliveredAt);});
  await check('failed source scan preserves existing work',async()=>{const before=await db.notification.count({where:{category:'action',status:'open'}});const transaction=db.$transaction.bind(db);db.$transaction=async()=>{throw Error('Injected source failure')};try{await worker.tick();assert(worker.lastError);}finally{db.$transaction=transaction;}assert.equal(await db.notification.count({where:{category:'action',status:'open'}}),before);await worker.tick();assert.equal(worker.lastError,null);});
  await check('pagination includes every accessible record',async()=>{const seen=new Set();let cursor;do{const page=await service.inbox(a,{take:2,cursor});for(const n of page.items){assert(!seen.has(n.id));seen.add(n.id);}cursor=page.nextCursor;}while(cursor);assert(seen.size>8);});
  await check('update preferences preserve required work',async()=>{await service.preferences(a,true);const count=await service.unreadCount(a);assert(count>0);await service.preferences(a,false);assert((await service.unreadCount(a))>=count);});
  await check('worker health is restricted and current',async()=>{await assert.rejects(()=>service.health(sales));assert.equal((await service.health(admin)).healthy,true);});
  await check('20 concurrent inbox users/requests',async()=>{const started=Date.now();await Promise.all(Array.from({length:20},(_,i)=>service.inbox(users[i%users.length])));console.log(`20 concurrent requests: ${Date.now()-started} ms (local fixture database)`);});
  console.log(`${passed} notification integration checks passed. Database retained for browser acceptance.`);
}
main().catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>db.$disconnect());

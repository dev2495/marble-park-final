import { PrismaClient } from '@prisma/client';

const API = process.env.API_URL || 'http://localhost:4100/graphql';
const WEB = process.env.WEB_URL || 'http://localhost:3000';
const TEST_EMAIL = process.env.TEST_EMAIL || 'admin@marblepark.com';
const TEST_PASSWORD = process.env.TEST_PASSWORD || 'password123';
const prisma = new PrismaClient();

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function gql(query, variables = {}, token) {
  const response = await fetch(API, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ query, variables }),
  });
  const json = await response.json();
  if (!response.ok || json.errors?.length) throw new Error(json.errors?.map((error) => error.message).join('; ') || `GraphQL request failed (${response.status})`);
  return json.data;
}

async function main() {
  const login = await gql(`mutation($input: LoginInput!) { login(input: $input) { token } }`, { input: { email: TEST_EMAIL, password: TEST_PASSWORD } });
  const token = login.login.token;
  const reservation = await prisma.reservation.findFirst({
    where: { status: 'reserved', salesOrderId: { not: null }, product: { sku: { startsWith: 'CLIENT-FLOW-' } } },
    orderBy: { createdAt: 'desc' },
  });
  assert(reservation?.salesOrderId, 'Run the procurement lot-allocation smoke test first');
  const location = await prisma.stockLocation.findFirst({ where: { code: 'MAIN' } });
  assert(location, 'MAIN stock location is required');

  const pick = (await gql(
    `mutation($input: CreatePickListInput!) { createPickList(input: $input) }`,
    { input: { salesOrderId: reservation.salesOrderId, locationId: location.id, notes: 'Delivery proof regression test' } }, token,
  )).createPickList;
  assert(pick.lines.length > 0, 'Pick list must allocate exact reserved lots');
  await gql(`mutation($id: ID!, $action: String!) { transitionPickList(id: $id, action: $action) }`, { id: pick.id, action: 'start' }, token);
  await gql(
    `mutation($id: ID!, $action: String!, $input: PickListTransitionInput) { transitionPickList(id: $id, action: $action, input: $input) }`,
    { id: pick.id, action: 'pick', input: { lines: JSON.stringify(pick.lines.map((line) => ({ pickLineId: line.id, pickedQuantity: line.requestedQuantity }))) } }, token,
  );
  await gql(
    `mutation($id: ID!, $action: String!, $input: PickListTransitionInput) { transitionPickList(id: $id, action: $action, input: $input) }`,
    { id: pick.id, action: 'pack', input: { lines: JSON.stringify(pick.lines.map((line) => ({ pickLineId: line.id, packedQuantity: line.requestedQuantity }))) } }, token,
  );
  await gql(`mutation($id: ID!, $action: String!) { transitionPickList(id: $id, action: $action) }`, { id: pick.id, action: 'complete' }, token);
  const job = await prisma.dispatchJob.findFirst({ where: { salesOrderId: reservation.salesOrderId } });
  assert(job, 'Sales order dispatch job must exist');
  const challan = (await gql(
    `mutation($input: CreateChallanInput!) { createChallan(input: $input) { id challanNumber status } }`,
    { input: { jobId: job.id, pickListId: pick.id, transporter: 'Store vehicle', vehicleNo: 'UAT-01', driverName: 'UAT Driver', driverPhone: '9000000001', packages: 1 } }, token,
  )).createChallan;
  const slipResponse = await fetch(`${WEB}/api/pdf/dispatch/${challan.id}`);
  assert(slipResponse.ok && slipResponse.headers.get('content-type')?.includes('application/pdf'), `Dispatch slip PDF must render (${slipResponse.status})`);
  const slip = Buffer.from(await slipResponse.arrayBuffer());
  assert(slip.subarray(0, 4).toString() === '%PDF' && slip.length > 5_000, 'Dispatch slip must be a non-empty PDF');
  await gql(`mutation($id: ID!, $status: String!) { updateChallanStatus(id: $id, status: $status) { id status } }`, { id: challan.id, status: 'dispatched' }, token);

  let unprovedDeliveryRejected = false;
  try {
    await gql(`mutation($id: ID!, $status: String!) { updateChallanStatus(id: $id, status: $status) { id status } }`, { id: challan.id, status: 'delivered' }, token);
  } catch (error) {
    unprovedDeliveryRejected = /recipient proof|delivery confirmation/i.test(String(error.message));
  }
  assert(unprovedDeliveryRejected, 'A one-click delivery without proof must be rejected');

  const delivered = (await gql(
    `mutation($id: ID!, $input: ConfirmDeliveryInput!) { confirmDelivery(id: $id, input: $input) }`,
    { id: challan.id, input: { receivedByName: 'UAT Customer Representative', receivedByPhone: '9000000002', proofType: 'otp', notes: 'OTP checked at delivery' } }, token,
  )).confirmDelivery;
  assert(delivered.status === 'delivered', 'Recipient proof must complete delivery');
  const proof = await prisma.deliveryProof.findFirst({ where: { challanId: challan.id } });
  assert(proof?.receivedByName === 'UAT Customer Representative' && proof.proofType === 'otp', 'DeliveryProof must preserve recipient evidence');

  const returnable = (await gql(`query { returnableDispatchLines(take: 120) }`, {}, token)).returnableDispatchLines;
  const sourceLine = returnable.find((line) => line.challanId === challan.id);
  assert(sourceLine && sourceLine.returnableQuantity > 0 && sourceLine.lotId, 'Delivered exact-lot line must appear in return intake');
  const beforeLot = await prisma.inventoryLotBalance.findUnique({ where: { lotId_locationId: { lotId: sourceLine.lotId, locationId: location.id } } });
  const returned = (await gql(
    `mutation($input: ReturnOrderInput!) { createReturnOrder(input: $input) }`,
    { input: { salesOrderId: sourceLine.salesOrderId, challanId: challan.id, customerId: sourceLine.challan.customerId, locationId: location.id, reason: 'UAT unopened item return', receive: true, lines: JSON.stringify([{ dispatchLineId: sourceLine.id, quantity: 1, disposition: 'resell' }]), metadata: { test: true } } }, token,
  )).createReturnOrder;
  assert(returned.status === 'received', 'Return must be posted as received');
  const afterLot = await prisma.inventoryLotBalance.findUnique({ where: { lotId_locationId: { lotId: sourceLine.lotId, locationId: location.id } } });
  assert(Number(afterLot.onHand) === Number(beforeLot.onHand) + 1 && Number(afterLot.available) === Number(beforeLot.available) + 1, 'Resell return must restore the original lot and location');

  let overReturnRejected = false;
  try {
    await gql(
      `mutation($input: ReturnOrderInput!) { createReturnOrder(input: $input) }`,
      { input: { salesOrderId: sourceLine.salesOrderId, challanId: challan.id, customerId: sourceLine.challan.customerId, locationId: location.id, reason: 'Invalid over-return', receive: true, lines: JSON.stringify([{ dispatchLineId: sourceLine.id, quantity: Number(sourceLine.returnableQuantity), disposition: 'resell' }]) } }, token,
    );
  } catch (error) {
    overReturnRejected = /only .* delivered units left to return/i.test(String(error.message));
  }
  assert(overReturnRejected, 'Return quantity above delivered balance must be rejected atomically');

  console.log(JSON.stringify({ ok: true, pickNumber: pick.pickNumber, challanNumber: challan.challanNumber, dispatchSlipBytes: slip.length, proofType: proof.proofType, returnNumber: returned.returnNumber, restoredLot: sourceLine.lot.lotNumber }, null, 2));
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
}).finally(async () => prisma.$disconnect());

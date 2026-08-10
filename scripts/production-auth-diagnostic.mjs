import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcrypt');

const email = String(process.env.AUTH_DIAGNOSTIC_EMAIL || process.env.BOOTSTRAP_OWNER_EMAIL || '').trim().toLowerCase();
const prisma = new PrismaClient();

async function main() {
  if (!email) throw new Error('AUTH_DIAGNOSTIC_EMAIL or BOOTSTRAP_OWNER_EMAIL is required');
  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, email: true, role: true, active: true, passwordHash: true, passwordChangedAt: true, updatedAt: true },
  });
  if (!user) throw new Error('The requested account does not exist');

  const events = await prisma.auditEvent.findMany({
    where: {
      action: { in: ['auth.login', 'auth.login.failed', 'auth.login.throttled', 'auth.credential.recovery', 'auth.password.reset'] },
      OR: [{ entityId: email }, { entityId: user.id }, { actorUserId: user.id }],
    },
    orderBy: { createdAt: 'desc' },
    take: 30,
    select: { createdAt: true, action: true, entityId: true, metadata: true },
  });

  const bootstrapPasswordMatches = process.env.BOOTSTRAP_OWNER_PASSWORD
    ? await bcrypt.compare(process.env.BOOTSTRAP_OWNER_PASSWORD, user.passwordHash)
    : null;
  const recentCutoff = Date.now() - 15 * 60 * 1000;
  const failuresBySource = new Map();
  for (const event of events) {
    if (event.action !== 'auth.login.failed' || event.createdAt.getTime() < recentCutoff) continue;
    const source = String(event.metadata?.ipAddress || 'unknown');
    failuresBySource.set(source, (failuresBySource.get(source) || 0) + 1);
  }

  console.log(JSON.stringify({
    account: {
      email: user.email,
      role: user.role,
      active: user.active,
      passwordChangedAt: user.passwordChangedAt,
      updatedAt: user.updatedAt,
      bootstrapPasswordMatches,
    },
    recentFailureCountsBySource: Object.fromEntries(failuresBySource),
    events: events.map((event) => ({
      at: event.createdAt,
      action: event.action,
      reason: event.metadata?.reason || null,
      ipAddress: event.metadata?.ipAddress || null,
      sourceBackup: event.metadata?.sourceBackup || null,
      sessionsRevoked: event.metadata?.sessionsRevoked ?? null,
    })),
    passwordHashPrinted: false,
    bootstrapPasswordPrinted: false,
  }, null, 2));
}

main()
  .catch((error) => {
    console.error(error.stack || error.message || error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

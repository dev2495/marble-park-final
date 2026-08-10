import { randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { PrismaClient } = require('@prisma/client');
const { ulid } = require('ulid');

const email = String(process.env.PASSWORD_RESET_EMAIL || '').trim().toLowerCase();
const origin = String(process.env.APP_ORIGIN || '').trim().replace(/\/$/, '');
const prisma = new PrismaClient();

async function main() {
  if (!email || !origin) throw new Error('PASSWORD_RESET_EMAIL and APP_ORIGIN are required');
  if (!/^https:\/\//.test(origin)) throw new Error('APP_ORIGIN must be an HTTPS origin');
  const user = await prisma.user.findUnique({ where: { email }, select: { id: true, active: true } });
  if (!user?.active) throw new Error('The requested active account does not exist');
  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000);
  await prisma.$transaction(async (tx) => {
    await tx.passwordResetToken.deleteMany({ where: { userId: user.id, usedAt: null } });
    await tx.passwordResetToken.create({ data: { id: ulid(), userId: user.id, token, expiresAt } });
    await tx.auditEvent.create({
      data: {
        id: ulid(), actorUserId: 'system', action: 'auth.password.reset_link.issued', entityType: 'User', entityId: user.id,
        summary: 'A one-time password reset link was issued by an authorised operator',
        metadata: { expiresAt, delivery: 'private_operator_handoff' },
      },
    });
  });
  process.stdout.write(`${origin}/reset-password#token=${encodeURIComponent(token)}\n`);
}

main().catch((error) => { console.error(error.message || error); process.exitCode = 1; }).finally(() => prisma.$disconnect());

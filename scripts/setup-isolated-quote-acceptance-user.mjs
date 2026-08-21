import bcrypt from 'bcrypt';
import { PrismaClient } from '@prisma/client';

if (process.env.ALLOW_MUTATING_ACCEPTANCE !== 'true') {
  throw new Error('Refusing to provision a test identity outside an isolated acceptance database.');
}

const email = String(process.env.TEST_EMAIL || '').trim().toLowerCase();
const password = String(process.env.TEST_PASSWORD || '');
if (!email.endsWith('@marblepark.test') || password.length < 16) {
  throw new Error('A .test email and a generated password of at least 16 characters are required.');
}

const prisma = new PrismaClient();
try {
  const passwordHash = await bcrypt.hash(password, 12);
  const existing = await prisma.user.findUnique({ where: { email } });
  const user = existing
    ? await prisma.user.update({
        where: { email },
        data: { passwordHash, active: true, role: 'owner', permissionOverrides: {}, passwordChangedAt: new Date() },
      })
    : await prisma.user.create({
        data: {
          id: `QUOTE-ACCEPTANCE-${Date.now().toString(36).toUpperCase()}`,
          email,
          passwordHash,
          name: 'Quote Acceptance Owner',
          role: 'owner',
          phone: '9000000080',
          active: true,
          permissionOverrides: {},
          passwordChangedAt: new Date(),
        },
      });
  await prisma.session.deleteMany({ where: { userId: user.id } });
  console.log(JSON.stringify({ ok: true, userId: user.id, role: user.role }));
} finally {
  await prisma.$disconnect();
}

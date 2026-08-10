import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { PrismaClient } = require('@prisma/client');
const { ulid } = require('ulid');

const SOURCE_DATABASE_NAME = String(process.env.SOURCE_DATABASE_NAME || '').trim();
const SOURCE_DATABASE_URL = process.env.SOURCE_DATABASE_URL || (() => {
  if (!process.env.DATABASE_URL || !SOURCE_DATABASE_NAME) return '';
  const url = new URL(process.env.DATABASE_URL);
  url.pathname = `/${SOURCE_DATABASE_NAME}`;
  return url.toString();
})();
const OWNER_EMAIL = String(process.env.BOOTSTRAP_OWNER_EMAIL || '').trim().toLowerCase();
const SOURCE_BACKUP = String(process.env.CREDENTIAL_RESTORE_SOURCE || '').trim();
const MODE = process.env.CREDENTIAL_RESTORE_MODE === 'verify' ? 'verify' : 'restore';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const current = new PrismaClient();
const source = new PrismaClient({ datasources: { db: { url: SOURCE_DATABASE_URL } } });

async function selectedUser(client) {
  return client.user.findUnique({
    where: { email: OWNER_EMAIL },
    select: {
      id: true,
      email: true,
      role: true,
      active: true,
      passwordHash: true,
      passwordChangedAt: true,
    },
  });
}

async function main() {
  assert(SOURCE_DATABASE_URL, 'SOURCE_DATABASE_URL or SOURCE_DATABASE_NAME with DATABASE_URL is required');
  assert(OWNER_EMAIL, 'BOOTSTRAP_OWNER_EMAIL is required');
  assert(SOURCE_BACKUP, 'CREDENTIAL_RESTORE_SOURCE is required');

  const [sourceUser, currentUser] = await Promise.all([selectedUser(source), selectedUser(current)]);
  assert(sourceUser, 'Owner account is absent from the credential-recovery backup');
  assert(currentUser, 'Owner account is absent from the current production database');
  assert(sourceUser.email === currentUser.email, 'Source and current owner identities do not match');
  assert(['owner', 'admin'].includes(sourceUser.role) && ['owner', 'admin'].includes(currentUser.role), 'Credential recovery is restricted to an owner or administrator account');
  assert(sourceUser.active && currentUser.active, 'Credential recovery requires active source and current accounts');
  assert(/^\$2[aby]\$/.test(sourceUser.passwordHash), 'Backup credential hash is not a supported bcrypt value');

  if (MODE === 'verify') {
    assert(currentUser.passwordHash === sourceUser.passwordHash, 'Current credential does not match the approved recovery backup');
    assert(
      currentUser.passwordChangedAt?.toISOString?.() === sourceUser.passwordChangedAt?.toISOString?.(),
      'Current password-change timestamp does not match the approved recovery backup',
    );
    console.log(JSON.stringify({
      ok: true,
      mode: 'verify',
      ownerCredentialState: 'matches approved backup',
      sourceBackup: SOURCE_BACKUP,
      sensitiveValuesPrinted: false,
    }, null, 2));
    return;
  }

  const sessionsRevoked = await current.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: currentUser.id },
      data: {
        passwordHash: sourceUser.passwordHash,
        passwordChangedAt: sourceUser.passwordChangedAt,
      },
    });
    const sessions = await tx.session.deleteMany({ where: { userId: currentUser.id } });
    await tx.auditEvent.create({
      data: {
        id: ulid(),
        actorUserId: currentUser.id,
        action: 'auth.credential.recovery',
        entityType: 'User',
        entityId: currentUser.id,
        summary: 'Restored owner credential state after deployment seed regression',
        metadata: {
          sourceBackup: SOURCE_BACKUP,
          sessionsRevoked: sessions.count,
          preservedCommercialData: true,
          credentialMaterialLogged: false,
        },
      },
    });
    return sessions.count;
  });

  const restored = await selectedUser(current);
  assert(restored?.passwordHash === sourceUser.passwordHash, 'Credential recovery verification failed');
  assert(
    restored.passwordChangedAt?.toISOString?.() === sourceUser.passwordChangedAt?.toISOString?.(),
    'Password-change timestamp recovery verification failed',
  );

  console.log(JSON.stringify({
    ok: true,
    mode: 'restore',
    ownerCredentialState: 'restored from approved backup',
    sourceBackup: SOURCE_BACKUP,
    sessionsRevoked,
    auditEvent: 'auth.credential.recovery',
    commercialRecordsChanged: false,
    sensitiveValuesPrinted: false,
  }, null, 2));
}

main()
  .catch((error) => {
    console.error(error.stack || error.message || error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await Promise.allSettled([current.$disconnect(), source.$disconnect()]);
  });

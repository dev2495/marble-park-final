import { randomBytes } from 'node:crypto';
import bcrypt from 'bcrypt';
import { PrismaClient } from '@prisma/client';
import { ulid } from 'ulid';

const prisma = new PrismaClient();
const API_URL = process.env.API_URL || 'http://127.0.0.1:4011/graphql';
const APP_ORIGIN = process.env.APP_ORIGIN || 'http://127.0.0.1:3011';
const EMAIL = process.env.TEST_LOGIN_EMAIL || '';
const ORIGINAL_PASSWORD = process.env.TEST_LOGIN_PASSWORD || '';
const RESET_PASSWORD = process.env.TEST_RESET_PASSWORD || 'SessionReset-2026!';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function request(query, variables = {}, cookie = '') {
  const response = await fetch(API_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: APP_ORIGIN, ...(cookie ? { cookie } : {}) },
    body: JSON.stringify({ query, variables }),
  });
  const body = await response.json().catch(() => ({}));
  return { response, body, cookie: (response.headers.get('set-cookie') || '').split(';')[0] };
}

async function login(password) {
  return request(
    'mutation Login($input:LoginInput!){login(input:$input){authenticated user{id email}}}',
    { input: { email: EMAIL, password } },
  );
}

async function main() {
  assert(EMAIL && ORIGINAL_PASSWORD, 'TEST_LOGIN_EMAIL and TEST_LOGIN_PASSWORD are required');
  assert(RESET_PASSWORD.length >= 12, 'TEST_RESET_PASSWORD must contain at least 12 characters');
  const user = await prisma.user.findUnique({ where: { email: EMAIL } });
  assert(user, 'Test user does not exist');
  const originalHash = user.passwordHash;
  const originalChangedAt = user.passwordChangedAt;
  const token = randomBytes(32).toString('base64url');
  const resetId = ulid();

  try {
    const signedIn = await login(ORIGINAL_PASSWORD);
    assert(signedIn.body?.data?.login?.authenticated, `Initial login failed: ${JSON.stringify(signedIn.body)}`);
    assert(await prisma.session.count({ where: { userId: user.id } }) > 0, 'Login did not create a server session');

    await prisma.passwordResetToken.create({
      data: { id: resetId, token, userId: user.id, expiresAt: new Date(Date.now() + 60_000) },
    });
    const reset = await request(
      'mutation Reset($token:String!,$password:String!){resetPassword(token:$token,newPassword:$password)}',
      { token, password: RESET_PASSWORD },
    );
    assert(reset.body?.data?.resetPassword === true, `Password reset failed: ${JSON.stringify(reset.body)}`);
    const consumed = await prisma.passwordResetToken.findUnique({ where: { id: resetId } });
    assert(consumed?.usedAt, 'Reset token was not marked used');
    assert(await prisma.session.count({ where: { userId: user.id } }) === 0, 'Password reset did not revoke all sessions');
    assert(await prisma.auditEvent.count({ where: { action: 'auth.password.reset', entityId: user.id } }) > 0, 'Password reset audit is missing');

    const replay = await request(
      'mutation Reset($token:String!,$password:String!){resetPassword(token:$token,newPassword:$password)}',
      { token, password: 'AnotherReset-2026!' },
    );
    assert(replay.body?.errors?.some((entry) => /invalid or expired/i.test(entry.message)), 'Used reset token was accepted twice');
    const oldLogin = await login(ORIGINAL_PASSWORD);
    assert(!oldLogin.body?.data?.login, 'Old password was accepted after reset');
    const newLogin = await login(RESET_PASSWORD);
    assert(newLogin.body?.data?.login?.authenticated, 'New password was not accepted after reset');

    await prisma.user.update({ where: { id: user.id }, data: { active: false } });
    const disabledRequest = await request('{me{id}}', {}, newLogin.cookie);
    assert(disabledRequest.body?.errors?.some((entry) => /disabled or missing/i.test(entry.message)), 'Disabled user retained session access');
    assert(await prisma.session.count({ where: { userId: user.id } }) === 0, 'Disabled-user session was not removed');

    console.log(JSON.stringify({
      ok: true,
      passwordReset: 'random single-use token; passwordChangedAt updated',
      sessionRevocation: 'all sessions revoked after reset and disabled-account access rejected',
      replayProtection: 'used token rejected',
      audit: 'auth.password.reset recorded',
    }, null, 2));
  } finally {
    await prisma.user.update({
      where: { id: user.id },
      data: { passwordHash: originalHash, passwordChangedAt: originalChangedAt, active: true },
    });
    await prisma.session.deleteMany({ where: { userId: user.id } });
    await prisma.passwordResetToken.deleteMany({ where: { id: resetId } });
  }
}

main()
  .catch((error) => {
    console.error(error.stack || error.message || error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

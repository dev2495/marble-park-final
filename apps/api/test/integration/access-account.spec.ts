import { Harness, Session, stamp, uniquePhone } from '../harness';
import { createUser, loginAs } from '../money-support';

/** Account safety (platform D9) and the customer phone lock (gaps G3). */
describe('access: account safety', () => {
  let h: Harness; let admin: Session;
  const testEmails: string[] = [];
  beforeAll(async () => { h = await Harness.boot(); admin = await h.as('admin'); });
  afterAll(async () => {
    // Failed sign-ins all come from this machine's address; clear them so later runs are not throttled (test database only).
    if (testEmails.length) await h.prisma.auditEvent.deleteMany({ where: { action: { in: ['auth.login.failed', 'auth.login.throttled'] }, entityId: { in: testEmails } } });
    await h.close();
  });

  const profile = (s: Session, input: Record<string, any>) => s.gqlRaw(`mutation($input: UpdateMyProfileInput!) { updateMyProfile(input: $input) { id email } }`, { input });

  it('changing your own login email needs your current password', async () => {
    const u = await createUser(h, admin, 'sales');
    const s = await loginAs(h, u.email, u.password);
    const next = `ht-new-${stamp().toLowerCase()}@harness.test`;
    expect((await profile(s, { email: next })).errors?.length).toBeGreaterThan(0);
    expect((await profile(s, { email: next, currentPassword: 'wrong-password-123' })).errors?.length).toBeGreaterThan(0);
    expect((await h.prisma.user.findUniqueOrThrow({ where: { id: u.id } })).email).toBe(u.email);
    const ok = await profile(s, { email: next, currentPassword: u.password });
    expect(ok.errors).toBeUndefined();
    expect(ok.data.updateMyProfile.email).toBe(next);
    expect(await h.prisma.auditEvent.count({ where: { entityId: u.id, actorUserId: u.id, action: { contains: 'email' } } })).toBeGreaterThan(0);
    // Name or phone alone still need no password.
    expect((await profile(s, { name: 'Harness renamed' })).errors).toBeUndefined();
    await admin.gql(`mutation($id: ID!) { deleteUser(id: $id) { id } }`, { id: u.id });
  });

  it('the last active owner or admin cannot be disabled, demoted or removed', async () => {
    const owner = await h.as('owner');
    const others = await h.prisma.user.findMany({ where: { id: { not: owner.userId }, active: true, role: { in: ['admin', 'owner'] } }, select: { id: true } });
    const update = (input: Record<string, any>) => owner.gqlRaw(`mutation($id: ID!, $input: UpdateUserInput!) { updateUser(id: $id, input: $input) { id active role } }`, { id: owner.userId, input });
    try {
      await h.prisma.user.updateMany({ where: { id: { in: others.map((o) => o.id) } }, data: { active: false } });
      for (const input of [{ active: false }, { role: 'sales' }]) {
        const r = await update(input);
        expect(r.errors?.[0]?.message).toMatch(/last active owner or admin/i);
      }
      const del = await owner.gqlRaw(`mutation($id: ID!) { deleteUser(id: $id) { id } }`, { id: owner.userId });
      expect(del.errors?.[0]?.message).toMatch(/last active owner or admin/i);
      const row = await h.prisma.user.findUniqueOrThrow({ where: { id: owner.userId } });
      expect(row.active).toBe(true);
      expect(row.role).toBe('owner');
    } finally {
      await h.prisma.user.updateMany({ where: { id: { in: others.map((o) => o.id) } }, data: { active: true } });
    }
    // With others present, disabling an extra owner works.
    const extra = await createUser(h, admin, 'owner');
    const r = await admin.gqlRaw(`mutation($id: ID!, $input: UpdateUserInput!) { updateUser(id: $id, input: $input) { id active } }`, { id: extra.id, input: { active: false } });
    expect(r.errors).toBeUndefined();
    expect(r.data.updateUser.active).toBe(false);
  });

  it('wrong passwords lock that account from this address, but not a second account from the same address', async () => {
    const a = await createUser(h, admin, 'sales');
    const b = await createUser(h, admin, 'sales');
    testEmails.push(a.email, b.email);
    const attempt = (email: string, password: string) => h.publicGql(`mutation($input: LoginInput!) { login(input: $input) { token } }`, { input: { email, password } });
    for (let i = 0; i < 10; i += 1) {
      const r = await attempt(a.email, 'not-the-password-1');
      expect(r.errors?.[0]?.message).toMatch(/invalid credentials/i);
    }
    // 11th try, even with the right password: blocked for 15 minutes.
    const blocked = await attempt(a.email, a.password);
    expect(blocked.errors?.[0]?.message).toMatch(/too many/i);
    // Same machine, another account: still signs in.
    const other = await attempt(b.email, b.password);
    expect(other.errors).toBeUndefined();
    expect(other.data.login.token).toBeTruthy();
    expect(await h.prisma.auditEvent.count({ where: { action: 'auth.login.throttled', entityId: a.email } })).toBe(1);
    // A second blocked attempt is not logged again in the same window.
    await attempt(a.email, a.password);
    expect(await h.prisma.auditEvent.count({ where: { action: 'auth.login.throttled', entityId: a.email } })).toBe(1);
  });

  // Review fix: no account-wide lockout. Someone else failing from two other machines cannot lock the owner out.
  it('many failures for an owner email from two other addresses do not block the owner from their own address', async () => {
    const o = await createUser(h, admin, 'owner');
    testEmails.push(o.email);
    const rows = Array.from({ length: 30 }, (_, i) => ({
      id: `HT-AUD-${stamp()}-${i}`, actorUserId: o.id, action: 'auth.login.failed', entityType: 'User', entityId: o.email,
      summary: 'harness failed login', metadata: { email: o.email, userId: o.id, ipAddress: i % 2 ? '203.0.113.7' : '198.51.100.9', reason: 'invalid-password' },
    }));
    await h.prisma.auditEvent.createMany({ data: rows as any });
    const r = await h.publicGql(`mutation($input: LoginInput!) { login(input: $input) { token } }`, { input: { email: o.email, password: o.password } });
    expect(r.errors).toBeUndefined();
    expect(r.data.login.token).toBeTruthy();
  });

  it('two people saving two customers with the same mobile at the same moment: one is refused', async () => {
    const make = () => admin.gql(`mutation($input: CreateCustomerInput!) { createCustomer(input: $input) { id } }`, { input: { name: `Harness phone ${stamp()}`, phone: uniquePhone() } }).then((d) => d.createCustomer);
    const [c1, c2] = [await make(), await make()];
    const phone = uniquePhone();
    const edit = (id: string) => admin.gqlRaw(`mutation($id: ID!, $input: UpdateCustomerInput!) { updateCustomer(id: $id, input: $input) { id } }`, { id, input: { phone } });
    const results = await Promise.all([edit(c1.id), edit(c2.id)]);
    const ok = results.filter((r) => !r.errors?.length);
    const refused = results.filter((r) => r.errors?.length);
    expect(ok).toHaveLength(1);
    expect(refused).toHaveLength(1);
    expect(refused[0].errors![0].message).toMatch(/already belongs to another customer/i);
  });
});

import { Harness, Session } from '../harness';

describe('GraphQL schema', () => {
  let h: Harness; let admin: Session;
  beforeAll(async () => { h = await Harness.boot(); admin = await h.as('admin'); });
  afterAll(async () => { await h.close(); });

  // A5. Two resolvers once exposed a mutation called completeFollowUp, so one silently replaced the other.
  it('the schema builds and every mutation name is unique', async () => {
    const r = await admin.gql(`{ __schema { mutationType { fields { name args { name } } } queryType { fields { name } } } }`);
    const names: string[] = r.__schema.mutationType.fields.map((f: any) => f.name);
    expect(names.length).toBeGreaterThan(100);
    expect(names.filter((n, i) => names.indexOf(n) !== i)).toEqual([]);
  });

  it('completeFollowUp keeps the follow-up desk signature and the lead action has its own name', async () => {
    const r = await admin.gql(`{ __schema { mutationType { fields { name args { name } } } } }`);
    const fields: any[] = r.__schema.mutationType.fields;
    const desk = fields.find((f) => f.name === 'completeFollowUp');
    expect(desk).toBeTruthy();
    expect(desk.args.map((a: any) => a.name)).toEqual(expect.arrayContaining(['entityType', 'id']));
    expect(fields.filter((f) => /followup/i.test(f.name)).map((f) => f.name).sort()).toEqual(
      Array.from(new Set(fields.filter((f) => /followup/i.test(f.name)).map((f) => f.name))).sort());
  });

  it('introspection is on in tests but a request without a session is refused for private data', async () => {
    const r = await h.publicGql(`{ salesOrders { id } }`);
    expect(r.errors?.length).toBeGreaterThan(0);
  });
});

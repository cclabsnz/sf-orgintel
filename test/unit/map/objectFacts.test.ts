import { describe, it, expect } from '@jest/globals';
import type { CouplingOperation, GraphUnavailable } from '@cclabsnz/sf-core';
import { collectObjectFacts } from '../../../src/map/objectFacts.js';
import { fetchSObjectCatalog } from '../../../src/probe/sobjectCatalog.js';
import { mockRest, mockSoql, mockTooling, noopMetadata } from '../helpers/mocks.js';
import type { IntelContext } from '../../../src/lib/wire.js';
import type { ToolingClient, RestClient } from '@cclabsnz/sf-core';

/**
 * The facts sf-core's classifyObject decides from, gathered for the coupled objects only:
 * the global describe the run already fetches, one EntityDefinition query for sharing models,
 * and a few describes to read what the system fields point at. OBJECT_ROLES_SPEC 3. Each read can
 * be refused, and each refusal degrades to fewer facts plus a coverage entry, never to a guess.
 */
const GLOBAL = [
  { name: 'Account', layoutable: true, triggerable: true },
  { name: 'Case', layoutable: true, triggerable: true },
  { name: 'AccountShare', layoutable: false, triggerable: false, associateParentEntity: 'Account' },
  { name: 'Org_Defaults__c', layoutable: false, triggerable: false, customSetting: true },
];
const DESCRIBES = {
  Account: {
    fields: [
      { name: 'OwnerId', referenceTo: ['User'] },
      { name: 'CreatedById', referenceTo: ['User'] },
      { name: 'LastModifiedById', referenceTo: ['User'] },
      { name: 'RecordTypeId', referenceTo: ['RecordType'] },
    ],
  },
  Case: { fields: [{ name: 'OwnerId', referenceTo: ['Group', 'User'] }] },
};
const sharing = (q: string) => q.includes('FROM EntityDefinition');

function ctx(rest: RestClient, tooling: ToolingClient): IntelContext {
  return {
    soql: mockSoql([]),
    tooling,
    rest,
    metadata: noopMetadata,
    orgInfo: null,
    apiVersion: '62.0',
    namespace: null,
  };
}

async function run(rest: RestClient, tooling: ToolingClient, ops = new Map<string, Set<CouplingOperation>>()) {
  const catalog = await fetchSObjectCatalog(mockRest(GLOBAL));
  const unavailable: GraphUnavailable[] = [];
  const notes: string[] = [];
  const result = await collectObjectFacts(ctx(rest, tooling), catalog, ['Account', 'AccountShare', 'Case', 'Org_Defaults__c'], ops, notes, unavailable);
  return { ...result, unavailable, notes };
}

describe('collectObjectFacts', () => {
  const tooling = mockTooling([
    { test: sharing, records: [
      { QualifiedApiName: 'Account', InternalSharingModel: 'Private' },
      { QualifiedApiName: 'Case', InternalSharingModel: 'Read' },
    ] },
  ]);

  it('carries the global describe facts and the sharing models through', async () => {
    const { facts, unavailable } = await run(mockRest(GLOBAL, DESCRIBES), tooling);

    expect(facts.get('AccountShare')).toMatchObject({ associateParentEntity: 'Account', layoutable: false, triggerable: false });
    expect(facts.get('Org_Defaults__c')?.customSetting).toBe(true);
    expect(facts.get('Account')?.sharingModel).toBe('Private');
    expect(unavailable).toEqual([]);
  });

  it('reads the actor and qualifier targets from the system fields, not from names', async () => {
    const { targets } = await run(mockRest(GLOBAL, DESCRIBES), tooling);

    expect([...targets.actors].sort()).toEqual(['Group', 'User']);
    expect([...targets.qualifiers]).toEqual(['RecordType']);
  });

  it('marks an object read-only only when production automation touches it and only reads', async () => {
    const ops = new Map<string, Set<CouplingOperation>>([['Case', new Set(['read'])], ['Account', new Set(['read', 'update'])]]);
    const { facts } = await run(mockRest(GLOBAL, DESCRIBES), tooling, ops);

    expect(facts.get('Case')?.readOnlyInAutomation).toBe(true);
    expect(facts.get('Account')?.readOnlyInAutomation).toBe(false);
    expect(facts.get('AccountShare')?.readOnlyInAutomation).toBeUndefined();
  });

  it('records a refused sharing-model read, and leaves sharing models unread', async () => {
    const refused = mockTooling([{ test: sharing, error: new Error('INSUFFICIENT_ACCESS') }]);
    const { facts, unavailable } = await run(mockRest(GLOBAL, DESCRIBES), refused);

    expect(facts.get('Account')?.sharingModel).toBeUndefined();
    expect(facts.get('Account')?.layoutable).toBe(true);
    expect(unavailable.map((u) => `${u.scope}:${u.reason}`)).toEqual(['map.objectRoles.sharingModel:failed']);
  });

  it('records refused system-field describes, and leaves the targets empty rather than assumed', async () => {
    const { targets, unavailable } = await run(mockRest(GLOBAL, {}), tooling);

    expect(targets.actors.size).toBe(0);
    expect(targets.qualifiers.size).toBe(0);
    expect(unavailable.map((u) => `${u.scope}:${u.reason}`)).toEqual(['map.objectRoles.systemFields:failed']);
  });

  it('puts only valid API names into the EntityDefinition query, never escaped text', async () => {
    // An API name is letters, digits and underscores. Anything else is refused outright rather
    // than escaped, so no quoting rule has to be complete for the query to be safe.
    const seen: string[] = [];
    const recording = mockTooling([{ test: (q) => { seen.push(q); return sharing(q); }, records: [] }]);
    const catalog = await fetchSObjectCatalog(mockRest(GLOBAL));
    await collectObjectFacts(ctx(mockRest(GLOBAL, DESCRIBES), recording), catalog, ['Account', "Bad'Name", 'Back\\slash'], new Map(), [], []);

    const q = seen.find(sharing)!;
    expect(q).toContain("'Account'");
    expect(q).not.toContain('Bad');
    expect(q).not.toContain('slash');
  });
});


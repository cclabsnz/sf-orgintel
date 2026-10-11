import { describe, it, expect } from '@jest/globals';
import type { CouplingOperation, ObjectFacts, PlatformTargets } from '@cclabsnz/sf-core';
import { buildObjectRoles, foldCompanions, splitCouplings, operationsByObject } from '../../../src/map/graph/roles.js';
import { mergeEdges } from '../../../src/map/graph/couplingGraph.js';
import type { RawEdge } from '../../../src/map/types.js';

/**
 * OBJECT_ROLES_SPEC 2.3: companions fold into their parent before pairs are formed, only pairs
 * between business objects stay couplings, and every other pair is kept as context rather than
 * dropped. An object whose role could not be decided is treated as a possible business object:
 * nothing is moved out of the couplings without evidence that it is not one.
 */
const targets: PlatformTargets = { actors: new Set(['User']), qualifiers: new Set(['RecordType']) };
const business: ObjectFacts = { layoutable: true, triggerable: true, sharingModel: 'Private' };
const facts = new Map<string, ObjectFacts>([
  ['Account', business],
  ['Case', business],
  ['AccountShare', { layoutable: false, triggerable: false, associateParentEntity: 'Account' }],
  ['User', business],
  ['RecordType', { layoutable: false, triggerable: false }],
]);
const roles = buildObjectRoles(facts, targets);

const raw = (a: string, b: string, name: string): RawEdge => ({
  a,
  b,
  operations: ['read'],
  component: { type: 'ApexClass', name, confidence: 'high', namespace: null },
  directed: false,
});

describe('foldCompanions', () => {
  it('renames a companion to its parent, so a component touching both counts once', () => {
    const merged = mergeEdges(
      foldCompanions([raw('Case', 'AccountShare', 'Svc'), raw('Case', 'Account', 'Svc'), raw('Account', 'AccountShare', 'Svc')], roles),
    );

    expect(merged).toHaveLength(1);
    expect([merged[0].from, merged[0].to]).toEqual(['Account', 'Case']);
    expect(merged[0].weight).toBe(1);
  });
});

describe('splitCouplings', () => {
  it('keeps business↔business as couplings and moves the rest to context, labelled with roles', () => {
    const merged = mergeEdges([raw('Account', 'Case', 'A'), raw('Account', 'User', 'B'), raw('Case', 'RecordType', 'C')]);
    const { couplings, context } = splitCouplings(merged, roles);

    expect(couplings.map((e) => `${e.from}|${e.to}`)).toEqual(['Account|Case']);
    expect(context.map((e) => `${e.from}|${e.to}|${e.roles.join('/')}`).sort()).toEqual([
      'Account|User|entity/actor',
      'Case|RecordType|entity/qualifier',
    ]);
  });

  it('keeps an object it could not classify among the couplings', () => {
    const merged = mergeEdges([raw('Account', 'Invoice__c', 'A')]);
    const { couplings, context } = splitCouplings(merged, roles);

    expect(couplings).toHaveLength(1);
    expect(context).toHaveLength(0);
    expect(roles.decide('Invoice__c').role).toBe('unclassified');
  });
});

describe('operationsByObject', () => {
  it('unions what production components do to each object', () => {
    const touch = (entries: Array<[string, CouplingOperation[]]>) =>
      new Map<string, Set<CouplingOperation>>(entries.map(([o, ops]) => [o, new Set(ops)]));
    const ops = operationsByObject([touch([['CodeSet', ['read']], ['Case', ['update']]]), touch([['CodeSet', ['read']]])]);

    expect([...ops.get('CodeSet')!]).toEqual(['read']);
    expect([...ops.get('Case')!]).toEqual(['update']);
  });
});

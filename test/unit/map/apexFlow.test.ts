import { describe, it, expect } from '@jest/globals';
import { deriveApexEdges } from '../../../src/map/apex/apexEdges.js';
import type { ApexClassInput } from '../../../src/map/apex/apexTypes.js';

/**
 * A class that reads one object and writes another is describing a data flow: values come from
 * the thing it queries and land in the thing it inserts or updates. That is direction, and it
 * was being discarded — the two objects' operation sets were unioned together before the edge
 * was built, so "read Account, insert Case" became an undirected pair carrying both verbs.
 *
 * This matters for coverage, not elegance: record-triggered flows and triggers are a small
 * minority of the evidence, so without this almost every coupling reports its order as unknown.
 */
const known = new Set(['Account', 'Case', 'Contact', 'Opportunity']);

const cls = (name: string, body: string): ApexClassInput => ({
  name, namespace: null, body, symbolTable: null,
});

function edgeFor(edges: ReturnType<typeof deriveApexEdges>, a: string, b: string) {
  return edges.find((e) => (e.a === a && e.b === b) || (e.a === b && e.b === a));
}

describe('deriveApexEdges — data flow from reads to writes', () => {
  it('directs the edge from the object read to the object written', () => {
    const edges = deriveApexEdges(
      [cls('Svc', 'List<Account> a = [SELECT Id FROM Account]; Case c = new Case(); insert c;')],
      [], known,
    );

    const e = edgeFor(edges, 'Account', 'Case')!;
    expect(e).toBeDefined();
    expect(e.directed).toBe(true);
    expect(e.a).toBe('Account'); // read side is the source
    expect(e.b).toBe('Case');
  });

  it('directs the other way when the roles are reversed', () => {
    const edges = deriveApexEdges(
      [cls('Svc', 'List<Case> c = [SELECT Id FROM Case]; Account a = new Account(); update a;')],
      [], known,
    );

    const e = edgeFor(edges, 'Account', 'Case')!;
    expect(e.directed).toBe(true);
    expect(e.a).toBe('Case');
    expect(e.b).toBe('Account');
  });

  it('leaves the edge undirected when both objects are only read', () => {
    const edges = deriveApexEdges(
      [cls('Svc', 'List<Account> a = [SELECT Id FROM Account]; List<Case> c = [SELECT Id FROM Case];')],
      [], known,
    );

    expect(edgeFor(edges, 'Account', 'Case')!.directed).toBeFalsy();
  });

  it('leaves the edge undirected when both objects are written', () => {
    // Two writes give no ordering: nothing says which happened first.
    const edges = deriveApexEdges(
      [cls('Svc', 'Account a = new Account(); insert a; Case c = new Case(); insert c;')],
      [], known,
    );

    expect(edgeFor(edges, 'Account', 'Case')!.directed).toBeFalsy();
  });

  it('keeps the operations of both objects on the edge', () => {
    const edges = deriveApexEdges(
      [cls('Svc', 'List<Account> a = [SELECT Id FROM Account]; Case c = new Case(); insert c;')],
      [], known,
    );

    const e = edgeFor(edges, 'Account', 'Case')!;
    expect(e.operations).toContain('read');
    expect(e.operations).toContain('create');
  });
});

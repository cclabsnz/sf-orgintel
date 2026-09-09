// The fragment is sf-orgintel's half of one canonical graph: the automation it parsed, and the
// couplings that parsing established. It deliberately does not carry the objects those couplings
// join -- sf-orgviz owns `sobject`, and a fragment emitting a kind it does not own is refused by
// the merge. See sf-orgviz/docs/CONVERGENCE_SPEC.md sections 1.1 and 3.2.
import { describe, it, expect } from '@jest/globals';
import { ownerOfKind, isKnownGraphKind, type GraphNodeKind } from '@cclabsnz/sf-core';
import { buildMapFragment } from '../../../src/map/fragment.js';

// One org, described once. `test/unit/map/fixtures/input.ts` is a new shared helper holding the
// `FragmentInput` built from the same Flow XML fixtures and the same AcctContactSync class that
// test/unit/map/assemble.test.ts and the golden suite use, so all three suites describe the same
// org rather than three subtly different ones. Extract it from assemble.test.ts's existing
// `assemble()` helper; it needs the `edges` that `mergeEdges` produced, plus `capturedAt:
// '2026-01-01T00:00:00Z'` and `orgId: 'org1'` fixed so the determinism test means something.
import { input } from './fixtures/input.js';

const fragment = () => buildMapFragment(input());

describe('buildMapFragment', () => {
  it('names sf-orgintel as its producer', () => {
    // Without this the merge's ownership rule fails every node: it compares owner === producer,
    // and an unnamed fragment matches nothing.
    expect(fragment().producer).toBe('orgintel');
  });

  it('emits only kinds sf-orgintel owns', () => {
    for (const n of fragment().nodes) {
      expect(isKnownGraphKind(n.kind)).toBe(true);
      expect(ownerOfKind(n.kind as GraphNodeKind)).toBe('orgintel');
    }
  });

  it('carries no object nodes, because sf-orgviz owns them', () => {
    expect(fragment().nodes.filter((n) => n.id.startsWith('obj.'))).toEqual([]);
  });

  it('joins object pairs with a couples edge carrying the coupling evidence', () => {
    const couples = fragment().edges.filter((e) => e.kind === 'couples');
    expect(couples.length).toBeGreaterThan(0);
    for (const e of couples) {
      expect(e.from.startsWith('obj.')).toBe(true);
      expect(e.to.startsWith('obj.')).toBe(true);
      expect(typeof e.attrs.weight).toBe('number');
      expect(Array.isArray(e.attrs.operations)).toBe(true);
      expect(Array.isArray(e.attrs.components)).toBe(true);
    }
  });

  it('contributes the measurements it took, rather than inventing nodes to hold them', () => {
    // recordCount90d and automationCounts are facts about an object node sf-orgviz owns. A
    // measurement needs a measurer, so they travel as namespaced contributions. Spec 3.3.
    const c = fragment().contributions ?? [];
    expect(c.length).toBeGreaterThan(0);
    for (const entry of c) {
      expect(entry.nodeId.startsWith('obj.')).toBe(true);
      expect(entry.attrs).toHaveProperty('recordCount90d');
      expect(entry.attrs).toHaveProperty('automationCounts');
    }
  });

  it('is deterministic — the same input twice gives identical bytes', () => {
    expect(JSON.stringify(buildMapFragment(input()))).toBe(JSON.stringify(buildMapFragment(input())));
  });
});

// anatomy's half of one canonical graph. It emits only kinds sf-orgintel owns; everything it
// knows about an object, a profile or the org itself travels as a namespaced contribution,
// because those nodes belong to sf-orgviz. See sf-orgviz/docs/CONVERGENCE_SPEC.md 3.3 and 4.2.
import { describe, it, expect } from '@jest/globals';
import { ownerOfKind, isKnownGraphKind, type GraphNodeKind } from '@cclabsnz/sf-core';
import { buildAnatomyFragment } from '../../../src/anatomy/fragment.js';
import { input } from './fixtures/input.js';

const fragment = () => buildAnatomyFragment(input());

describe('buildAnatomyFragment', () => {
  it('names sf-orgintel as its producer', () => {
    expect(fragment().producer).toBe('orgintel');
  });

  it('emits only kinds sf-orgintel owns', () => {
    for (const n of fragment().nodes) {
      expect(isKnownGraphKind(n.kind)).toBe(true);
      expect(ownerOfKind(n.kind as GraphNodeKind)).toBe('orgintel');
    }
  });

  it('emits no node for an entity another producer owns', () => {
    // Objects, profiles and the org itself are sf-orgviz's. A fragment emitting one is refused
    // by the merge on ownership, which would take the whole graph with it.
    const ids = fragment().nodes.map((n) => n.id);
    expect(ids.filter((id) => /^(obj|profile|org)\./.test(id))).toEqual([]);
  });

  it('marks products as derived, with a rule naming what mined them', () => {
    // A product is not declared anywhere in the org -- it is inferred from component name
    // prefixes. Calling that metadata would present an inference as an observation.
    for (const n of fragment().nodes.filter((x) => x.kind === 'product')) {
      expect(n.provenance.source).toBe('derived');
      expect(n.provenance.rule).toBeTruthy();
    }
  });

  it('contributes persona measurements to the profile node that already exists', () => {
    const c = (fragment().contributions ?? []).filter((x) => x.nodeId.startsWith('profile.'));
    expect(c.length).toBeGreaterThan(0);
    expect(c[0].attrs).toHaveProperty('activeUsers');
  });

  it('contributes org-wide counts to org.root rather than inventing a node for them', () => {
    const org = (fragment().contributions ?? []).filter((x) => x.nodeId === 'org.root');
    expect(org).toHaveLength(1);
    expect(org[0].attrs).toHaveProperty('lwc');
    expect(org[0].attrs).toHaveProperty('loginsByType');
  });

  it('emits nodes, edges and contributions in a fixed order', () => {
    // Asserted as sortedness, not as two runs agreeing: identical inputs iterate identically in
    // one process, so a two-run comparison passes with every sort removed.
    const f = fragment();
    const ids = f.nodes.map((n) => n.id);
    expect(ids).toEqual([...ids].sort());
    const contribs = (f.contributions ?? []).map((c) => c.nodeId);
    expect(contribs).toEqual([...contribs].sort());
  });
});

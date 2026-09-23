import { describe, it, expect } from '@jest/globals';
import { buildMapFragment } from '../../../src/map/fragment.js';
import { couplingViewOf } from '../../../src/report/couplingView.js';
import { input } from '../map/fixtures/input.js';

const view = () => couplingViewOf(buildMapFragment(input()));

describe('couplingViewOf', () => {
  it('lists an object per contribution, with the obj. prefix stripped', () => {
    for (const n of view().nodes) {
      expect(n.object.startsWith('obj.')).toBe(false);
      expect(n.object.length).toBeGreaterThan(0);
    }
    expect(view().nodes.length).toBeGreaterThan(0);
  });

  it('carries the per-object measurements the report prints', () => {
    const account = view().nodes.find((n) => n.object === 'Account');

    expect(account?.recordCount90d).toBe(100);
    expect(account?.automationCounts.flows).toBe(1);
  });

  it('assigns every object a layer, since the fragment stores none', () => {
    // CouplingGraphNode carried `layer`; contributions do not. Both renderers already fall back
    // to roleOf(object), so the adapter resolves it once rather than leaving it undefined.
    for (const n of view().nodes) expect(typeof n.layer).toBe('string');
  });

  it('shapes couples edges exactly like CouplingGraphEdge, so edgeConfidence still works', () => {
    const e = view().edges[0];

    expect(e.from.startsWith('obj.')).toBe(false);
    expect(typeof e.weight).toBe('number');
    expect(Array.isArray(e.components)).toBe(true);
    expect(e.components[0]).toHaveProperty('confidence');
  });

  it('ignores edges that are not couples', () => {
    // The fragment also carries `touches` edges from automation to object. The report's coupling
    // table is a table of object pairs; a touches edge in it would be a different fact presented
    // as the same one.
    for (const e of view().edges) {
      expect(e.from.startsWith('flow.') || e.from.startsWith('apexClass.')).toBe(false);
    }
  });
});

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

  it('carries the per-object measurements CouplingGraphNode carried', () => {
    // Parity with the deleted `CouplingGraphNode`, deliberately, not a requirement of any
    // renderer: nothing in src/report/ reads `recordCount90d` or `automationCounts` off the view
    // today. They are kept because the view is the documented stand-in for that node shape, and
    // a caller adapting a fragment for its own renderer is entitled to the same fields.
    const account = view().nodes.find((n) => n.object === 'Account');

    expect(account?.recordCount90d).toBe(100);
    expect(account?.automationCounts.flows).toBe(1);
  });

  it('assigns every object a layer, since the fragment stores none', () => {
    // CouplingGraphNode carried `layer`; contributions do not. The renderers used to fall back
    // to roleOf(object) themselves, and 259621b deleted both fallbacks so that src/map no longer
    // depends on src/report. The adapter is now the SOLE place `layer` is resolved for the
    // report path -- roleOf appears nowhere else under src/report/ -- so a node reaching a
    // renderer without one would be undefined all the way down, not silently reclassified.
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

  it('omits a known object that forms no coupling pair', () => {
    // The fragment contributes one `obj.*` entry per KNOWN object, and `runMap` passes the org's
    // whole sObject catalog as `knownObjects`. The deleted `CouplingGraphNode` population was
    // narrower: `buildNodes(edges, info)` collected only the objects appearing in an edge. Two
    // consumers read `nodes` unfiltered -- the report's `Objects` summary figure and its layer
    // table -- so without the filter both count the catalog instead of the couplings.
    //
    // The shared fixture cannot show this: its `knownObjects` and its edge-participating set are
    // the same four objects, so the two populations coincide. `Lead` is added HERE rather than
    // there because widening that fixture would move the render goldens.
    const base = input();
    const known = new Set([...base.knownObjects, 'Lead']);
    const fragment = buildMapFragment({ ...base, knownObjects: known });
    const v = couplingViewOf(fragment);

    // Lead is genuinely in the fragment and genuinely uncoupled, so its absence below is this
    // adapter's filter and not something the fragment builder already did.
    expect(fragment.contributions?.some((c) => c.nodeId === 'obj.Lead')).toBe(true);
    expect(v.edges.some((e) => e.from === 'Lead' || e.to === 'Lead')).toBe(false);

    expect(v.nodes.map((n) => n.object)).not.toContain('Lead');
    // The coupled objects are still all there: this filters, it does not empty.
    expect(v.nodes.map((n) => n.object)).toContain('Account');
    expect(v.nodes).toHaveLength(couplingViewOf(buildMapFragment(base)).nodes.length);
  });
});

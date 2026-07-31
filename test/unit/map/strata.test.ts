import { describe, it, expect } from '@jest/globals';
import { computeStrataLayout } from '../../../src/map/graph/strata.js';
import { LAYERS } from '../../../src/map/graph/layers.js';

/**
 * A force-directed picture of a real org is a hairball — 202 objects and 2000 couplings resolve
 * into a cloud with no readable structure. Fixing each object's vertical position to its
 * architectural layer turns the same data into bands, so a reader can see at a glance how much
 * of the graph is business process and how heavily it reaches into identity or logging.
 *
 * Horizontal position is then chosen to reduce edge crossings, which is the only remaining
 * freedom once the layers are fixed.
 */
const objects = [
  { object: 'Account', layer: 'business' as const },
  { object: 'Case', layer: 'business' as const },
  { object: 'Contact', layer: 'business' as const },
  { object: 'User', layer: 'security' as const },
  { object: 'Profile', layer: 'security' as const },
  { object: 'LogEntry__c', layer: 'observability' as const },
];

const edges = [
  { from: 'Account', to: 'Case', weight: 5 },
  { from: 'Account', to: 'User', weight: 9 },
  { from: 'Case', to: 'Profile', weight: 3 },
  { from: 'LogEntry__c', to: 'User', weight: 4 },
];

describe('computeStrataLayout', () => {
  const layout = computeStrataLayout(objects, edges, { width: 1000, height: 700 });

  it('places every object somewhere', () => {
    expect(layout.positions.size).toBe(objects.length);
    for (const o of objects) expect(layout.positions.get(o.object)).toBeDefined();
  });

  it('gives every object in a layer the same vertical position', () => {
    const y = (name: string): number => layout.positions.get(name)!.y;

    expect(y('Account')).toBe(y('Case'));
    expect(y('Account')).toBe(y('Contact'));
    expect(y('User')).toBe(y('Profile'));
    expect(y('Account')).not.toBe(y('User'));
  });

  it('orders the bands from the business core outwards', () => {
    const bands = layout.bands.map((b) => b.layer);
    const expected = LAYERS.filter((l) => bands.includes(l));

    expect(bands).toEqual(expected);
    // And each band sits below the previous one.
    for (let i = 1; i < layout.bands.length; i++) {
      expect(layout.bands[i].y).toBeGreaterThan(layout.bands[i - 1].y);
    }
  });

  it('reports only the layers actually present', () => {
    expect(layout.bands.map((b) => b.layer).sort()).toEqual(['business', 'observability', 'security']);
    expect(layout.bands.find((b) => b.layer === 'business')?.count).toBe(3);
  });

  it('keeps every object inside the canvas', () => {
    for (const p of layout.positions.values()) {
      expect(p.x).toBeGreaterThanOrEqual(0);
      expect(p.x).toBeLessThanOrEqual(1000);
      expect(p.y).toBeGreaterThanOrEqual(0);
      expect(p.y).toBeLessThanOrEqual(700);
    }
  });

  it('never chooses an ordering worse than the naive one', () => {
    // Barycentre minimises crossings across the whole drawing; it makes no promise about any
    // particular pair, and it oscillates between sweeps. The guarantee worth asserting is that
    // the ordering kept is never worse than the alphabetical starting point.
    const naive = computeStrataLayout(objects, edges, { width: 1000, height: 700, passes: 0 });

    expect(layout.crossings).toBeLessThanOrEqual(naive.crossings);
  });

  it('reduces crossings on a graph where reordering genuinely helps', () => {
    // Two bands wired in reverse order: alphabetical placement crosses every edge, and one
    // sweep should undo it.
    const objs = [
      { object: 'A1', layer: 'business' as const }, { object: 'A2', layer: 'business' as const },
      { object: 'A3', layer: 'business' as const },
      { object: 'Z1', layer: 'security' as const }, { object: 'Z2', layer: 'security' as const },
      { object: 'Z3', layer: 'security' as const },
    ];
    const wires = [
      { from: 'A1', to: 'Z3', weight: 1 }, { from: 'A2', to: 'Z2', weight: 1 }, { from: 'A3', to: 'Z1', weight: 1 },
    ];

    const naive = computeStrataLayout(objs, wires, { passes: 0 });
    const swept = computeStrataLayout(objs, wires, { passes: 6 });

    expect(swept.crossings).toBeLessThan(naive.crossings);
  });

  it('never gets worse as sweeps are added', () => {
    // Barycentre oscillates: a sweep can flip two bands and the next flip them back, so the
    // final pass is not necessarily the best one. Keeping the best arrangement seen means more
    // sweeps can only help — without it, the answer depends on the parity of the pass count.
    const objs = [
      { object: 'A1', layer: 'business' as const }, { object: 'A2', layer: 'business' as const },
      { object: 'A3', layer: 'business' as const },
      { object: 'Z1', layer: 'security' as const }, { object: 'Z2', layer: 'security' as const },
      { object: 'Z3', layer: 'security' as const },
    ];
    const wires = [
      { from: 'A1', to: 'Z3', weight: 4 }, { from: 'A2', to: 'Z2', weight: 3 },
      { from: 'A3', to: 'Z1', weight: 2 }, { from: 'A1', to: 'Z1', weight: 1 },
    ];

    const series = [0, 1, 2, 3, 4, 5, 6].map((passes) => computeStrataLayout(objs, wires, { passes }).crossings);

    for (let i = 1; i < series.length; i++) expect(series[i]).toBeLessThanOrEqual(series[i - 1]);
  });

  it('is deterministic regardless of input order', () => {
    const a = computeStrataLayout(objects, edges, { width: 1000, height: 700 });
    const b = computeStrataLayout([...objects].reverse(), [...edges].reverse(), { width: 1000, height: 700 });

    expect(JSON.stringify([...a.positions].sort())).toBe(JSON.stringify([...b.positions].sort()));
  });

  it('handles a single object and an empty graph', () => {
    expect(computeStrataLayout([{ object: 'Solo', layer: 'business' }], [], {}).positions.size).toBe(1);
    const empty = computeStrataLayout([], [], {});
    expect(empty.positions.size).toBe(0);
    expect(empty.bands).toEqual([]);
  });
});

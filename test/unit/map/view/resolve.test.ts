import { describe, it, expect } from '@jest/globals';
import { NAVIGATION_VIEW } from '../../../../src/map/view/spec.js';
import { resolveNavigationView } from '../../../../src/map/view/resolve.js';
import type { Cluster } from '../../../../src/map/graph/clusters.js';
import type { LayoutEdge } from '../../../../src/map/graph/layout.js';

const clusters = (): Cluster[] => [
  { id: 'cluster-1', objects: ['Case', 'WorkOrder'], anchorObject: 'Case' },
  { id: 'cluster-2', objects: ['Account'], anchorObject: 'Account' },
];

// LayoutEdge is exactly { from: string; to: string } -- no weight field. Verified against
// src/map/graph/layout.ts; do not add one.
const edges = (): LayoutEdge[] => [
  { from: 'Case', to: 'WorkOrder' },
  { from: 'Case', to: 'Account' },
];

describe('resolveNavigationView', () => {
  it('resolves one level per level the spec declares, in spec order', () => {
    const levels = resolveNavigationView(NAVIGATION_VIEW, clusters(), edges());

    expect(levels.map((l) => l.id)).toEqual(['L0_landscape', 'L1_domain']);
  });

  it('places every domain in the landscape space', () => {
    const [l0] = resolveNavigationView(NAVIGATION_VIEW, clusters(), edges());
    const landscape = l0.coordinates.get('landscape');

    expect([...(landscape?.keys() ?? [])].sort()).toEqual(['cluster-1', 'cluster-2']);
  });

  it('gives each domain a distinct landscape position', () => {
    // Carried over from test/unit/map/manifest.test.ts, which asserted this of `buildManifest`'s
    // L0 before 1.0 retired landscape-manifest.json and deleted that function. The property
    // outlived its old subject: two domains stacked on one point is a landscape a viewer cannot
    // navigate, whichever code lays it out.
    const [l0] = resolveNavigationView(NAVIGATION_VIEW, clusters(), edges());
    const landscape = l0.coordinates.get('landscape');

    const positions = [...(landscape?.values() ?? [])].map((p) => `${p.x},${p.y}`);
    expect(positions).toHaveLength(clusters().length);
    expect(new Set(positions).size).toBe(positions.length);
  });

  it('gives each domain its own object coordinate space', () => {
    // L0 and L1 are deliberately different spaces: L0 positions domains against each other, L1
    // positions objects within one domain. Flattening them into one space would make a viewer
    // unable to zoom, which is the whole purpose of the levels.
    const [, l1] = resolveNavigationView(NAVIGATION_VIEW, clusters(), edges());

    expect([...l1.coordinates.keys()].sort()).toEqual(['cluster-1', 'cluster-2']);
    expect([...(l1.coordinates.get('cluster-1')?.keys() ?? [])].sort()).toEqual(['Case', 'WorkOrder']);
    expect([...(l1.coordinates.get('cluster-2')?.keys() ?? [])].sort()).toEqual(['Account']);
  });

  it('lays a domain out over its own objects only, never a coupled neighbour', () => {
    // Case-Account crosses domains. A domain's coordinate space must hold that domain's own
    // objects and nothing else: if the resolver laid out each domain's objects *plus whatever
    // they couple to*, Account would land in cluster-1's space and an object's position inside
    // its domain would depend on a domain it is not in.
    //
    // This is deliberately a NODE-list assertion, not an edge-list one. computeLayout filters
    // its own edge argument down to its node list, so handing it the full edge list instead of
    // the internal subset yields byte-identical coordinates and no assertion could tell the two
    // apart. The node list is the part that is actually load-bearing, so that is what is pinned.
    const [, l1] = resolveNavigationView(NAVIGATION_VIEW, clusters(), edges());

    // Guard the fixture: "no neighbour leaked in" is a claim about nothing unless some object
    // really does couple across a domain boundary.
    const clusterOf = new Map<string, string>();
    for (const c of clusters()) for (const o of c.objects) clusterOf.set(o, c.id);
    const crossing = edges().filter((e) => clusterOf.get(e.from) !== clusterOf.get(e.to));
    expect(crossing.length).toBeGreaterThan(0);

    for (const c of clusters()) {
      const space = l1.coordinates.get(c.id);
      expect([...(space?.keys() ?? [])].sort()).toEqual([...c.objects].sort());
    }

    // Spelled out for the objects that would actually leak if neighbours were included: Account
    // couples to Case but belongs to cluster-2, and vice versa.
    expect(l1.coordinates.get('cluster-1')?.has('Account')).toBe(false);
    expect(l1.coordinates.get('cluster-2')?.has('Case')).toBe(false);
  });

  it('is deterministic: same input, same coordinates', () => {
    const a = resolveNavigationView(NAVIGATION_VIEW, clusters(), edges());
    const b = resolveNavigationView(NAVIGATION_VIEW, clusters(), edges());

    expect(a[1].coordinates.get('cluster-1')).toEqual(b[1].coordinates.get('cluster-1'));
  });
});

/**
 * The absolute half of the deleted test/unit/map/view/equivalence.test.ts, carried over with the
 * fixture it was built around.
 *
 * That file compared `resolveNavigationView` against `buildManifest`, and 1.0 deleted
 * `buildManifest` -- so the equivalence went with it. But its fixture was not built for the
 * comparison; it was built to make `crossDomainEdges` actually work. Four domains, a cluster pair
 * linked twice, and one pair crossed in both directions, so that the `seen.has(key)` dedup, both
 * branches of the `a < b ? a|b : b|a` pair key, and the final sort all execute. "Dedup
 * deduplicates" and "order does not leak into the coordinates" are properties of
 * `crossDomainEdges` alone. They outlived their comparison target, so they are asserted here
 * directly instead of via a second implementation.
 *
 * The fixture at the top of this file cannot carry them: it has one crossing edge, no duplicates
 * and no reversed pair, so every branch above stays cold.
 */
describe('resolveNavigationView across multiple domains', () => {
  const multiClusters: Cluster[] = [
    { id: 'clusterA', objects: ['Widget', 'Gadget'], anchorObject: 'Widget' },
    { id: 'clusterB', objects: ['Order', 'Invoice'], anchorObject: 'Order' },
    { id: 'clusterC', objects: ['Ticket', 'Ledger'], anchorObject: 'Ticket' },
    { id: 'clusterD', objects: ['Journal'], anchorObject: 'Journal' }, // one object: the n === 1 branch
  ];

  const multiEdges = (): LayoutEdge[] => [
    { from: 'Widget', to: 'Gadget' }, // internal to clusterA
    { from: 'Order', to: 'Invoice' }, // internal to clusterB
    { from: 'Ticket', to: 'Ledger' }, // internal to clusterC
    { from: 'Widget', to: 'Order' }, // clusterA -> clusterB
    { from: 'Gadget', to: 'Invoice' }, // clusterA -> clusterB again: same cluster pair, must dedup
    { from: 'Invoice', to: 'Ticket' }, // clusterB -> clusterC
    { from: 'Gadget', to: 'Ledger' }, // clusterA -> clusterC (the a < b ternary branch)
    { from: 'Ticket', to: 'Widget' }, // clusterC -> clusterA: same pair as above, reversed --
    // exercises the b < a branch for the same key, must still dedup to one clusterA/clusterC link
    { from: 'Journal', to: 'Order' }, // clusterD -> clusterB: clusterD's only coupling leaves it,
    // so its own L1 space is a single unconnected node
  ];

  /** The same distinct cluster pairs as `multiEdges`, with the two duplicate crossings removed. */
  const dedupedEdges = (): LayoutEdge[] => [
    { from: 'Widget', to: 'Gadget' },
    { from: 'Order', to: 'Invoice' },
    { from: 'Ticket', to: 'Ledger' },
    { from: 'Widget', to: 'Order' }, // clusterA|clusterB
    { from: 'Invoice', to: 'Ticket' }, // clusterB|clusterC
    { from: 'Gadget', to: 'Ledger' }, // clusterA|clusterC
    { from: 'Journal', to: 'Order' }, // clusterB|clusterD
  ];

  const landscape = (edgeList: LayoutEdge[]) =>
    resolveNavigationView(NAVIGATION_VIEW, multiClusters, edgeList)[0].coordinates.get('landscape');

  it('crosses domains in both pair-key directions, with duplicate links left to dedup', () => {
    // Guards the fixture itself against being trimmed back to something that looks equivalent
    // but exercises less. It pins exactly what the comments above promise, so a future editor
    // deleting an edge as "redundant" gets a failure rather than silent loss of coverage:
    // more crossing edges than distinct cluster pairs (so dedup has work to do), both branches
    // of the `a < b ? a|b : b|a` ternary taken, and both of them taken for one same pair.
    const clusterOf = new Map<string, string>();
    for (const c of multiClusters) for (const o of c.objects) clusterOf.set(o, c.id);

    const crossing = multiEdges()
      .map((e) => ({ a: clusterOf.get(e.from), b: clusterOf.get(e.to) }))
      .filter((p): p is { a: string; b: string } => p.a !== undefined && p.b !== undefined && p.a !== p.b)
      .map(({ a, b }) => ({ key: a < b ? `${a}|${b}` : `${b}|${a}`, ascending: a < b }));

    expect(crossing.length).toBeGreaterThan(0);

    const distinctPairs = new Set(crossing.map((c) => c.key));
    expect(distinctPairs.size).toBeLessThan(crossing.length);

    const ascendingKeys = new Set(crossing.filter((c) => c.ascending).map((c) => c.key));
    const descendingKeys = new Set(crossing.filter((c) => !c.ascending).map((c) => c.key));
    expect(ascendingKeys.size).toBeGreaterThan(0);
    expect(descendingKeys.size).toBeGreaterThan(0);
    expect([...ascendingKeys].filter((k) => descendingKeys.has(k))).not.toEqual([]);
  });

  it('counts a repeated cluster link once, whichever direction it is crossed in', () => {
    // The dedup, asserted through what it affects. `computeLayout` sums one attraction per edge,
    // so a duplicate that survived would pull its two domains together twice as hard and move
    // the landscape. Identical coordinates from the duplicate-laden and hand-deduplicated edge
    // lists is therefore a real claim about `crossDomainEdges`, not a restatement of it.
    expect(landscape(multiEdges())).toEqual(landscape(dedupedEdges()));
  });

  it('does move the landscape when a genuinely new domain pair is linked', () => {
    // Non-vacuity guard for the test above. If the layout ignored cross-domain edges entirely,
    // every comparison here would pass and prove nothing. A link between two domains that were
    // not previously connected must change the result.
    const extra = [...dedupedEdges(), { from: 'Journal', to: 'Widget' }]; // clusterA|clusterD, new
    expect(landscape(extra)).not.toEqual(landscape(dedupedEdges()));
  });

  it('orders the cross-domain links it keeps, so one edge list gives one landscape', () => {
    // What the final sort in `crossDomainEdges` buys. `computeLayout` accumulates displacement
    // per edge in sequence, so without the sort the surviving links would reach it in dedup
    // (i.e. caller) order and the coordinates would follow.
    //
    // NOT order-independence, and deliberately not asserted as such: `crossDomainEdges`
    // deduplicates on a canonical `a < b ? a|b : b|a` key but pushes `{ from: a, to: b }` in
    // whichever direction the FIRST edge for that pair happened to run. The sort then keys on
    // `from + to`, so 'clusterA'+'clusterC' and 'clusterC'+'clusterA' sort to different slots and
    // reversing the input can still move the landscape. That is inherited byte for byte from
    // manifest.ts's `interClusterEdges` and is not reachable today -- `mergeEdges` emits one
    // deterministic order per org, and nothing in src/ calls `resolveNavigationView` yet. It is
    // recorded here rather than pinned, so a later change that canonicalises the direction is
    // free to make it go away without tripping a test that had frozen the quirk in place.
    const a = landscape(multiEdges());
    const b = landscape(multiEdges());
    expect(a).toEqual(b);
    expect([...(a?.keys() ?? [])]).toEqual([...(b?.keys() ?? [])]);
  });

  it('covers every domain and object, leaving nothing unchecked', () => {
    const [l0, l1] = resolveNavigationView(NAVIGATION_VIEW, multiClusters, multiEdges());

    expect(l0.coordinates.get('landscape')?.size).toBe(multiClusters.length);
    expect(l1.coordinates.size).toBe(multiClusters.length);
    expect(multiClusters.length).toBeGreaterThan(1);
    for (const c of multiClusters) {
      expect([...(l1.coordinates.get(c.id)?.keys() ?? [])].sort()).toEqual([...c.objects].sort());
    }
  });

  it('is deterministic across four domains, not just two', () => {
    const a = resolveNavigationView(NAVIGATION_VIEW, multiClusters, multiEdges());
    const b = resolveNavigationView(NAVIGATION_VIEW, multiClusters, multiEdges());

    expect(a[0].coordinates.get('landscape')).toEqual(b[0].coordinates.get('landscape'));
    for (const c of multiClusters) {
      expect(a[1].coordinates.get(c.id)).toEqual(b[1].coordinates.get(c.id));
    }
  });
});

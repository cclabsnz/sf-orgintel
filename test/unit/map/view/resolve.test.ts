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

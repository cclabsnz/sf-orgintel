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

  it('gives each domain its own object coordinate space', () => {
    // L0 and L1 are deliberately different spaces: L0 positions domains against each other, L1
    // positions objects within one domain. Flattening them into one space would make a viewer
    // unable to zoom, which is the whole purpose of the levels.
    const [, l1] = resolveNavigationView(NAVIGATION_VIEW, clusters(), edges());

    expect([...l1.coordinates.keys()].sort()).toEqual(['cluster-1', 'cluster-2']);
    expect([...(l1.coordinates.get('cluster-1')?.keys() ?? [])].sort()).toEqual(['Case', 'WorkOrder']);
    expect([...(l1.coordinates.get('cluster-2')?.keys() ?? [])].sort()).toEqual(['Account']);
  });

  it('lays a domain out from its internal couplings only', () => {
    // Case-Account crosses domains. It must not influence cluster-1's internal layout, or an
    // object's position inside its domain would depend on a domain it is not in.
    const withCrossEdge = resolveNavigationView(NAVIGATION_VIEW, clusters(), edges());
    const withoutCrossEdge = resolveNavigationView(NAVIGATION_VIEW, clusters(), [
      { from: 'Case', to: 'WorkOrder' },
    ]);

    expect(withCrossEdge[1].coordinates.get('cluster-1')).toEqual(
      withoutCrossEdge[1].coordinates.get('cluster-1'),
    );
  });

  it('is deterministic: same input, same coordinates', () => {
    const a = resolveNavigationView(NAVIGATION_VIEW, clusters(), edges());
    const b = resolveNavigationView(NAVIGATION_VIEW, clusters(), edges());

    expect(a[1].coordinates.get('cluster-1')).toEqual(b[1].coordinates.get('cluster-1'));
  });
});

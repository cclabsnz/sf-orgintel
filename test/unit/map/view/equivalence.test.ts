// Spec 5. buildManifest's output is pinned byte for byte by test/unit/map/golden.test.ts, and
// 1.0 deletes both the manifest and that golden. A guarantee written after the deletion could
// only pin whatever the deletion produced, which is the trap the 0.3.0 goldens were introduced
// to avoid. So the equivalence is established here, while both paths are alive.
import { describe, it, expect } from '@jest/globals';
import { NAVIGATION_VIEW } from '../../../../src/map/view/spec.js';
import { resolveNavigationView } from '../../../../src/map/view/resolve.js';
import { buildManifest } from '../../../../src/map/graph/manifest.js';
import { artifacts, edges } from '../fixtures/input.js';
import type { Cluster } from '../../../../src/map/graph/clusters.js';
import type { LayoutEdge } from '../../../../src/map/graph/layout.js';
import type { CouplingGraphNode } from '@cclabsnz/sf-core';

const manifest = () => artifacts().manifest;
const resolved = () => resolveNavigationView(NAVIGATION_VIEW, artifacts().clusters, edges());

describe('the navigation view reproduces what buildManifest lays out', () => {
  it('places the domains at the same landscape coordinates', () => {
    const built = manifest();
    const [l0] = resolved();
    const landscape = l0.coordinates.get('landscape');

    for (const cluster of built.levels.L0_landscape.clusters) {
      expect(landscape?.get(cluster.id)).toEqual(cluster.layout);
    }
  });

  it('places every object at the same coordinate inside its own domain', () => {
    const built = manifest();
    const [, l1] = resolved();

    for (const per of built.levels.L1_domain.perCluster) {
      const space = l1.coordinates.get(per.clusterId);
      // Iterating the manifest's entries checks the resolver for omissions only. The size
      // equality is what checks it for surplus: an object leaking into a second domain's space
      // as well as its own would still satisfy every per-object comparison above.
      expect(space?.size).toBe(Object.keys(per.layout).length);
      for (const [object, coord] of Object.entries(per.layout)) {
        expect(space?.get(object)).toEqual(coord);
      }
    }
  });

  it('covers every domain and object the manifest carries, leaving nothing unchecked', () => {
    // Without this, the two assertions above would pass vacuously against an empty resolver.
    const built = manifest();
    const [l0, l1] = resolved();

    expect(l0.coordinates.get('landscape')?.size).toBe(built.levels.L0_landscape.clusters.length);
    expect(l1.coordinates.size).toBe(built.levels.L1_domain.perCluster.length);
    expect(built.levels.L0_landscape.clusters.length).toBeGreaterThan(0);
  });
});

// The shared fixture above (artifacts()) collapses to a single cluster spanning every known
// object -- see test/unit/map/fixtures/golden/landscape-manifest.golden.json. With only one
// cluster, every edge is internal to it: crossDomainEdges (resolve.ts) and interClusterEdges
// (manifest.ts) filter out every edge (`a === b`) and return empty on every run, and L0 lays out
// a single node, which computeLayout short-circuits to the centre point. Their pair-key
// deduplication and ordering -- the exact logic that has to agree for cross-domain coordinates to
// match -- never executes against that fixture.
//
// This case builds a local, three-cluster fixture with edges that genuinely cross between
// clusters, so that logic actually runs on both sides. It includes a duplicated cluster-to-cluster
// link (clusterA<->clusterB, carried by two different object pairs) so the dedup path runs, and a
// second duplicated link crossed in both directions (clusterA->clusterC via Gadget/Ledger, and
// clusterC->clusterA via Ticket/Widget) so both branches of the `a < b ? a|b : b|a` pair-key
// ternary fire for the *same* cluster pair -- a key that normalised by edge direction instead of
// by cluster id would fail to dedup this pair, leaving an extra edge that changes the layout.
//
// It also includes a cluster holding exactly one object (clusterD/Journal). connectedComponents
// produces those on real orgs, and one object is a distinct computeLayout branch: the `n === 1`
// short-circuit that places the node at the canvas centre without running the force loop at all.
// Every other cluster here has two objects, so without clusterD that branch would never be
// compared between the two sides at L1.
//
// buildManifest is called directly here, not via artifacts(). The earlier instruction to use
// artifacts().manifest was to stop the two sides being built from separately-constructed inputs
// that could quietly drift apart. That risk doesn't apply here: one local fixture object feeds
// both buildManifest and resolveNavigationView in the same test.
describe('the navigation view reproduces buildManifest across multiple domains', () => {
  const multiClusters: Cluster[] = [
    { id: 'clusterA', objects: ['Widget', 'Gadget'], anchorObject: 'Widget' },
    { id: 'clusterB', objects: ['Order', 'Invoice'], anchorObject: 'Order' },
    { id: 'clusterC', objects: ['Ticket', 'Ledger'], anchorObject: 'Ticket' },
    { id: 'clusterD', objects: ['Journal'], anchorObject: 'Journal' }, // one object: the n === 1 branch
  ];

  const multiEdges: LayoutEdge[] = [
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

  // buildManifest only reads `nodes` for L0 metrics, which these tests don't assert -- a plain
  // node per object, not `buildNodes(multiEdges, ...)`, keeps this fixture free of a dependency
  // on CouplingGraphEdge's richer shape (weight, operations, components) that multiEdges (plain
  // LayoutEdge) doesn't carry.
  const multiNodes: CouplingGraphNode[] = multiClusters.flatMap((c) =>
    c.objects.map((object) => ({
      object,
      custom: false,
      automationCounts: { flows: 0, triggers: 0, approvals: 0 },
      recordCount90d: 0,
    })),
  );

  const multiManifest = () =>
    buildManifest(
      { tool: 'orgintel', toolVersion: '0.0.0-test', generatedAt: '2026-01-01T00:00:00Z', orgId: 'org1' },
      multiClusters,
      multiEdges,
      multiNodes,
      (o: string) => o,
    );
  const multiResolved = () => resolveNavigationView(NAVIGATION_VIEW, multiClusters, multiEdges);

  it('crosses domains in both pair-key directions, with duplicate links left to dedup', () => {
    // Guards the fixture itself against being trimmed back to something that looks equivalent
    // but exercises less. It pins exactly what the comment above promises, so a future editor
    // deleting an edge as "redundant" gets a failure rather than silent loss of coverage:
    // more crossing edges than distinct cluster pairs (so dedup has work to do), both branches
    // of the `a < b ? a|b : b|a` ternary taken, and both of them taken for one same pair.
    const clusterOf = new Map<string, string>();
    for (const c of multiClusters) for (const o of c.objects) clusterOf.set(o, c.id);

    const crossing = multiEdges
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

  it('places the domains at the same landscape coordinates', () => {
    const built = multiManifest();
    const [l0] = multiResolved();
    const landscape = l0.coordinates.get('landscape');

    for (const cluster of built.levels.L0_landscape.clusters) {
      expect(landscape?.get(cluster.id)).toEqual(cluster.layout);
    }
  });

  it('places every object at the same coordinate inside its own domain', () => {
    const built = multiManifest();
    const [, l1] = multiResolved();

    for (const per of built.levels.L1_domain.perCluster) {
      const space = l1.coordinates.get(per.clusterId);
      // Surplus check, as above: without it an object leaking into a second domain's space
      // would pass every per-object comparison.
      expect(space?.size).toBe(Object.keys(per.layout).length);
      for (const [object, coord] of Object.entries(per.layout)) {
        expect(space?.get(object)).toEqual(coord);
      }
    }
  });

  it('covers every domain and object, leaving nothing unchecked', () => {
    const built = multiManifest();
    const [l0, l1] = multiResolved();

    expect(l0.coordinates.get('landscape')?.size).toBe(built.levels.L0_landscape.clusters.length);
    expect(l1.coordinates.size).toBe(built.levels.L1_domain.perCluster.length);
    expect(built.levels.L0_landscape.clusters.length).toBeGreaterThan(1);
  });
});

// Spec 5. buildManifest's output is pinned byte for byte by test/unit/map/golden.test.ts, and
// 1.0 deletes both the manifest and that golden. A guarantee written after the deletion could
// only pin whatever the deletion produced, which is the trap the 0.3.0 goldens were introduced
// to avoid. So the equivalence is established here, while both paths are alive.
import { describe, it, expect } from '@jest/globals';
import { NAVIGATION_VIEW } from '../../../../src/map/view/spec.js';
import { resolveNavigationView } from '../../../../src/map/view/resolve.js';
import { artifacts, edges } from '../fixtures/input.js';

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

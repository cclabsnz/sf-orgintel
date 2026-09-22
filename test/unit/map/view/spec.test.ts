import { describe, it, expect } from '@jest/globals';
import { NAVIGATION_VIEW } from '../../../../src/map/view/spec.js';
import type { Cluster } from '../../../../src/map/graph/clusters.js';

const clusters = (): Cluster[] => [
  { id: 'cluster-1', objects: ['Case', 'WorkOrder'], anchorObject: 'Case' },
  { id: 'cluster-2', objects: ['Account'], anchorObject: 'Account' },
];

describe('NAVIGATION_VIEW', () => {
  it('declares only the two levels that resolve', () => {
    // Spec 3.2: L2_process, L3_transition and L4_component have shipped since 0.1.0 carrying a
    // null ref, a bare reserved flag and an empty array. A level appears when something produces
    // it. Declaring them here would rebuild the placeholder this ruling removes.
    expect(NAVIGATION_VIEW.levels.map((l) => l.id)).toEqual(['L0_landscape', 'L1_domain']);
  });

  it('projects every domain and every object exactly once', () => {
    const items = NAVIGATION_VIEW.selector(clusters());

    expect(items.filter((i) => i.kind === 'domain')).toHaveLength(2);
    expect(items.filter((i) => i.kind === 'object')).toHaveLength(3);
  });

  it('carries each object its owning domain, so L1 can be laid out per domain', () => {
    const items = NAVIGATION_VIEW.selector(clusters());
    const workOrder = items.find((i) => i.kind === 'object' && i.id === 'WorkOrder');

    expect(workOrder).toEqual({ kind: 'object', id: 'WorkOrder', domainId: 'cluster-1' });
  });

  it('matches each item to exactly one level', () => {
    // A view whose levels overlap would place an item twice and a reader could not tell which
    // coordinate space it belongs to. L0 and L1 are deliberately different spaces.
    for (const item of NAVIGATION_VIEW.selector(clusters())) {
      expect(NAVIGATION_VIEW.levels.filter((l) => l.match(item))).toHaveLength(1);
    }
  });
});

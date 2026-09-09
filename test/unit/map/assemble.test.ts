import { describe, it, expect } from '@jest/globals';
import { artifacts } from './fixtures/input.js';

describe('assembleCouplingArtifacts', () => {
  const a = artifacts();

  it('merges flow + apex edges into an aggregated coupling graph', () => {
    const g = a.couplingGraph;
    expect(g.version).toBe(1);
    expect(g.nodes.map((n) => n.object).sort()).toEqual(['Account', 'Case', 'Contact', 'WorkOrder']);

    // Case↔Account appears in both Case_Router and the screen flow -> weight 2.
    const caseAccount = g.edges.find((e) => e.from === 'Account' && e.to === 'Case');
    expect(caseAccount?.weight).toBe(2);
    expect(caseAccount?.operations).toContain('read');

    // Apex-derived Account↔Contact is high confidence.
    const acctContact = g.edges.find((e) => e.from === 'Account' && e.to === 'Contact');
    expect(acctContact?.components[0]).toMatchObject({ type: 'ApexClass', confidence: 'high' });
  });

  it('populates the landscape manifest L0/L1 and reserves L2-L4', () => {
    const m = a.manifest;
    expect(m.version).toBe(1);
    expect(m.levels.L0_landscape.clusters.length).toBeGreaterThan(0);
    expect(m.levels.L1_domain.perCluster[0].graphRef).toMatch(/^coupling-graph\.json#cluster-/);
    expect(m.levels.L2_process.perAnchor.every((p) => p.processGraphRef === null)).toBe(true);
    expect(m.levels.L3_transition.reserved).toBe(true);
    expect(m.levels.L4_component.flowSummaryRefs).toEqual([]);

    // Manifest node coords agree with the report layout.
    const anyCluster = m.levels.L1_domain.perCluster[0];
    for (const [obj, coord] of Object.entries(anyCluster.layout)) {
      expect(a.layout.get(obj)).toEqual(coord);
    }
  });

  it('is deterministic', () => {
    expect(artifacts()).toEqual(a);
  });
});

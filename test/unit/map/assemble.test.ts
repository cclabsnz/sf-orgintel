import { describe, it, expect } from '@jest/globals';
import { artifacts } from './fixtures/input.js';

describe('assembleCouplingArtifacts', () => {
  const a = artifacts();

  it('merges flow + apex edges into aggregated object-pair couplings', () => {
    // Case↔Account appears in both Case_Router and the screen flow -> weight 2.
    const caseAccount = a.edges.find((e) => e.from === 'Account' && e.to === 'Case');
    expect(caseAccount?.weight).toBe(2);
    expect(caseAccount?.operations).toContain('read');

    // Apex-derived Account↔Contact is high confidence.
    const acctContact = a.edges.find((e) => e.from === 'Account' && e.to === 'Contact');
    expect(acctContact?.components[0]).toMatchObject({ type: 'ApexClass', confidence: 'high' });
  });

  it('covers every object the edges mention, and nothing else', () => {
    // `buildNodes` used to assert this by producing one node per object; 1.0 retired the node
    // records with `coupling-graph.json` and kept the object list they were derived from, so the
    // claim is made here against the edges themselves rather than against a second model of them.
    const objects = [...new Set(a.edges.flatMap((e) => [e.from, e.to]))].sort();
    expect(objects).toEqual(['Account', 'Case', 'Contact', 'WorkOrder']);

    const clustered = a.clusters.flatMap((c) => c.objects).sort();
    expect(clustered).toEqual(objects);
  });

  it('is deterministic', () => {
    expect(artifacts()).toEqual(a);
  });
});

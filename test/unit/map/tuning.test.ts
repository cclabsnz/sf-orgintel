import { describe, it, expect } from '@jest/globals';
import { assembleCouplingArtifacts } from '../../../src/map/assemble.js';
import type { FlowSummary } from '../../../src/map/flow/flowTypes.js';
import IntelMapCommand from '../../../src/commands/intel/map.js';

/**
 * `runMap` and `assembleCouplingArtifacts` have always accepted tuning options, but none were
 * reachable from the CLI — so an operator facing a 200-object org had no way to ask for
 * smaller domains or a denser picture. Options that exist but cannot be set are dead weight.
 */

function flow(apiName: string, trigger: string, updates: string[]): FlowSummary {
  return {
    apiName, label: apiName, apiVersion: '62.0', processType: 'AutoLaunchedFlow',
    status: 'Active', namespace: null,
    start: { triggerType: 'RecordAfterSave', triggerObject: trigger, recordTriggerType: 'CreateAndUpdate' },
    initiator: 'record-trigger', recordLookups: [], recordCreates: [],
    recordUpdates: updates.map((o, i) => ({ name: `u${i}`, object: o })),
    recordDeletes: [], actionCalls: [], subflows: [],
    screenCount: 0, decisionCount: 0, loopCount: 0,
  };
}

const PROV = { tool: 'orgintel' as const, toolVersion: '0.1.0', generatedAt: '2026-07-30T00:00:00.000Z', orgId: '00Dxx0000000000EAA' };

/**
 * Four groups of 15, densely cross-linked. Modularity merges each group at its natural
 * resolution (largest 15) and subdivides them under pressure (largest ~4), so a target below
 * 15 forces the tuner to act. Fixtures where the natural resolution already satisfies any
 * plausible target cannot detect an unplumbed option — an earlier version of this test used
 * one and passed against code where targetDomainSize was never wired to clusterGraph at all.
 */
function denseGraph() {
  const flows: FlowSummary[] = [];
  const objects: string[] = [];
  const groups: string[][] = [];
  for (let g = 0; g < 4; g++) {
    const members = Array.from({ length: 15 }, (_, i) => `G${g}_${i}__c`);
    groups.push(members);
    objects.push(...members);
    for (let i = 0; i < 15; i++)
      for (let j = i + 1; j < 15; j++) flows.push(flow(`F${g}_${i}_${j}`, members[i], [members[j]]));
  }
  for (let a = 0; a < 4; a++)
    for (let b = a + 1; b < 4; b++)
      for (let k = 0; k < 12; k++)
        flows.push(flow(`X${a}${b}_${k}`, groups[a][k % 15], [groups[b][k % 15]]), flow(`Y${a}${b}_${k}`, groups[a][k % 15], [groups[b][k % 15]]));
  return { flows, objects };
}

function build(opts: { topLayout?: number; targetDomainSize?: number }) {
  const { flows, objects } = denseGraph();
  return assembleCouplingArtifacts({
    flowSummaries: flows, apexClasses: [], apexTriggers: [], knownObjects: new Set(objects),
    nodeInfo: () => ({ custom: true, automationCounts: { flows: 1, triggers: 0, approvals: 0 }, recordCount90d: 10 }),
    labelOf: (o) => o,
    couplingProvenance: { ...PROV, evidenceTier: 'B' as const },
    manifestProvenance: PROV,
    ...opts,
  });
}

describe('map tuning options', () => {
  it('honours topLayout for the report picture', () => {
    expect(build({ topLayout: 8 }).layout.size).toBe(8);
    expect(build({ topLayout: 25 }).layout.size).toBe(25);
  });

  it('threads targetDomainSize through to clustering', () => {
    // A target the natural resolution already satisfies must leave it alone; a tighter one
    // must visibly subdivide. If the option were not plumbed, both calls would return the
    // default clustering and the second assertion would fail.
    const natural = build({ targetDomainSize: 15 });
    const tight = build({ targetDomainSize: 4 });

    const largest = (a: typeof natural) => Math.max(...a.clusters.map((c) => c.objects.length));
    expect(largest(natural)).toBe(15);
    expect(largest(tight)).toBeLessThan(10);
    expect(tight.clusters.length).toBeGreaterThan(natural.clusters.length);
  });
});

describe('intel map command surface', () => {
  const flags = IntelMapCommand.flags as Record<string, unknown>;

  it('exposes the tuning knobs the pipeline already supports', () => {
    expect(flags['top-layout']).toBeDefined();
    expect(flags['max-node-counts']).toBeDefined();
    expect(flags['domain-size']).toBeDefined();
  });

  it('keeps the existing flags', () => {
    for (const f of ['target-org', 'include-inactive', 'html', 'output', 'branding', 'prepared-for']) {
      expect(flags[f]).toBeDefined();
    }
  });
});

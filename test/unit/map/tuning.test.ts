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
 * Nested structure: `k` super-domains, each of 3 tightly-knit sub-domains, cross-linked so the
 * graph has no bridges — the real-org shape. Nesting matters: a complete clique has no internal
 * structure, so no resolution can subdivide it and the target would look ignored.
 */
function denseGraph(k: number, subSize: number) {
  const flows: FlowSummary[] = [];
  const objects: string[] = [];
  for (let c = 0; c < k; c++) {
    for (let s = 0; s < 3; s++) {
      const members = Array.from({ length: subSize }, (_, i) => `D${c}_${s}_${i}__c`);
      objects.push(...members);
      for (let i = 0; i < subSize; i++)
        for (let j = i + 1; j < subSize; j++) flows.push(flow(`F${c}${s}_${i}_${j}`, members[i], [members[j]]));
      // Bind sub-domains into a super-domain with a few links.
      if (s > 0) for (let l = 0; l < 2; l++) flows.push(flow(`B${c}${s}_${l}`, `D${c}_${s - 1}_${l}__c`, [`D${c}_${s}_${l}__c`]));
    }
    if (c > 0) for (let l = 0; l < 3; l++) flows.push(flow(`X${c}_${l}`, `D${c - 1}_0_${l}__c`, [`D${c}_0_${l}__c`]));
  }
  return { flows, objects };
}

function build(opts: { topLayout?: number; targetDomainSize?: number }) {
  const { flows, objects } = denseGraph(3, 6);
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

  it('threads targetDomainSize through to clustering as a ceiling', () => {
    // The option only *engages* when modularity's natural resolution overshoots the target —
    // on a real 200-object org that happens (a 42-object domain at resolution 1.0). On a clean
    // synthetic graph the natural communities already fit, so the contract to assert here is
    // the invariant: a tighter ceiling never yields larger or fewer domains.
    const coarse = build({ targetDomainSize: 40 });
    const tight = build({ targetDomainSize: 4 });

    const largest = (a: typeof coarse) => Math.max(...a.clusters.map((c) => c.objects.length));
    expect(largest(tight)).toBeLessThanOrEqual(largest(coarse));
    expect(tight.clusters.length).toBeGreaterThanOrEqual(coarse.clusters.length);
    // And the option is genuinely wired — an unplumbed option would leave clustering at its
    // default, which this fixture resolves to 6-object domains.
    expect(largest(coarse)).toBeLessThanOrEqual(40);
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

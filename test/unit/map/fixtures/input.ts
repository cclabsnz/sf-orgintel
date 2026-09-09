// Shared deterministic fixture for map-assembly tests.
//
// `artifacts()` is the one call to assembleCouplingArtifacts() that both the golden byte-pinning
// suite (golden.test.ts) and the behavioral suite (assemble.test.ts) exercise. It used to be
// duplicated between the two files with slightly different provenance/knownObjects values; that
// drift is exactly the kind of thing a golden test is supposed to catch, so it is collapsed here
// into a single source of truth instead.
//
// `input()` shapes the same underlying facts as a plain object for later tasks in the
// map-as-a-projection convergence work. Task 3 defines the real `FragmentInput` type — this is
// deliberately just an object literal with an inferred shape until then.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseFlowXml } from '../../../../src/map/flow/parseFlow.js';
import { assembleCouplingArtifacts, type MapArtifacts } from '../../../../src/map/assemble.js';
import type { NodeInfo } from '../../../../src/map/graph/couplingGraph.js';
import type { ApexClassInput, ApexTriggerInput } from '../../../../src/map/apex/apexTypes.js';
import type { FragmentInput } from '../../../../src/map/fragment.js';

const DIR = join(process.cwd(), 'test/unit/map/fixtures/flows');
const flow = (f: string, api: string) =>
  parseFlowXml(readFileSync(join(DIR, `${f}.flow-meta.xml`), 'utf8'), api);

export const nodeInfo = (): NodeInfo => ({
  custom: false,
  automationCounts: { flows: 1, triggers: 1, approvals: 0 },
  recordCount90d: 100,
});

export const flowSummaries = () => [flow('Case_Router', 'Case_Router'), flow('New_Case_Screen', 'New_Case_Screen')];

export const apexClasses = (): ApexClassInput[] => [
  {
    name: 'AcctContactSync',
    namespace: null,
    body: null,
    symbolTable: { externalReferences: [{ name: 'Account' }, { name: 'Contact' }] },
  },
];

export const apexTriggers = (): ApexTriggerInput[] => [];

export const knownObjects = () => new Set(['Account', 'Case', 'WorkOrder', 'Contact']);

/**
 * Fixed provenance. `generatedAt` and `toolVersion` are the only fields that would otherwise
 * move between runs, and pinning them here is what makes a byte comparison meaningful rather
 * than a test of the clock.
 */
export const PROVENANCE = {
  tool: 'orgintel' as const,
  toolVersion: '0.0.0-test',
  generatedAt: '2026-01-01T00:00:00Z',
  orgId: 'org1',
  evidenceTier: null,
};

/** The deterministic assembleCouplingArtifacts() call shared by golden.test.ts and assemble.test.ts. */
export function artifacts(): MapArtifacts {
  return assembleCouplingArtifacts({
    flowSummaries: flowSummaries(),
    apexClasses: apexClasses(),
    apexTriggers: apexTriggers(),
    knownObjects: knownObjects(),
    nodeInfo,
    labelOf: (o: string) => o,
    notes: [],
    couplingProvenance: PROVENANCE,
    manifestProvenance: {
      tool: 'orgintel' as const,
      toolVersion: PROVENANCE.toolVersion,
      generatedAt: PROVENANCE.generatedAt,
      orgId: PROVENANCE.orgId,
    },
  });
}

/**
 * The `FragmentInput` for `buildMapFragment`. Carries the same edges `artifacts()` produced, the
 * same raw facts that fed it, the same nodeInfo, and fixed capture provenance, so the fragment
 * suite (fragment.test.ts) describes the same org as assemble.test.ts and the golden suite.
 */
export function input(): FragmentInput {
  return {
    edges: artifacts().couplingGraph.edges,
    flowSummaries: flowSummaries(),
    apexClasses: apexClasses(),
    apexTriggers: apexTriggers(),
    nodeInfo,
    // The exact set artifacts() already builds its coupling graph against -- not a set derived
    // from the edges above, which is the bug task 1 fixes.
    knownObjects: knownObjects(),
    workflowRulesFor: () => 0,
    capturedAt: '2026-01-01T00:00:00Z',
    orgId: 'org1',
  };
}

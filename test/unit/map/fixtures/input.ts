// Shared deterministic fixture for map-assembly tests.
//
// `artifacts()` is the one call to assembleCouplingArtifacts() that every suite touching the
// assembly exercises. It used to be duplicated per-file with slightly different provenance and
// knownObjects values, which is how two suites end up describing the same fixture org
// differently; it is collapsed here into a single source of truth instead.
//
// `input()` shapes the same underlying facts as the `FragmentInput` that `buildMapFragment`
// takes, so the fragment suite, the rendered-HTML goldens and assemble.test.ts all describe one
// org. Since 1.0 retired coupling-graph.json and landscape-manifest.json, the fragment built
// from `input()` is the only model of this fixture's couplings that anything renders.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseFlowXml } from '../../../../src/map/flow/parseFlow.js';
import { assembleCouplingArtifacts, type MapArtifacts } from '../../../../src/map/assemble.js';
import type { NodeInfo } from '../../../../src/map/graph/couplingGraph.js';
import type { ApexClassInput, ApexTriggerInput } from '../../../../src/map/apex/apexTypes.js';
import type { FragmentInput } from '../../../../src/map/fragment.js';
import type { LayoutEdge } from '../../../../src/map/graph/layout.js';

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
 * Fixed capture provenance. `capturedAt` is the only field that would otherwise move between
 * runs, and pinning it here is what makes the rendered-HTML goldens a comparison of the renderer
 * rather than a test of the clock.
 */
export const PROVENANCE = {
  toolVersion: '0.0.0-test',
  generatedAt: '2026-01-01T00:00:00Z',
  orgId: 'org1',
};

/** The deterministic assembleCouplingArtifacts() call every map-assembly suite shares. */
export function artifacts(): MapArtifacts {
  return assembleCouplingArtifacts({
    flowSummaries: flowSummaries(),
    apexClasses: apexClasses(),
    apexTriggers: apexTriggers(),
    knownObjects: knownObjects(),
    nodeInfo,
    notes: [],
  });
}

/**
 * The merged edge list `assembleCouplingArtifacts` produced -- read back off `artifacts()` rather
 * than recomputed, so anything resolving against these edges (the navigation view, the fragment)
 * gets the exact set the assembly built, not a second set free to drift from it.
 */
export function edges(): LayoutEdge[] {
  return artifacts().edges;
}

/**
 * The `FragmentInput` for `buildMapFragment`. Carries the same edges `artifacts()` produced, the
 * same raw facts that fed it, the same nodeInfo, and fixed capture provenance, so the fragment
 * suite (fragment.test.ts) describes the same org as assemble.test.ts and the render goldens.
 */
export function input(): FragmentInput {
  return {
    edges: artifacts().edges,
    flowSummaries: flowSummaries(),
    apexClasses: apexClasses(),
    apexTriggers: apexTriggers(),
    nodeInfo,
    // The exact set artifacts() already builds its coupling graph against -- not a set derived
    // from the edges above, which is the bug task 1 fixes.
    knownObjects: knownObjects(),
    workflowRulesFor: () => 0,
    capturedAt: PROVENANCE.generatedAt,
    orgId: PROVENANCE.orgId,
    analysed: { flows: 2, apexClasses: 1, apexTriggers: 0 },
  };
}

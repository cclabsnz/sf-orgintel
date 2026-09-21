import { describe, it, expect } from '@jest/globals';
import { DEFAULT_BRANDING } from '@cclabsnz/sf-core';
import type { CouplingGraph } from '@cclabsnz/sf-core';
import { buildMapReportInput, buildMapCommandResult } from '../../../src/commands/intel/map.js';
import { renderMapHtml } from '../../../src/report/mapReport.js';
import type { MapRunResult } from '../../../src/map/runMap.js';

const couplingGraph: CouplingGraph = {
  version: 1,
  provenance: {
    tool: 'orgintel',
    toolVersion: '0.1.0',
    generatedAt: '2026-01-01T00:00:00.000Z',
    orgId: '00D',
    evidenceTier: 'B',
  },
  nodes: [],
  edges: [],
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const baseResult = (): MapRunResult => ({
  couplingGraph,
  manifest: {} as any,
  fragment: {} as any,
  clusters: [],
  layout: new Map(),
  timelines: [],
  flowsAnalyzed: 210,
  apexClassesAnalyzed: 3,
  apexTriggersAnalyzed: 2,
  flowsListed: 340,
  apexClassesListed: 9,
  apexTriggersListed: 4,
  notes: [],
});

/**
 * `buildMapReportInput` is what `IntelMapCommand.run()` calls to assemble the object it hands to
 * `renderMapHtml` on the real `--html` path. Before this task, `run()` built that object inline
 * and copied `flowsAnalyzed`/`apexClassesAnalyzed`/`apexTriggersAnalyzed` but never the `*Listed`
 * counterparts, so `mapReport.test.ts` -- which calls `renderMapHtml` directly -- passed in full
 * while the actual command still rendered the bare figure. These tests exercise the same
 * assembly function `run()` calls, so a caller that stops forwarding the listed fields fails here
 * even though it would still pass every test that only calls `renderMapHtml` directly.
 *
 * This does not invoke `IntelMapCommand.run()` itself -- that requires a live org connection via
 * `getConnection`/`resolveOrgInfo`/`buildIntelContext`, which no test in this repo sets up. What it
 * proves: the object `run()`'s `--html` branch passes to `renderMapHtml` carries the listed counts
 * from the run result, and rendering that object actually produces "N of M" text. It does not
 * prove `run()` calls this function with the right arguments at the right time -- that is left to
 * the source reading in the task report, not to this test.
 */
describe('buildMapReportInput', () => {
  it('forwards the listed counts from the run result onto the report input', () => {
    const input = buildMapReportInput({
      orgName: 'Acme',
      result: baseResult(),
      anchors: undefined,
      evidenceTier: 'B',
      branding: DEFAULT_BRANDING,
    });

    expect(input.flowsListed).toBe(340);
    expect(input.apexClassesListed).toBe(9);
    expect(input.apexTriggersListed).toBe(4);
  });

  it('renders "N of M" from the object the real command path assembles', () => {
    const html = renderMapHtml(
      buildMapReportInput({
        orgName: 'Acme',
        result: baseResult(),
        anchors: undefined,
        evidenceTier: 'B',
        branding: DEFAULT_BRANDING,
      }),
    );

    expect(html).toContain('210 of 340');
  });

  it('still renders the bare figure when the run result carries no census', () => {
    const result = baseResult();
    result.flowsListed = undefined;

    const html = renderMapHtml(
      buildMapReportInput({
        orgName: 'Acme',
        result,
        anchors: undefined,
        evidenceTier: 'B',
        branding: DEFAULT_BRANDING,
      }),
    );

    expect(html).toContain('210');
    expect(html).not.toContain('210 of');
  });
});

/**
 * `buildMapCommandResult` is the JSON-path counterpart to `buildMapReportInput`: what `run()`
 * returns for `--json` (and for `this.printSummary` consumers reading the resolved value). Spec
 * 2.1 states both numbers "wherever it states a count" -- `MapCommandResult` states
 * `flowsAnalyzed`, so it owes the same denominator the HTML report now carries. Same rationale as
 * above: this is the exact function `run()` calls for the returned/`--json` shape, so a caller
 * that stops forwarding the listed fields fails here without needing a live org connection.
 */
describe('buildMapCommandResult', () => {
  it('forwards the listed counts from the run result onto the JSON result', () => {
    const commandResult = buildMapCommandResult(baseResult());

    expect(commandResult.flowsListed).toBe(340);
    expect(commandResult.apexClassesListed).toBe(9);
    expect(commandResult.apexTriggersListed).toBe(4);
  });

  it('leaves the listed fields undefined, not zeroed, when the run result carries no census', () => {
    const result = baseResult();
    result.flowsListed = undefined;
    result.apexClassesListed = undefined;
    result.apexTriggersListed = undefined;

    const commandResult = buildMapCommandResult(result);

    expect(commandResult.flowsListed).toBeUndefined();
    expect(commandResult.apexClassesListed).toBeUndefined();
    expect(commandResult.apexTriggersListed).toBeUndefined();
  });

  it('still carries the analysed counts and the IR artifacts untouched', () => {
    const result = baseResult();
    const commandResult = buildMapCommandResult(result);

    expect(commandResult.flowsAnalyzed).toBe(210);
    expect(commandResult.apexClassesAnalyzed).toBe(3);
    expect(commandResult.apexTriggersAnalyzed).toBe(2);
    expect(commandResult.couplingGraph).toBe(result.couplingGraph);
    expect(commandResult.manifest).toBe(result.manifest);
    expect(commandResult.fragment).toBe(result.fragment);
  });
});

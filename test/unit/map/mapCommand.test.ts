import { describe, it, expect } from '@jest/globals';
import { DEFAULT_BRANDING } from '@cclabsnz/sf-core';
import type { QueryResult, SoqlClient, ToolingClient } from '@cclabsnz/sf-core';
import { buildMapReportInput, buildMapCommandResult } from '../../../src/commands/intel/map.js';
import { renderMapHtml } from '../../../src/report/mapReport.js';
import { runMap } from '../../../src/map/runMap.js';
import type { MapRunResult } from '../../../src/map/runMap.js';
import type { IntelContext } from '../../../src/lib/wire.js';
import { mockRest, noopMetadata } from '../helpers/mocks.js';

/**
 * Only the fields `buildMapReportInput`/`buildMapCommandResult` actually read. `capturedAt` is
 * among them: it is where the report's `generatedAt` now comes from, since 1.0 retired the
 * `CouplingGraph` whose provenance used to carry it.
 */
const baseResult = (): MapRunResult => ({
  fragment: { capturedAt: '2026-01-01T00:00:00.000Z', contributions: [], edges: [] } as any,
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

  it('still carries the analysed counts and the emitted fragment untouched', () => {
    const result = baseResult();
    const commandResult = buildMapCommandResult(result);

    expect(commandResult.flowsAnalyzed).toBe(210);
    expect(commandResult.apexClassesAnalyzed).toBe(3);
    expect(commandResult.apexTriggersAnalyzed).toBe(2);
    expect(commandResult.fragment).toBe(result.fragment);
  });

  it('no longer carries the retired IR artifacts', () => {
    // 1.0 stopped writing coupling-graph.json and landscape-manifest.json and deleted the models
    // behind them. `--json` must not keep restating them, under any key: a consumer reading
    // `couplingGraph` out of the result should find nothing there rather than a half-populated
    // shape rebuilt to keep the field alive.
    const json = JSON.parse(JSON.stringify(buildMapCommandResult(baseResult()))) as Record<string, unknown>;

    expect(Object.keys(json)).not.toContain('couplingGraph');
    expect(Object.keys(json)).not.toContain('manifest');
    expect(Object.keys(json)).toContain('fragment');
  });
});

/**
 * The end-to-end guard on the refused-read path, and the reason the two tests it replaced were
 * not enough.
 *
 * Those tests reached the "no census" state by assigning `undefined` onto a `MapRunResult`
 * literal by hand. That state was unreachable in production: `retrieve.ts` initialised every
 * listed counter to `0` and its catch blocks left it there, so `runMap` always had a number to
 * forward and the `undefined` branches in `analysedOf` and `buildMapCommandResult` could never
 * fire on a real run. The tests passed and covered nothing; meanwhile a refused read rendered
 * `Flows analysed: 0 of 0` and emitted `"flowsListed": 0`, positively asserting that the org
 * contains no flows AND that all of them were analysed.
 *
 * So this drives the value the only way that proves the machinery is connected: a real `runMap`
 * over an org whose `FlowDefinitionView`, `ApexClass` and `ApexTrigger` reads are all refused.
 * Nothing here mutates a census field. Every assertion below is downstream of what
 * `retrieveFlows`/`retrieveApex` actually chose to report about a refusal.
 */
const REFUSED = new Error('INSUFFICIENT_ACCESS: insufficient access rights on object id');

/** Refuses the three listing reads; answers everything else emptily. */
function refusingOrg(): IntelContext {
  const refuseListings = (q: string): void => {
    if (/FROM FlowDefinitionView/.test(q)) throw REFUSED;
    if (/FROM ApexClass/.test(q)) throw REFUSED;
    if (/FROM ApexTrigger\b/.test(q)) throw REFUSED;
  };
  const soql: SoqlClient = {
    async query<T>(q: string): Promise<QueryResult<T>> {
      refuseListings(q);
      return { totalSize: 0, done: true, records: [] as T[] };
    },
    async queryAll<T>(q: string): Promise<T[]> {
      refuseListings(q);
      return [] as T[];
    },
  };
  const tooling: ToolingClient = {
    async query<T>(q: string): Promise<T[]> {
      refuseListings(q);
      return [] as T[];
    },
    async getRecord<T>(): Promise<T> {
      throw new Error('not implemented');
    },
  };
  return {
    soql,
    tooling,
    rest: mockRest([]),
    metadata: noopMetadata,
    orgInfo: { id: '00D', name: 'Locked', type: 'Enterprise', isSandbox: true, instance: 'NA1', instanceUrl: 'https://x' },
    apiVersion: '62.0',
    namespace: null,
  };
}

const runRefused = (): Promise<MapRunResult> =>
  runMap(refusingOrg(), {
    generatedAt: '2026-01-01T00:00:00.000Z',
    toolVersion: '0.3.0',
    orgId: '00D',
    evidenceTier: null,
  });

describe('a run whose listing reads are all refused', () => {
  it('reaches the pipeline with no denominator at all, rather than a measured zero', async () => {
    const result = await runRefused();

    expect(result.flowsListed).toBeUndefined();
    expect(result.apexClassesListed).toBeUndefined();
    expect(result.apexTriggersListed).toBeUndefined();
    // Analysed genuinely is zero: nothing was parsed. That is a measurement, and it stands.
    expect(result.flowsAnalyzed).toBe(0);
    expect(result.apexClassesAnalyzed).toBe(0);
    expect(result.apexTriggersAnalyzed).toBe(0);
    // And the run says why, rather than leaving a reader to infer an empty org from the zeroes.
    expect(result.notes.some((n) => n.includes('FlowDefinitionView is not queryable'))).toBe(true);
    expect(result.notes.some((n) => n.includes('ApexClass is not queryable'))).toBe(true);
    expect(result.notes.some((n) => n.includes('ApexTrigger is not queryable'))).toBe(true);
  });

  it('omits the listed fields from --json entirely, rather than serialising them as 0', async () => {
    const commandResult = buildMapCommandResult(await runRefused());
    const json = JSON.parse(JSON.stringify(commandResult)) as Record<string, unknown>;

    // Not just `undefined` on the object: absent from the emitted JSON. A consumer reading
    // `flowsListed` out of `--json` must find nothing there, not a zero it would believe.
    expect(Object.keys(json)).not.toContain('flowsListed');
    expect(Object.keys(json)).not.toContain('apexClassesListed');
    expect(Object.keys(json)).not.toContain('apexTriggersListed');
  });

  it('renders the bare figure in HTML, never "0 of 0"', async () => {
    const html = renderMapHtml(
      buildMapReportInput({
        orgName: 'Locked',
        result: await runRefused(),
        anchors: undefined,
        evidenceTier: null,
        branding: DEFAULT_BRANDING,
      }),
    );

    expect(html).not.toContain('0 of 0');
    expect(html).toContain('Flows analysed');
    // The refusals are surfaced to whoever reads the report later, not only to the terminal.
    expect(html).toContain('FlowDefinitionView is not queryable');
  });
});

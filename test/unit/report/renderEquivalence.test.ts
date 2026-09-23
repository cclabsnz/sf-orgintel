// Spec 5. Task 2 deletes the CouplingGraph assembly and the golden tests pinning its artifacts.
// A guarantee written after that deletion could only pin whatever the deletion produced. So the
// two render routes are compared here, while both still exist.
import { describe, it, expect } from '@jest/globals';
import { DEFAULT_BRANDING, type CouplingGraph } from '@cclabsnz/sf-core';
import { renderMapHtml, type MapReportInput } from '../../../src/report/mapReport.js';
import { renderStrataViewer } from '../../../src/report/strataViewer.js';
import { buildMapFragment } from '../../../src/map/fragment.js';
import { couplingViewOf, type CouplingView } from '../../../src/report/couplingView.js';
import { artifacts, input } from '../map/fixtures/input.js';

/** A minimal valid MapReportInput around the given graph, with a fixed clock so the comparison
 *  is not a test of the clock. */
function baseInput(graph: CouplingGraph | CouplingView): MapReportInput {
  return {
    orgName: 'Fixture Org',
    couplingGraph: graph,
    clusters: artifacts().clusters,
    layout: artifacts().layout,
    evidenceTier: null,
    flowsAnalyzed: 2,
    apexClassesAnalyzed: 1,
    apexTriggersAnalyzed: 0,
    generatedAt: '2026-01-01T00:00:00Z',
    branding: DEFAULT_BRANDING,
  };
}

describe('rendering from the fragment matches rendering from CouplingGraph', () => {
  it('produces byte-identical map report HTML', () => {
    const legacy = renderMapHtml(baseInput(artifacts().couplingGraph));
    const fragmentBased = renderMapHtml(baseInput(couplingViewOf(buildMapFragment(input()))));

    expect(fragmentBased).toBe(legacy);
  });

  it('produces byte-identical strata viewer HTML', () => {
    const objects = artifacts().couplingGraph.nodes.map((n) => n.object);
    const legacy = renderStrataViewer({ couplingGraph: artifacts().couplingGraph, objects });
    const fragmentBased = renderStrataViewer({
      couplingGraph: couplingViewOf(buildMapFragment(input())),
      objects,
    });

    expect(fragmentBased).toBe(legacy);
  });

  it('compares a non-trivial document, not an empty one', () => {
    // Without this, both sides returning '' would pass and prove nothing.
    expect(renderMapHtml(baseInput(artifacts().couplingGraph)).length).toBeGreaterThan(2000);
  });
});

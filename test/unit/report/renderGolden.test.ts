// The rendered-HTML counterpart to renderEquivalence.test.ts, and the one guarantee in this
// repo that survives Task 2's deletion of the CouplingGraph assembly and its golden suites.
//
// renderEquivalence.test.ts compares the legacy route against the fragment route while both
// exist; that comparison stops meaning anything the moment one side is deleted. These fixtures
// were captured from the legacy route before that deletion, so this suite keeps asserting the
// fragment route reproduces them byte for byte after the legacy route is gone -- it is a golden
// of the HTML itself, not of one route agreeing with the other.
import { describe, it, expect } from '@jest/globals';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DEFAULT_BRANDING } from '@cclabsnz/sf-core';
import { renderMapHtml, type MapReportInput } from '../../../src/report/mapReport.js';
import { renderStrataViewer } from '../../../src/report/strataViewer.js';
import { buildMapFragment } from '../../../src/map/fragment.js';
import { couplingViewOf } from '../../../src/report/couplingView.js';
import { artifacts, input } from '../map/fixtures/input.js';

const FIXTURES = join(process.cwd(), 'test/unit/report/fixtures');

function baseInput(graph: MapReportInput['couplingGraph']): MapReportInput {
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

describe('fragment-based rendering reproduces the persisted golden HTML', () => {
  it('matches the map report golden byte for byte', () => {
    const golden = readFileSync(join(FIXTURES, 'mapReport.golden.html'), 'utf8');
    const actual = renderMapHtml(baseInput(couplingViewOf(buildMapFragment(input()))));

    expect(actual).toBe(golden);
  });

  it('matches the strata viewer golden byte for byte', () => {
    const golden = readFileSync(join(FIXTURES, 'strataViewer.golden.html'), 'utf8');
    const objects = artifacts().couplingGraph.nodes.map((n) => n.object);
    const actual = renderStrataViewer({
      couplingGraph: couplingViewOf(buildMapFragment(input())),
      objects,
    });

    expect(actual).toBe(golden);
  });
});

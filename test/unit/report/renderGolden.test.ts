// The only thing in this repo pinning the rendered HTML, and deliberately so.
//
// renderEquivalence.test.ts compared the legacy CouplingGraph route against the fragment route
// while both existed; that comparison stopped meaning anything the moment 1.0 deleted one side,
// and it went with it. These fixtures were captured from the legacy route BEFORE that deletion,
// so this suite still asserts the fragment route reproduces byte for byte what the legacy route
// produced -- it is a golden of the HTML itself, not of one route agreeing with the other.
//
// Do not regenerate these fixtures to make a failure go away. A regenerated golden pins whatever
// the change produced, which is exactly the guarantee this file exists to refuse.
//
// One exception, and only one. `mapReport.golden.html` is ~190KB, nearly all of it the base64
// web-font CSS that `@cclabsnz/sf-core`'s `fontFaceCss()` inlines through `src/report/shell.ts`.
// A `pnpm update` that moves sf-core within `^0.6.0` can therefore redden this suite over font
// bytes, with nothing in this repo having changed. Regenerating is legitimate for THAT failure --
// but only after reading the diff and confirming the change is confined to the `@font-face`
// block. A diff that also touches the report's own markup is the failure this file is for, and
// the dependency bump is not a licence to pin it.
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
    // The object list used to come off `couplingGraph.nodes`. That model is gone; the view's own
    // nodes are the fragment-route equivalent, and the byte comparison below is what proves the
    // two lists were the same for this fixture.
    const view = couplingViewOf(buildMapFragment(input()));
    const actual = renderStrataViewer({ couplingGraph: view, objects: view.nodes.map((n) => n.object) });

    expect(actual).toBe(golden);
  });
});

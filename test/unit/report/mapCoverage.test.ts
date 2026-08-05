import { DEFAULT_BRANDING } from '@cclabsnz/sf-core';
import type { CouplingGraph, CouplingGraphEdge } from '@cclabsnz/sf-core';
import { renderMapHtml } from '../../../src/report/mapReport.js';

const edge = (
  from: string,
  to: string,
  confidences: Array<'high' | 'approximate'>,
): CouplingGraphEdge => ({
  from,
  to,
  weight: confidences.length,
  operations: ['read'],
  components: confidences.map((c, i) => ({ type: 'ApexClass', name: `C${i}`, confidence: c })),
});

const render = (edges: CouplingGraphEdge[], notes?: string[]): string =>
  renderMapHtml({
    orgName: 'Example Org',
    couplingGraph: {
      version: 1,
      provenance: { generatedAt: '2026-08-04T00:00:00Z' },
      nodes: [],
      edges,
    } as unknown as CouplingGraph,
    clusters: [],
    layout: new Map(),
    evidenceTier: null,
    notes,
    flowsAnalyzed: 0,
    apexClassesAnalyzed: 0,
    apexTriggersAnalyzed: 0,
    generatedAt: '2026-08-04T00:00:00Z',
    branding: DEFAULT_BRANDING,
  });

describe('map report — coverage and confidence', () => {
  it('states the approximate share where a reader cannot miss it', () => {
    const html = render([edge('Account', 'Contact', ['approximate', 'approximate', 'high'])]);
    expect(html).toContain('Coverage and confidence');
    expect(html).toMatch(/67% of coupling evidence is approximate/);
  });

  it('places the caveat above the graph it qualifies', () => {
    // A caveat below the picture is a caveat most readers never reach.
    const html = render([edge('Account', 'Contact', ['approximate'])]);
    expect(html.indexOf('Coverage and confidence')).toBeLessThan(html.indexOf('Coupling graph'));
  });

  it('surfaces what was skipped, which previously only the terminal ever saw', () => {
    const html = render(
      [edge('Account', 'Contact', ['high'])],
      ['110 managed-package flow(s) skipped — metadata is not readable for managed flows.'],
    );
    expect(html).toContain('Not analysed');
    expect(html).toContain('110 managed-package flow(s) skipped');
  });

  it('says plainly when nothing was skipped rather than leaving the section blank', () => {
    const html = render([edge('Account', 'Contact', ['high'])]);
    expect(html).toContain('Nothing was skipped');
  });

  it('escapes note text rather than trusting it as markup', () => {
    const html = render([edge('Account', 'Contact', ['high'])], ['<img src=x onerror=alert(1)>']);
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;img');
  });

  it('does not claim exactness for an edge with one exact component among approximate ones', () => {
    const html = render([edge('Account', 'Contact', ['high', 'approximate'])]);
    expect(html).toContain('mixed');
  });
});

describe('map report — coverage table chips', () => {
  // Caught by reading a real report, not by a unit test: every non-exact row mapped to an
  // 'approximate' chip, so the Mixed row rendered "Mixed … approximate" and asserted two
  // different things about the same number.
  it('labels each row with its own confidence, not a collapsed one', () => {
    const html = render([
      edge('A', 'B', ['high']),
      edge('C', 'D', ['high', 'approximate']),
      edge('E', 'F', ['approximate']),
    ]);
    const rows = html.slice(html.indexOf('Coupled pairs by evidence'), html.indexOf('Not analysed'));

    expect(rows).toMatch(/Mixed<\/td>[\s\S]*?chip[^>]*>mixed</);
    expect(rows).toMatch(/Exact<\/td>[\s\S]*?chip[^>]*>high</);
    expect(rows).toMatch(/Approximate<\/td>[\s\S]*?chip[^>]*>approximate</);
  });
});

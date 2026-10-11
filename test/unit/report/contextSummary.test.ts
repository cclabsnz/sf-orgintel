import { describe, it, expect } from '@jest/globals';
import { DEFAULT_BRANDING, type CanonicalGraph, type GraphEdge } from '@cclabsnz/sf-core';
import { contextRowsOf } from '../../../src/report/contextSummary.js';
import { renderMapHtml } from '../../../src/report/mapReport.js';
import { couplingViewOf } from '../../../src/report/couplingView.js';

/**
 * OBJECT_ROLES_SPEC 2.3. Pairs with a non-business object are no longer couplings, so the report
 * states them as what the business objects depend on, by role. Without it, "the business model is
 * wired into the permission model" would vanish from the page along with the noise.
 */
const uses = (from: string, to: string, roles: { from: string; to: string }, weight: number): GraphEdge => ({
  from: `obj.${from}`,
  to: `obj.${to}`,
  kind: 'uses',
  attrs: { weight, operations: ['read'], components: [], roles },
  provenance: { source: 'derived', rule: 'map.coupling.context-by-object-role', capturedAt: '2026-01-01T00:00:00Z' },
});

const fragment = (edges: GraphEdge[]): CanonicalGraph => ({
  schemaVersion: '1.2.0',
  capturedAt: '2026-01-01T00:00:00Z',
  orgId: 'org1',
  nodes: [],
  edges,
  coverage: { notes: [], unavailable: [] },
  producer: 'orgintel',
  contributions: [],
});

describe('contextRowsOf', () => {
  it('totals pairs and weight per non-business role, heaviest first, naming its objects', () => {
    const rows = contextRowsOf(
      fragment([
        uses('Account', 'User', { from: 'entity', to: 'actor' }, 5),
        uses('Case', 'User', { from: 'entity', to: 'actor' }, 2),
        uses('Case', 'RecordType', { from: 'entity', to: 'qualifier' }, 3),
      ]),
    );

    expect(rows).toEqual([
      { role: 'actor', pairs: 2, weight: 7, objects: ['User'] },
      { role: 'qualifier', pairs: 1, weight: 3, objects: ['RecordType'] },
    ]);
  });
});

describe('the report section', () => {
  const render = (context: ReturnType<typeof contextRowsOf>) =>
    renderMapHtml({
      orgName: 'Org',
      couplingGraph: couplingViewOf(fragment([])),
      clusters: [],
      layout: new Map(),
      evidenceTier: null,
      flowsAnalyzed: 0,
      apexClassesAnalyzed: 0,
      apexTriggersAnalyzed: 0,
      generatedAt: '2026-01-01T00:00:00Z',
      branding: DEFAULT_BRANDING,
      context,
    });

  it('states what the business objects depend on, by role', () => {
    const html = render([{ role: 'actor', pairs: 2, weight: 7, objects: ['User'] }]);
    expect(html).toContain('What the business objects depend on');
    expect(html).toContain('actor');
    expect(html).toContain('User');
  });

  it('is omitted when there is no context to state', () => {
    expect(render([])).not.toContain('What the business objects depend on');
  });
});

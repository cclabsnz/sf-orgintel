import { describe, it, expect } from '@jest/globals';
import { DEFAULT_BRANDING } from '@cclabsnz/sf-core';
import { renderMapHtml } from '../../../src/report/mapReport.js';
import type { CouplingView } from '../../../src/report/couplingView.js';
import type { MapReportInput } from '../../../src/report/mapReport.js';
import type { Cluster } from '../../../src/map/graph/clusters.js';
import type { Point } from '../../../src/map/graph/layout.js';

// A `CouplingView` literal, not the `CouplingGraph` this used to build: 1.0 retired that document
// and the report now takes only what `couplingViewOf` produces from the fragment. `layer` was
// absent before and the renderer fell back to `roleOf`; it is stated here as the value `roleOf`
// returns for these two objects, so the rendered output is unchanged.
const GENERATED_AT = '2026-07-26T00:00:00.000Z';
const graph: CouplingView = {
  nodes: [
    { object: 'Case', layer: 'business', automationCounts: { flows: 3, triggers: 1, approvals: 0 }, recordCount90d: 100 },
    { object: 'WorkOrder', layer: 'business', automationCounts: { flows: 1, triggers: 0, approvals: 0 }, recordCount90d: 50 },
  ],
  edges: [
    { from: 'Case', to: 'WorkOrder', weight: 4, operations: ['create', 'update'], components: [{ type: 'Flow', name: 'Case_Router', confidence: 'high' }] },
  ],
};
const clusters: Cluster[] = [{ id: 'cluster-1', objects: ['Case', 'WorkOrder'], anchorObject: 'Case' }];
const layout = new Map<string, Point>([
  ['Case', { x: 200, y: 300 }],
  ['WorkOrder', { x: 500, y: 320 }],
]);

const baseInput = (): MapReportInput => ({
  orgName: 'Test',
  couplingGraph: graph,
  clusters,
  layout,
  evidenceTier: null,
  flowsAnalyzed: 0,
  apexClassesAnalyzed: 0,
  apexTriggersAnalyzed: 0,
  generatedAt: '2026-01-01T00:00:00Z',
  branding: DEFAULT_BRANDING,
});

describe('renderMapHtml', () => {
  it('renders a self-contained report with an SVG graph and the coupling table', () => {
    const html = renderMapHtml({
      orgName: 'Acme',
      couplingGraph: graph,
      clusters,
      layout,
      evidenceTier: 'B',
      flowsAnalyzed: 5,
      apexClassesAnalyzed: 3,
      apexTriggersAnalyzed: 2,
      generatedAt: GENERATED_AT,
      branding: DEFAULT_BRANDING,
    });
    expect(html.startsWith('<!DOCTYPE html>')).toBe(true);
    expect(html).toContain('Cross-Object Coupling Map');
    expect(html).toContain('<svg');
    expect(html).toContain('Case ↔ WorkOrder');
    expect(html).toContain('Process backbones');
    // No cached discover -> anchors note
    expect(html).toContain('Run <code>sf intel discover</code>');
  });

  it('shows anchors when cached discover results are supplied', () => {
    const html = renderMapHtml({
      orgName: 'Acme',
      couplingGraph: graph,
      clusters,
      layout,
      anchors: [{ object: 'Case', label: 'Case', score: 0.91 }],
      evidenceTier: 'B',
      flowsAnalyzed: 5,
      apexClassesAnalyzed: 3,
      apexTriggersAnalyzed: 2,
      generatedAt: GENERATED_AT,
      branding: DEFAULT_BRANDING,
    });
    expect(html).toContain('from cached discover');
    expect(html).toContain('0.910');
  });
});

describe('layer section', () => {
  /** A graph spanning several layers, as a real org's does. */
  const layered: CouplingView = {
    nodes: [
      { object: 'Account', automationCounts: { flows: 3, triggers: 1, approvals: 0 }, recordCount90d: 100, layer: 'business' },
      { object: 'Case', automationCounts: { flows: 2, triggers: 0, approvals: 0 }, recordCount90d: 50, layer: 'business' },
      { object: 'User', automationCounts: { flows: 0, triggers: 0, approvals: 0 }, recordCount90d: 10, layer: 'security' },
      { object: 'LogEntry__c', automationCounts: { flows: 0, triggers: 0, approvals: 0 }, recordCount90d: 900, layer: 'observability' },
    ],
    edges: [
      { from: 'Account', to: 'Case', weight: 8, operations: ['update'], components: [{ type: 'Flow', name: 'F1', confidence: 'high' }] },
      { from: 'Account', to: 'User', weight: 12, operations: ['read'], components: [{ type: 'ApexClass', name: 'C1', confidence: 'approximate' }] },
      { from: 'LogEntry__c', to: 'User', weight: 5, operations: ['create'], components: [{ type: 'ApexClass', name: 'C2', confidence: 'approximate' }] },
    ],
  };

  const html = renderMapHtml({
    orgName: 'Test Org',
    couplingGraph: layered,
    clusters: [{ id: 'cluster-1', objects: ['Account', 'Case'], anchorObject: 'Account' }],
    layout: new Map([['Account', { x: 10, y: 10 }], ['Case', { x: 50, y: 50 }]]),
    evidenceTier: 'B',
    flowsAnalyzed: 1,
    apexClassesAnalyzed: 2,
    apexTriggersAnalyzed: 0,
    generatedAt: '2026-07-30T00:00:00.000Z',
    branding: DEFAULT_BRANDING,
  });

  it('reports every layer present with its object count', () => {
    expect(html).toContain('business');
    expect(html).toContain('security');
    expect(html).toContain('observability');
  });

  it('shows the cross-layer relationships, heaviest first', () => {
    // business↔security (weight 12) must be reported above business-internal (8) — the
    // ordering is the finding, not decoration.
    const cross = html.indexOf('business ↔ security');
    const internal = html.indexOf('business (internal)');
    expect(cross).toBeGreaterThan(-1);
    expect(internal).toBeGreaterThan(-1);
    expect(cross).toBeLessThan(internal);
  });

  it('does not hide infrastructure objects from the reader', () => {
    // The whole point of classifying rather than filtering.
    expect(html).toContain('User');
    expect(html).toContain('LogEntry__c');
  });

  it('stays self-contained — no remote assets', () => {
    expect(html).not.toMatch(/<script[^>]+\ssrc=/i);
    expect(html).not.toMatch(/<link[^>]+\srel=["']?stylesheet/i);
  });
});

describe('analysed-versus-listed coverage', () => {
  it('states what was analysed against what was listed', () => {
    const html = renderMapHtml({ ...baseInput(), flowsAnalyzed: 210, flowsListed: 340 });

    expect(html).toContain('210 of 340');
  });

  it('states the bare figure when nothing listed it', () => {
    // A caller with no census must not render "210 of 0", which claims more flows were parsed
    // than exist. Absent is not zero -- the same distinction coverage.unavailable carries.
    const html = renderMapHtml({ ...baseInput(), flowsAnalyzed: 210, flowsListed: undefined });

    expect(html).toContain('210');
    expect(html).not.toContain('210 of');
  });
});

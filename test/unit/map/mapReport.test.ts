import { describe, it, expect } from '@jest/globals';
import { DEFAULT_BRANDING } from '@cclabsnz/sf-core';
import type { CouplingGraph } from '@cclabsnz/sf-core';
import { renderMapHtml } from '../../../src/report/mapReport.js';
import type { Cluster } from '../../../src/map/graph/clusters.js';
import type { Point } from '../../../src/map/graph/layout.js';

const graph: CouplingGraph = {
  version: 1,
  provenance: { tool: 'orgintel', toolVersion: '0.1.0', generatedAt: '2026-07-26T00:00:00.000Z', orgId: '00D', evidenceTier: 'B' },
  nodes: [
    { object: 'Case', custom: false, automationCounts: { flows: 3, triggers: 1, approvals: 0 }, recordCount90d: 100 },
    { object: 'WorkOrder', custom: false, automationCounts: { flows: 1, triggers: 0, approvals: 0 }, recordCount90d: 50 },
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
      generatedAt: graph.provenance.generatedAt,
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
      generatedAt: graph.provenance.generatedAt,
      branding: DEFAULT_BRANDING,
    });
    expect(html).toContain('from cached discover');
    expect(html).toContain('0.910');
  });
});

describe('layer section', () => {
  /** A graph spanning several layers, as a real org's does. */
  const layered = {
    version: 1 as const,
    provenance: {
      tool: 'orgintel' as const, toolVersion: '0.1.0', generatedAt: '2026-07-30T00:00:00.000Z',
      orgId: '00Dxx0000000000EAA', evidenceTier: 'B' as const,
    },
    nodes: [
      { object: 'Account', custom: false, automationCounts: { flows: 3, triggers: 1, approvals: 0 }, recordCount90d: 100, layer: 'business' as const },
      { object: 'Case', custom: false, automationCounts: { flows: 2, triggers: 0, approvals: 0 }, recordCount90d: 50, layer: 'business' as const },
      { object: 'User', custom: false, automationCounts: { flows: 0, triggers: 0, approvals: 0 }, recordCount90d: 10, layer: 'security' as const },
      { object: 'LogEntry__c', custom: true, automationCounts: { flows: 0, triggers: 0, approvals: 0 }, recordCount90d: 900, layer: 'observability' as const },
    ],
    edges: [
      { from: 'Account', to: 'Case', weight: 8, operations: ['update' as const], components: [{ type: 'Flow', name: 'F1', confidence: 'high' as const }] },
      { from: 'Account', to: 'User', weight: 12, operations: ['read' as const], components: [{ type: 'ApexClass', name: 'C1', confidence: 'approximate' as const }] },
      { from: 'LogEntry__c', to: 'User', weight: 5, operations: ['create' as const], components: [{ type: 'ApexClass', name: 'C2', confidence: 'approximate' as const }] },
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

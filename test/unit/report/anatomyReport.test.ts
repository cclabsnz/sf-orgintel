import { DEFAULT_BRANDING } from '@cclabsnz/sf-core';
import { renderAnatomyHtml } from '../../../src/report/anatomyReport.js';
import type { AnatomyArtifact } from '../../../src/anatomy/types.js';

// The plan's helper predates `coverage.unavailable`, added in task 1b so bands classify from
// data rather than prose. It is required now, so the helper supplies an empty list.
const artifact = (over: Partial<AnatomyArtifact> = {}): AnatomyArtifact => ({
  version: 1,
  provenance: { generatedAt: '2026-08-12T00:00:00Z', orgId: '00Dxx0000000000EAA', toolVersion: '0.1.0', apiVersion: '62.0' },
  products: [],
  personas: [],
  channels: [],
  capabilities: {
    apexClasses: 0, apexTriggers: 0, flows: 0, lwc: 0, aura: 0,
    platformEvents: [], changeDataCapture: [], namedCredentials: 0,
    externalDataSources: 0, remoteSites: 0, eventRelayConfigured: false,
  },
  identity: { ssoConfigs: [], loginsByType: [] },
  edges: [],
  coverage: {
    apexBodiesScanned: 0, apexBodiesUnreadable: 0, omniElementsScanned: 0,
    omniProceduresWithIntegrationElements: 0, omniElementsSkippedSuperseded: 0,
    prefixesUnresolved: [], notes: [], unavailable: [],
  },
  ...over,
});

const render = (over: Partial<AnatomyArtifact> = {}): string =>
  renderAnatomyHtml({ orgName: 'Example Org', artifact: artifact(over), generatedAt: '2026-08-12T00:00:00Z', branding: DEFAULT_BRANDING });

describe('renderAnatomyHtml', () => {
  it('renders all seven band titles even when the org is empty', () => {
    const html = render();
    for (const title of ['Users', 'Channels', 'Products', 'Capabilities', 'Integration', 'External', 'Ops']) {
      expect(html).toContain(title);
    }
  });

  it('puts the coverage section above the drawing it qualifies', () => {
    // Same rule as the map report: a caveat below the picture is one most readers never reach.
    const html = render();
    expect(html.indexOf('Coverage')).toBeLessThan(html.indexOf('<svg'));
  });

  it('says a band was never collected, rather than leaving it silently blank', () => {
    // Driven by coverage.unavailable, the structured marker, never by matching note prose.
    const html = render({
      coverage: {
        ...artifact().coverage,
        unavailable: [{ scope: 'channels.network', reason: 'deferred', detail: 'The Network join was not attempted.' }],
      },
    });
    expect(html).toContain('The Network join was not attempted.');
    expect(html).toContain('Not collected');
  });

  it('says a band is empty when the org genuinely has none of that thing', () => {
    // "None" and "not collected" must not render the same, which is the whole point of emptiness.
    const html = render({ coverage: { ...artifact().coverage, unavailable: [] } });
    expect(html).toContain('None found');
  });

  it('marks a tile whose count could not be read, instead of showing a confident zero', () => {
    const html = render({
      coverage: {
        ...artifact().coverage,
        unavailable: [{ scope: 'capabilities.flows', reason: 'failed', detail: 'FlowDefinitionView was not queryable.' }],
      },
    });
    expect(html).toContain('not read');
    expect(html).toContain('FlowDefinitionView was not queryable.');
  });

  it('lists the coverage notes it was given', () => {
    const html = render({ coverage: { ...artifact().coverage, notes: ['Channels currently reflect Site only; the Network join was not attempted.'] } });
    expect(html).toContain('not attempted');
  });

  it('escapes org-supplied text rather than trusting it as markup', () => {
    const html = render({ products: [{ key: '<img src=x onerror=alert(1)>', label: '<img src=x onerror=alert(1)>', source: 'app', componentCount: 3, prefixes: ['X'] }] });
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;img');
  });

  it('makes no external requests', () => {
    const html = render();
    expect(html).not.toMatch(/https?:\/\/(?!www\.w3\.org)/);
  });

  it('is byte-identical for the same artifact', () => {
    expect(render()).toBe(render());
  });
});

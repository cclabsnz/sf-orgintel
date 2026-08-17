import { DEFAULT_BRANDING } from '@cclabsnz/sf-core';
import { renderAnatomyHtml } from '../../../src/report/anatomyReport.js';
import type { AnatomyArtifact } from '../../../src/anatomy/types.js';

// The plan's helper predates `coverage.unavailable`, added in task 1b so bands classify from
// data rather than prose. It is required now, so the helper supplies an empty list.
const artifact = (over: Partial<AnatomyArtifact> = {}): AnatomyArtifact => ({
  version: 2,
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

  it('qualifies a band that has tiles but was only partly gathered', () => {
    // Found by rendering a live org: ten site channels drew as a complete channel inventory
    // while three of the four channel types had never been attempted. The caveat has to sit on
    // the band, not only in the coverage table, because the band is what the reader looks at.
    const html = render({
      channels: [{ type: 'site', name: 'Portal', status: 'Active' }],
      coverage: {
        ...artifact().coverage,
        unavailable: [{ scope: 'channels.appConsoleApi', reason: 'deferred', detail: 'app, console and api channel types were not attempted.' }],
      },
    });
    expect(html).toContain('Partly collected');
    expect(html).toContain('app, console and api channel types were not attempted.');
  });

  it('flattens a multi-line failure detail onto one line before drawing it', () => {
    // Found on a live org without OmniStudio. The platform's error for an absent sObject is a
    // multi-line SOQL parse error carrying a fragment of the query and a caret, and an SVG text
    // node has no line breaks: every newline renders as a space, so the caveat came out as a
    // smear of query internals and the truncation budget went on them instead of the reason.
    // The artifact keeps the error verbatim; only the drawing is flattened.
    const detail =
      "OmniStudio elements could not be read: \nOmniProcess.Id FROM OmniProcessElement WHERE OmniProcess.OmniProcessType\n" +
      "                                      ^\nERROR at Row:1:Column:71\nsObject type 'OmniProcessElement' is not supported.";
    const html = render({
      edges: [{ endpoint: 'https://x.example', from: null, via: [], detection: 'namedCredential', attribution: 'unattributed' }],
      coverage: { ...artifact().coverage, unavailable: [{ scope: 'edges.omniStudio', reason: 'failed', detail }] },
    });

    const drawn = /<text x="16"[^>]*>Partly collected\.[^<]*/.exec(html)?.[0] ?? '';
    expect(drawn).not.toMatch(/[\n\r\t]/);
    expect(drawn).not.toMatch(/ {2}/);
    // The reason leads, and the echoed query is gone: flattening alone left the drawn line
    // opening with a column list and running out of width before saying anything useful.
    expect(drawn).toContain("could not be read: sObject type 'OmniProcessElement' is not supported.");
    expect(drawn).not.toContain('OmniProcess.Id FROM');
    // The artifact's verbatim text is still reachable, in the coverage table above the drawing.
    expect(html).toContain('OmniProcess.Id FROM OmniProcessElement');
  });

  it('leaves a detail alone when it carries no platform error to trim', () => {
    // The trim may only ever shorten a platform error, never rewrite a sentence a collector
    // wrote deliberately. A deferral is prose from us, and has to survive intact.
    const html = render({
      coverage: {
        ...artifact().coverage,
        unavailable: [{ scope: 'channels.network', reason: 'deferred', detail: 'The Network join: not attempted in this phase.' }],
      },
    });
    expect(html).toContain('Not collected. The Network join: not attempted in this phase.');
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
    // No host exemption, deliberately. The first cut carried `(?!www\.w3\.org)` for an SVG
    // namespace declaration this renderer never emits, and CodeQL was right to call it high
    // severity: the lookahead has no right-hand boundary, so `https://www.w3.org.attacker.com/x`
    // satisfies it and the assertion would have waved through the exact remote asset it exists to
    // catch. The report embeds its fonts as data URIs and draws inline SVG, so it needs no
    // protocol URL at all, and the honest assertion is that it contains none.
    const html = render();
    expect(html).not.toMatch(/https?:\/\//);
  });

  it('is byte-identical for the same artifact', () => {
    expect(render()).toBe(render());
  });
});

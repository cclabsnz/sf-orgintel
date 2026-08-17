import { buildBands } from '../../../src/anatomy/view/bands.js';
import type { AnatomyArtifact } from '../../../src/anatomy/types.js';

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

describe('buildBands', () => {
  it('always returns all seven bands, in fixed order', () => {
    const ids = buildBands(artifact()).map((b) => b.id);
    expect(ids).toEqual(['users', 'channels', 'products', 'capabilities', 'integration', 'external', 'ops']);
  });

  it('marks a band empty when the artifact was collected and held nothing', () => {
    const products = buildBands(artifact()).find((b) => b.id === 'products')!;
    expect(products.emptiness).toBe('empty');
    expect(products.tiles).toEqual([]);
  });

  it('marks a band not-collected when a structured entry says the data was never gathered', () => {
    // The distinction the whole artifact exists to preserve: "we looked and found none" is
    // not "we never looked". Driven by `coverage.unavailable`, not by matching note prose.
    const a = artifact({
      coverage: {
        ...artifact().coverage,
        unavailable: [
          { scope: 'channels.appConsoleApi', reason: 'deferred', detail: 'app, console and api channel types were not attempted.' },
          { scope: 'channels.network', reason: 'deferred', detail: 'The Network join was not attempted.' },
        ],
      },
    });
    const channels = buildBands(a).find((b) => b.id === 'channels')!;
    expect(channels.emptiness).toBe('not-collected');
    expect(channels.note).toMatch(/not attempted/);
  });

  it('marks the products band not-collected, not empty, when every products read failed', () => {
    // Review finding: only `channels` had a matching rule under the old prose-matching
    // mechanism, so a fully-failed collectProducts silently rendered `products` as `empty`
    // ("this org has no products") instead of `not-collected` ("we could not check").
    const a = artifact({
      coverage: {
        ...artifact().coverage,
        unavailable: [
          { scope: 'products.apps', reason: 'failed', detail: 'CustomApplication could not be read: denied' },
          { scope: 'products.packages', reason: 'failed', detail: 'InstalledSubscriberPackage could not be read: denied' },
          { scope: 'products.recordTypes', reason: 'failed', detail: 'RecordType could not be read: denied' },
        ],
      },
    });
    const products = buildBands(a).find((b) => b.id === 'products')!;
    expect(products.emptiness).toBe('not-collected');
    expect(products.tiles).toEqual([]);
  });

  it('marks the integration and external bands not-collected when edge collection failed', () => {
    const a = artifact({
      coverage: {
        ...artifact().coverage,
        unavailable: [
          { scope: 'edges.apexBodies', reason: 'failed', detail: 'Apex bodies could not be read: denied' },
          { scope: 'edges.omniStudio', reason: 'failed', detail: 'OmniStudio integration elements could not be read: denied' },
        ],
      },
    });
    const bands = buildBands(a);
    expect(bands.find((b) => b.id === 'integration')!.emptiness).toBe('not-collected');
    expect(bands.find((b) => b.id === 'external')!.emptiness).toBe('not-collected');
  });

  it('does not mark the users band not-collected from personas.landingApp alone', () => {
    // The judgment call from task 1, now expressed as data: landingApp is a field-level
    // deferral on an otherwise fully-collected record, not a category-level gap. activeUsers
    // is queried for real every run, so zero personas must still read as `empty`, not
    // `not-collected`.
    const a = artifact({
      coverage: {
        ...artifact().coverage,
        unavailable: [
          { scope: 'personas.landingApp', reason: 'deferred', detail: 'landingApp is not collected in this phase.' },
        ],
      },
    });
    const users = buildBands(a).find((b) => b.id === 'users')!;
    expect(users.emptiness).toBe('empty');
  });

  it('marks the users band not-collected when the active-user query itself failed', () => {
    const a = artifact({
      coverage: {
        ...artifact().coverage,
        unavailable: [{ scope: 'personas', reason: 'failed', detail: 'Active user counts could not be read: denied' }],
      },
    });
    const users = buildBands(a).find((b) => b.id === 'users')!;
    expect(users.emptiness).toBe('not-collected');
  });

  it('marks a fixed capability tile unavailable, rather than a confident zero, when its count failed', () => {
    const a = artifact({
      coverage: {
        ...artifact().coverage,
        unavailable: [{ scope: 'capabilities.apexClasses', reason: 'failed', detail: 'ApexClass count unavailable: denied' }],
      },
    });
    const capabilities = buildBands(a).find((b) => b.id === 'capabilities')!;
    const apexTile = capabilities.tiles.find((t) => t.id === 'apexClasses')!;
    expect(apexTile.unavailable).toBe(true);
    expect(apexTile.metric).toBe(0);
    const otherTile = capabilities.tiles.find((t) => t.id === 'flows')!;
    expect(otherTile.unavailable).toBe(false);
  });

  it('marks a fixed ops tile unavailable when its underlying read failed', () => {
    const a = artifact({
      coverage: {
        ...artifact().coverage,
        unavailable: [{ scope: 'capabilities.eventRelayConfigured', reason: 'failed', detail: 'EventRelayConfig read unavailable: denied' }],
      },
    });
    const ops = buildBands(a).find((b) => b.id === 'ops')!;
    expect(ops.tiles.find((t) => t.id === 'eventRelay')!.unavailable).toBe(true);
  });

  it('ignores coverage.notes entirely, even when its prose would have matched the old rule', () => {
    // Regression pin for the review finding: matching prose is brittle by construction. A note
    // that reads exactly like the old channels deferral sentence, with `unavailable` left
    // empty, must not flip any band to not-collected.
    const a = artifact({
      coverage: {
        ...artifact().coverage,
        notes: [
          'Channels currently reflect Site only; app, console and api channel types and the Network join were not attempted.',
          'landingApp is not collected in this phase; the UserAppInfo/AppDefinition join was not attempted.',
        ],
        unavailable: [],
      },
    });
    for (const band of buildBands(a)) {
      if (band.id === 'capabilities' || band.id === 'ops') continue; // always populated by construction
      expect(band.emptiness).toBe('empty');
    }
  });

  it('sets unavailable false on every non-fixed tile', () => {
    const a = artifact({ products: [{ key: 'ACME', label: 'ACME', source: 'app', componentCount: 1, prefixes: ['ACME'] }] });
    const products = buildBands(a).find((b) => b.id === 'products')!;
    expect(products.tiles.every((t) => t.unavailable === false)).toBe(true);
  });

  it('sizes a product tile by its component count and carries its key as the label', () => {
    const a = artifact({ products: [{ key: 'ACME', label: 'ACME', source: 'app', componentCount: 40, prefixes: ['ACME'] }] });
    const [tile] = buildBands(a).find((b) => b.id === 'products')!.tiles;
    expect(tile).toMatchObject({ label: 'ACME', metric: 40, sublabel: 'app' });
  });

  it('gives a persona tile a used-of-total fill only when a total is known', () => {
    const a = artifact({ personas: [{ profile: 'Support', licence: 'Salesforce', activeUsers: 7, landingApp: null }] });
    const [tile] = buildBands(a).find((b) => b.id === 'users')!.tiles;
    expect(tile.metric).toBe(7);
    expect(tile.fill).toBeNull();
  });

  it('reports an absent capability as a tile rather than omitting it', () => {
    // eventRelayConfigured false is a finding. A missing tile reads as "not checked".
    const ops = buildBands(artifact()).find((b) => b.id === 'ops')!;
    expect(ops.tiles.some((t) => /event relay/i.test(t.label))).toBe(true);
  });

  it('declares what a populated band still did not gather, instead of implying it is complete', () => {
    // Found by rendering a live org: the channels band drew ten site channels and nothing else,
    // while the artifact recorded that three of the four channel types and the Network join were
    // never attempted. A band with tiles was classified `populated` and stopped consulting
    // `coverage.unavailable` entirely, so the drawing asserted a complete channel inventory. That
    // is the same "we never looked" misreading `emptiness` exists to prevent, one band over.
    const a = artifact({
      channels: [{ type: 'site', name: 'Portal', status: 'Active' }],
      coverage: {
        ...artifact().coverage,
        unavailable: [
          { scope: 'channels.appConsoleApi', reason: 'deferred', detail: 'app, console and api channel types were not attempted.' },
          { scope: 'channels.network', reason: 'deferred', detail: 'The Network join was not attempted.' },
        ],
      },
    });
    const channels = buildBands(a).find((b) => b.id === 'channels')!;
    expect(channels.emptiness).toBe('populated');
    expect(channels.caveats).toEqual([
      'app, console and api channel types were not attempted.',
      'The Network join was not attempted.',
    ]);
  });

  it('does not caveat the users band for a field it never renders', () => {
    // The same asymmetry BAND_SCOPES already encodes for emptiness has to hold for caveats:
    // `personas.landingApp` defers one optional field, while `activeUsers`, the only reading the
    // band draws, is queried for real on every run. Caveating it would cry wolf on every org.
    const a = artifact({
      personas: [{ profile: 'Support', licence: 'Salesforce', activeUsers: 7, landingApp: null }],
      coverage: {
        ...artifact().coverage,
        unavailable: [{ scope: 'personas.landingApp', reason: 'deferred', detail: 'landingApp is not collected in this phase.' }],
      },
    });
    expect(buildBands(a).find((b) => b.id === 'users')!.caveats).toEqual([]);
  });

  it('leaves a band with nothing missing uncaveated', () => {
    for (const band of buildBands(artifact())) expect(band.caveats).toEqual([]);
  });

  it('is deterministic and sorts tiles within a band', () => {
    const a = artifact({ products: [
      { key: 'ZED', label: 'ZED', source: 'app', componentCount: 5, prefixes: ['ZED'] },
      { key: 'ACME', label: 'ACME', source: 'app', componentCount: 5, prefixes: ['ACME'] },
    ] });
    const labels = buildBands(a).find((b) => b.id === 'products')!.tiles.map((t) => t.label);
    expect(labels).toEqual(['ACME', 'ZED']);
  });
});

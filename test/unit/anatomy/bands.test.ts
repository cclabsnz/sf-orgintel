import { buildBands } from '../../../src/anatomy/view/bands.js';
import type { AnatomyArtifact } from '../../../src/anatomy/types.js';

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
    prefixesUnresolved: [], notes: [],
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

  it('marks a band not-collected when a note says the data was never gathered', () => {
    // The distinction the whole artifact exists to preserve: "we looked and found none" is
    // not "we never looked".
    const a = artifact({
      coverage: { ...artifact().coverage, notes: ['Channels currently reflect Site only; app, console and api channel types and the Network join were not attempted.'] },
    });
    const channels = buildBands(a).find((b) => b.id === 'channels')!;
    expect(channels.emptiness).toBe('not-collected');
    expect(channels.note).toMatch(/not attempted/);
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

  it('is deterministic and sorts tiles within a band', () => {
    const a = artifact({ products: [
      { key: 'ZED', label: 'ZED', source: 'app', componentCount: 5, prefixes: ['ZED'] },
      { key: 'ACME', label: 'ACME', source: 'app', componentCount: 5, prefixes: ['ACME'] },
    ] });
    const labels = buildBands(a).find((b) => b.id === 'products')!.tiles.map((t) => t.label);
    expect(labels).toEqual(['ACME', 'ZED']);
  });
});

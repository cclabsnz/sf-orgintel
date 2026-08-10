import { mockSoql, mockTooling, mockRest } from '../helpers/mocks.js';
import { runAnatomy } from '../../../src/anatomy/runAnatomy.js';

const emptyCtx = (): any => ({
  soql: mockSoql([{ test: () => true, records: [], totalSize: 0 }]),
  tooling: mockTooling([{ test: () => true, records: [] }]),
  rest: mockRest([]),
  metadata: { list: async () => [] },
});

const prov = { generatedAt: '2026-08-05T00:00:00Z', orgId: '00Dxx0000000000EAA', toolVersion: '0.1.0', apiVersion: '62.0' };

describe('runAnatomy', () => {
  it('produces a complete artifact for an org that yields nothing', async () => {
    const a = await runAnatomy(emptyCtx(), prov);
    expect(a.version).toBe(1);
    expect(a.products).toEqual([]);
    expect(a.edges).toEqual([]);
    expect(a.capabilities.eventRelayConfigured).toBe(false);
    expect(a.coverage).toMatchObject({ apexBodiesScanned: 0, prefixesUnresolved: [] });
  });

  it('is byte-identical across two runs on the same input', async () => {
    const one = await runAnatomy(emptyCtx(), prov);
    const two = await runAnatomy(emptyCtx(), prov);
    expect(JSON.stringify(one)).toBe(JSON.stringify(two));
  });

  it('never throws when every read fails', async () => {
    const broken = (): any => ({
      soql: mockSoql([{ test: () => true, error: new Error('denied') }]),
      tooling: mockTooling([{ test: () => true, error: new Error('denied') }]),
      rest: mockRest([]),
      metadata: { list: async () => { throw new Error('denied'); } },
    });
    const a = await runAnatomy(broken(), prov);
    expect(a.coverage.notes.length).toBeGreaterThan(0);
    expect(a.version).toBe(1);
  });
});

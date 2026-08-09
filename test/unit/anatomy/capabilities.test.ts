import { mockSoql, mockTooling, mockRest } from '../helpers/mocks.js';
import { collectCapabilities } from '../../../src/anatomy/collectors/capabilities.js';

describe('collectCapabilities', () => {
  it('reports eventRelayConfigured false when none exist, rather than omitting it', async () => {
    // Absence is a finding: it bounds who can consume the delivery allocation.
    const notes: string[] = [];
    const out = await collectCapabilities(
      { soql: mockSoql([{ test: () => true, records: [], totalSize: 0 }]),
        tooling: mockTooling([{ test: () => true, records: [] }]),
        rest: mockRest([]) } as any,
      notes,
    );
    expect(out.eventRelayConfigured).toBe(false);
  });

  it('separates platform events from change data capture by suffix', async () => {
    const notes: string[] = [];
    const out = await collectCapabilities(
      { soql: mockSoql([{ test: () => true, records: [], totalSize: 0 }]),
        tooling: mockTooling([{ test: () => true, records: [] }]),
        rest: mockRest([
          { name: 'Order__e' }, { name: 'AccountChangeEvent' }, { name: 'Account' },
        ]) } as any,
      notes,
    );
    expect(out.platformEvents).toEqual(['Order__e']);
    expect(out.changeDataCapture).toEqual(['AccountChangeEvent']);
  });
});

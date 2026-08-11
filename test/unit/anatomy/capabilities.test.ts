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

  it('reports eventRelayConfigured false with no note when the type is genuinely absent from the org', async () => {
    const notes: string[] = [];
    const out = await collectCapabilities(
      { soql: mockSoql([{ test: (s) => s.includes('EventRelayConfig'),
          error: new Error("INVALID_TYPE: sObject type 'EventRelayConfig' is not supported.") }]),
        tooling: mockTooling([{ test: () => true, records: [] }]),
        rest: mockRest([]) } as any,
      notes,
    );
    expect(out.eventRelayConfigured).toBe(false);
    expect(notes.some((n) => n.toLowerCase().includes('eventrelay'))).toBe(false);
  });

  it('reports a note for a licence-gated refusal whose message merely contains "not supported"', async () => {
    // The old classifier, /INVALID_TYPE|not supported/i, matched this message and treated a
    // licence refusal as a genuinely absent feature. Only the platform's actual absent-sObject
    // shapes (an INVALID_TYPE code, or "sObject type '...' is not supported") should suppress
    // the note; anything else, including this one, is a failed read and must say so.
    const notes: string[] = [];
    const out = await collectCapabilities(
      { soql: mockSoql([{ test: (s) => s.includes('EventRelayConfig'),
          error: new Error('This feature is not supported for your organization license.') }]),
        tooling: mockTooling([{ test: () => true, records: [] }]),
        rest: mockRest([]) } as any,
      notes,
    );
    expect(out.eventRelayConfigured).toBe(false);
    expect(notes.some((n) => n.toLowerCase().includes('eventrelay'))).toBe(true);
  });

  it('reports eventRelayConfigured false with a note when the read is refused, not absent', async () => {
    const notes: string[] = [];
    const out = await collectCapabilities(
      { soql: mockSoql([{ test: (s) => s.includes('EventRelayConfig'),
          error: new Error('INSUFFICIENT_ACCESS: insufficient access rights on cross-reference id') }]),
        tooling: mockTooling([{ test: () => true, records: [] }]),
        rest: mockRest([]) } as any,
      notes,
    );
    expect(out.eventRelayConfigured).toBe(false);
    expect(notes.some((n) => n.toLowerCase().includes('eventrelay'))).toBe(true);
  });
});

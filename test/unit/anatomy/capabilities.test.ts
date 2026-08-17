import { mockSoql, mockTooling, mockRest, mockIntelContext } from '../helpers/mocks.js';
import { collectCapabilities } from '../../../src/anatomy/collectors/capabilities.js';
import type { Unavailable } from '../../../src/anatomy/types.js';

describe('collectCapabilities', () => {
  it('reports eventRelayConfigured false when none exist, rather than omitting it', async () => {
    // Absence is a finding: it bounds who can consume the delivery allocation.
    const notes: string[] = [];
    const unavailable: Unavailable[] = [];
    const out = await collectCapabilities(
      mockIntelContext({ soql: mockSoql([{ test: () => true, records: [], totalSize: 0 }]),
        tooling: mockTooling([{ test: () => true, records: [] }]),
        rest: mockRest([]) }),
      notes,
      unavailable,
    );
    expect(out.eventRelayConfigured).toBe(false);
  });

  it('takes platform events from the sObject list, and change data capture from neither suffix nor describe', async () => {
    // The describe tells you which objects the PLATFORM supports change events for, which is a
    // property of Salesforce, not of this org: 419 entries on an org with no CDC enabled at all.
    // Only channel membership says what this org turned on.
    const notes: string[] = [];
    const unavailable: Unavailable[] = [];
    const out = await collectCapabilities(
      mockIntelContext({ soql: mockSoql([{ test: () => true, records: [], totalSize: 0 }]),
        tooling: mockTooling([{ test: () => true, records: [] }]),
        rest: mockRest([
          { name: 'Order__e' }, { name: 'AccountChangeEvent' }, { name: 'Account' },
        ]) }),
      notes,
      unavailable,
    );
    expect(out.platformEvents).toEqual(['Order__e']);
    expect(out.changeDataCapture).toEqual([]);
  });

  it('reports the entities actually selected for change data capture, on any channel', async () => {
    // PlatformEventChannelMember covers the standard ChangeEvents channel (the Setup "Selected
    // Entities" list) as well as custom channels, per the Tooling API reference, so one query
    // answers both. Sorted and de-duplicated: one entity can sit on more than one channel.
    const notes: string[] = [];
    const unavailable: Unavailable[] = [];
    const out = await collectCapabilities(
      mockIntelContext({ soql: mockSoql([{ test: () => true, records: [], totalSize: 0 }]),
        tooling: mockTooling([
          { test: (s) => s.includes('PlatformEventChannelMember'), records: [
            { SelectedEntity: 'OrderChangeEvent' },
            { SelectedEntity: 'AccountChangeEvent' },
            { SelectedEntity: 'AccountChangeEvent' },
          ] },
          { test: () => true, records: [] },
        ]),
        rest: mockRest([{ name: 'AccountChangeEvent' }, { name: 'CaseChangeEvent' }]) }),
      notes,
      unavailable,
    );
    expect(out.changeDataCapture).toEqual(['AccountChangeEvent', 'OrderChangeEvent']);
  });

  it('reports no change data capture as a measured empty, with no note, when nothing is selected', async () => {
    // Zero selected entities is the common, correct answer: six real orgs all returned it. It
    // is a reading, not a gap, so it must not raise an unavailable entry.
    const notes: string[] = [];
    const unavailable: Unavailable[] = [];
    const out = await collectCapabilities(
      mockIntelContext({ soql: mockSoql([{ test: () => true, records: [], totalSize: 0 }]),
        tooling: mockTooling([{ test: () => true, records: [] }]),
        rest: mockRest([{ name: 'AccountChangeEvent' }]) }),
      notes,
      unavailable,
    );
    expect(out.changeDataCapture).toEqual([]);
    expect(unavailable.some((u) => u.scope === 'capabilities.changeDataCapture')).toBe(false);
  });

  it('marks change data capture unavailable when the channel read is refused', async () => {
    const notes: string[] = [];
    const unavailable: Unavailable[] = [];
    const out = await collectCapabilities(
      mockIntelContext({ soql: mockSoql([{ test: () => true, records: [], totalSize: 0 }]),
        tooling: mockTooling([
          { test: (s) => s.includes('PlatformEventChannelMember'),
            error: new Error('INSUFFICIENT_ACCESS: insufficient access rights on object id') },
          { test: () => true, records: [] },
        ]),
        rest: mockRest([]) }),
      notes,
      unavailable,
    );
    expect(out.changeDataCapture).toEqual([]);
    expect(unavailable.find((u) => u.scope === 'capabilities.changeDataCapture')?.reason).toBe('failed');
  });

  it('treats an absent PlatformEventChannelMember type as no change data capture, not a failed read', async () => {
    // Same rule as EventRelayConfig: the platform's absent-sObject shape means the feature is
    // genuinely not there, and absence is the finding. A hatched "not read" tile would be wrong.
    const notes: string[] = [];
    const unavailable: Unavailable[] = [];
    const out = await collectCapabilities(
      mockIntelContext({ soql: mockSoql([{ test: () => true, records: [], totalSize: 0 }]),
        tooling: mockTooling([
          { test: (s) => s.includes('PlatformEventChannelMember'),
            error: new Error("INVALID_TYPE: sObject type 'PlatformEventChannelMember' is not supported.") },
          { test: () => true, records: [] },
        ]),
        rest: mockRest([]) }),
      notes,
      unavailable,
    );
    expect(out.changeDataCapture).toEqual([]);
    expect(unavailable.some((u) => u.scope === 'capabilities.changeDataCapture')).toBe(false);
  });

  it('does not blame the sObject list for change data capture when the describe fails', async () => {
    // The describe no longer feeds CDC, so a failed describe must not mark CDC unavailable:
    // that would hatch a tile whose own read succeeded.
    const notes: string[] = [];
    const unavailable: Unavailable[] = [];
    await collectCapabilities(
      mockIntelContext({ soql: mockSoql([{ test: () => true, records: [], totalSize: 0 }]),
        tooling: mockTooling([{ test: () => true, records: [] }]),
        rest: mockRest(new Error('SERVER_UNAVAILABLE')) }),
      notes,
      unavailable,
    );
    expect(unavailable.some((u) => u.scope === 'capabilities.platformEvents')).toBe(true);
    expect(unavailable.some((u) => u.scope === 'capabilities.changeDataCapture')).toBe(false);
  });

  it('reports eventRelayConfigured false with no note when the type is genuinely absent from the org', async () => {
    const notes: string[] = [];
    const unavailable: Unavailable[] = [];
    const out = await collectCapabilities(
      mockIntelContext({ soql: mockSoql([{ test: (s) => s.includes('EventRelayConfig'),
          error: new Error("INVALID_TYPE: sObject type 'EventRelayConfig' is not supported.") }]),
        tooling: mockTooling([{ test: () => true, records: [] }]),
        rest: mockRest([]) }),
      notes,
      unavailable,
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
    const unavailable: Unavailable[] = [];
    const out = await collectCapabilities(
      mockIntelContext({ soql: mockSoql([{ test: (s) => s.includes('EventRelayConfig'),
          error: new Error('This feature is not supported for your organization license.') }]),
        tooling: mockTooling([{ test: () => true, records: [] }]),
        rest: mockRest([]) }),
      notes,
      unavailable,
    );
    expect(out.eventRelayConfigured).toBe(false);
    expect(notes.some((n) => n.toLowerCase().includes('eventrelay'))).toBe(true);
  });

  it('reports eventRelayConfigured false with a note when the read is refused, not absent', async () => {
    const notes: string[] = [];
    const unavailable: Unavailable[] = [];
    const out = await collectCapabilities(
      mockIntelContext({ soql: mockSoql([{ test: (s) => s.includes('EventRelayConfig'),
          error: new Error('INSUFFICIENT_ACCESS: insufficient access rights on cross-reference id') }]),
        tooling: mockTooling([{ test: () => true, records: [] }]),
        rest: mockRest([]) }),
      notes,
      unavailable,
    );
    expect(out.eventRelayConfigured).toBe(false);
    expect(notes.some((n) => n.toLowerCase().includes('eventrelay'))).toBe(true);
  });
});

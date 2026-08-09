import { mockSoql, mockTooling } from '../helpers/mocks.js';
import { collectProducts } from '../../../src/anatomy/collectors/products.js';
import { collectPersonas } from '../../../src/anatomy/collectors/personas.js';
import { collectChannels } from '../../../src/anatomy/collectors/channels.js';

const ctx = (over: Record<string, unknown>): any => ({ soql: mockSoql([]), tooling: mockTooling([]), ...over });

describe('collectProducts', () => {
  it('returns app, package and record type names', async () => {
    const notes: string[] = [];
    const out = await collectProducts(
      ctx({
        tooling: mockTooling([
          { test: (s) => s.includes('CustomApplication'), records: [{ DeveloperName: 'ACME_Console' }] },
          { test: (s) => s.includes('InstalledSubscriberPackage'), records: [] },
        ]),
        soql: mockSoql([{ test: (s) => s.includes('RecordType'), records: [{ DeveloperName: 'ACME_Request' }] }]),
      }),
      notes,
    );
    expect(out.apps).toEqual(['ACME_Console']);
    expect(out.recordTypes).toEqual(['ACME_Request']);
    expect(notes).toEqual([]);
  });

  it('records a note and returns empty rather than throwing', async () => {
    const notes: string[] = [];
    const out = await collectProducts(
      ctx({
        tooling: mockTooling([{ test: () => true, error: new Error('INSUFFICIENT_ACCESS') }]),
        soql: mockSoql([{ test: () => true, error: new Error('nope') }]),
      }),
      notes,
    );
    expect(out).toEqual({ apps: [], packages: [], recordTypes: [] });
    expect(notes.length).toBeGreaterThan(0);
    expect(notes.join(' ')).not.toContain('—');
  });
});

describe('collectPersonas', () => {
  it('joins active user counts to licences and sorts deterministically', async () => {
    const notes: string[] = [];
    const out = await collectPersonas(
      ctx({
        soql: mockSoql([
          { test: (s) => s.includes('FROM User'), records: [
            { Profile: { Name: 'Zed' }, Profile_UserLicense: null, expr0: 3 },
            { Profile: { Name: 'Alpha' }, expr0: 7 },
          ] },
        ]),
      }),
      notes,
    );
    expect(out.map((p) => p.profile)).toEqual(['Alpha', 'Zed']);
    expect(out[0].activeUsers).toBe(7);
  });
});

describe('collectChannels', () => {
  it('returns sites as channels', async () => {
    const notes: string[] = [];
    const out = await collectChannels(
      ctx({ soql: mockSoql([{ test: (s) => s.includes('FROM Site'), records: [{ Name: 'Portal', Status: 'Active' }] }]) }),
      notes,
    );
    expect(out).toContainEqual({ type: 'site', name: 'Portal', status: 'Active' });
  });
});

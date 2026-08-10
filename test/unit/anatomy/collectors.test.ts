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
          { test: (s) => s.includes('InstalledSubscriberPackage'), records: [
            { SubscriberPackage: { NamespacePrefix: 'acme' } },
            { SubscriberPackage: { NamespacePrefix: null } },
          ] },
          { test: (s) => s.includes('FROM ApexClass'), records: [] },
          { test: (s) => s.includes('FROM FlowDefinition'), records: [] },
        ]),
        soql: mockSoql([{ test: (s) => s.includes('RecordType'), records: [{ DeveloperName: 'ACME_Request' }] }]),
      }),
      notes,
    );
    expect(out.apps).toEqual(['ACME_Console']);
    expect(out.packages).toEqual(['acme']);
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
    expect(out).toEqual({ apps: [], packages: [], recordTypes: [], componentNames: [] });
    expect(notes.length).toBeGreaterThan(0);
    expect(notes.join(' ')).not.toContain('—');
  });

  it('feeds componentNames from every Apex class and Flow, sorted, not just callout carriers', async () => {
    const notes: string[] = [];
    const out = await collectProducts(
      ctx({
        tooling: mockTooling([
          { test: (s) => s.includes('CustomApplication'), records: [] },
          { test: (s) => s.includes('InstalledSubscriberPackage'), records: [] },
          { test: (s) => s.includes('FROM ApexClass'), records: [{ Name: 'ZedService' }, { Name: 'AcmeHelper' }] },
          { test: (s) => s.includes('FROM FlowDefinition'), records: [{ DeveloperName: 'Acme_Onboarding' }] },
        ]),
        soql: mockSoql([{ test: (s) => s.includes('RecordType'), records: [] }]),
      }),
      notes,
    );
    expect(out.componentNames).toEqual(['AcmeHelper', 'Acme_Onboarding', 'ZedService']);
  });
});

describe('collectPersonas', () => {
  it('joins active user counts to licences and sorts deterministically', async () => {
    const notes: string[] = [];
    const out = await collectPersonas(
      ctx({
        soql: mockSoql([
          { test: (s) => s.includes('FROM User'), records: [
            { profileName: 'Zed', licenceName: 'Salesforce', userCount: 3 },
            { profileName: 'Alpha', licenceName: 'Salesforce Platform', userCount: 7 },
          ] },
        ]),
      }),
      notes,
    );
    expect(out.map((p) => p.profile)).toEqual(['Alpha', 'Zed']);
    expect(out[0]).toEqual({ profile: 'Alpha', licence: 'Salesforce Platform', activeUsers: 7, landingApp: null });
    expect(notes).toEqual([]);
  });

  it('defaults a row missing its profile or licence rather than dropping it', async () => {
    const notes: string[] = [];
    const out = await collectPersonas(
      ctx({
        soql: mockSoql([
          { test: (s) => s.includes('FROM User'), records: [
            { licenceName: 'Salesforce', userCount: 2 },
            { profileName: 'Beta', userCount: 5 },
          ] },
        ]),
      }),
      notes,
    );
    expect(out).toHaveLength(2);
    expect(out).toContainEqual({ profile: 'unknown', licence: 'Salesforce', activeUsers: 2, landingApp: null });
    expect(out).toContainEqual({ profile: 'Beta', licence: 'unknown', activeUsers: 5, landingApp: null });
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

import { mockSoql, mockTooling } from '../helpers/mocks.js';
import { collectProducts } from '../../../src/anatomy/collectors/products.js';
import { collectPersonas } from '../../../src/anatomy/collectors/personas.js';
import { collectChannels } from '../../../src/anatomy/collectors/channels.js';
import type { Unavailable } from '../../../src/anatomy/types.js';

const ctx = (over: Record<string, unknown>): any => ({ soql: mockSoql([]), tooling: mockTooling([]), ...over });

describe('collectProducts', () => {
  it('returns app, package and record type names', async () => {
    const notes: string[] = [];
    const unavailable: Unavailable[] = [];
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
      unavailable,
    );
    expect(out.apps).toEqual(['ACME_Console']);
    expect(out.packages).toEqual(['acme']);
    expect(out.recordTypes).toEqual(['ACME_Request']);
    expect(notes).toEqual([]);
  });

  it('records a note and returns empty rather than throwing', async () => {
    const notes: string[] = [];
    const unavailable: Unavailable[] = [];
    const out = await collectProducts(
      ctx({
        tooling: mockTooling([{ test: () => true, error: new Error('INSUFFICIENT_ACCESS') }]),
        soql: mockSoql([{ test: () => true, error: new Error('nope') }]),
      }),
      notes,
      unavailable,
    );
    expect(out).toEqual({ apps: [], packages: [], recordTypes: [], componentNames: [] });
    expect(notes.length).toBeGreaterThan(0);
    expect(notes.join(' ')).not.toContain('—');
  });

  it('feeds componentNames from every Apex class and Flow, sorted, not just callout carriers', async () => {
    const notes: string[] = [];
    const unavailable: Unavailable[] = [];
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
      unavailable,
    );
    expect(out.componentNames).toEqual(['AcmeHelper', 'Acme_Onboarding', 'ZedService']);
  });
});

describe('collectPersonas', () => {
  it('joins active user counts to licences and sorts deterministically', async () => {
    const notes: string[] = [];
    const unavailable: Unavailable[] = [];
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
      unavailable,
    );
    expect(out.map((p) => p.profile)).toEqual(['Alpha', 'Zed']);
    expect(out[0]).toEqual({ profile: 'Alpha', licence: 'Salesforce Platform', activeUsers: 7, landingApp: null });
    // landingApp is a deliberate deferral, not a finding, but it must still be recorded as
    // "not attempted" rather than silently reading as "no landing app configured".
    expect(notes.some((n) => n.toLowerCase().includes('landingapp'))).toBe(true);
  });

  it('defaults a row missing its profile or licence rather than dropping it', async () => {
    const notes: string[] = [];
    const unavailable: Unavailable[] = [];
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
      unavailable,
    );
    expect(out).toHaveLength(2);
    expect(out).toContainEqual({ profile: 'unknown', licence: 'Salesforce', activeUsers: 2, landingApp: null });
    expect(out).toContainEqual({ profile: 'Beta', licence: 'unknown', activeUsers: 5, landingApp: null });
  });
});

describe('collectChannels', () => {
  it('returns sites as channels', async () => {
    const notes: string[] = [];
    const unavailable: Unavailable[] = [];
    const { channels } = await collectChannels(
      ctx({ soql: mockSoql([{ test: (s) => s.includes('FROM Site'), records: [{ Name: 'Portal', MasterLabel: 'Portal', Status: 'Active' }] }]) }),
      notes,
      unavailable,
    );
    expect(channels).toContainEqual({ type: 'site', name: 'Portal', status: 'Active' });
  });

  it('reads only columns Site actually has, so the read is not refused on every org', async () => {
    // Site has no `SiteName` column -- that field belongs to RemoteProxy. Querying it was refused
    // with INVALID_FIELD on every org from 0.3.0 to 1.0.0, so the channels band reported a failed
    // read for orgs that had sites. The fixture invented the column, which is how it shipped
    // green. This mock rejects any column the real describe does not list, as the org does.
    const SITE_COLUMNS = new Set(['Id', 'Name', 'MasterLabel', 'Status', 'SiteType', 'Subdomain', 'UrlPathPrefix']);
    const soql = mockSoql([
      {
        test: (s) => {
          const cols = /^SELECT (.+) FROM Site$/.exec(s)?.[1].split(',').map((c) => c.trim()) ?? [];
          return cols.some((c) => !SITE_COLUMNS.has(c));
        },
        error: new Error("No such column on entity 'Site'"),
      },
      {
        test: (s) => s.includes('FROM Site'),
        records: [{ Name: 'Customer_Portal', MasterLabel: 'Customer Portal', Status: 'Active' }],
      },
    ]);
    const unavailable: Unavailable[] = [];

    const { channels } = await collectChannels(ctx({ soql }), [], unavailable);

    expect(unavailable.filter((u) => u.scope === 'channels')).toEqual([]);
    expect(channels).toEqual([{ type: 'site', name: 'Customer Portal', status: 'Active' }]);
  });

  it('keys each site on its unique Name and labels it with MasterLabel, keeping the key off Channel', async () => {
    // `Name` is the site's unique, required technical name; `MasterLabel` is the editable display
    // label, and two sites can share one. The fragment builds `site.<key>` ids from the key, and
    // `mergeGraphs` refuses the whole merged graph on an id collision, so the key must be Name.
    const { channels, channelKeys } = await collectChannels(
      ctx({
        soql: mockSoql([
          {
            test: (s) => s.includes('FROM Site'),
            records: [
              { Name: 'Second_Portal', MasterLabel: 'Portal', Status: 'Active' },
              { Name: 'First_Portal', MasterLabel: 'Portal', Status: 'Active' },
            ],
          },
        ]),
      }),
      [],
      [],
    );

    expect(channels.map((c) => c.name)).toEqual(['Portal', 'Portal']);
    expect(channelKeys).toEqual(['First_Portal', 'Second_Portal']);
    expect(channels.every((c) => Object.keys(c).sort().join() === 'name,status,type')).toBe(true);
  });

  it('records a note that app, console and api channels and the Network join are not yet collected', async () => {
    const notes: string[] = [];
    const unavailable: Unavailable[] = [];
    await collectChannels(
      ctx({ soql: mockSoql([{ test: (s) => s.includes('FROM Site'), records: [] }]) }),
      notes,
      unavailable,
    );
    expect(notes.some((n) => n.toLowerCase().includes('network'))).toBe(true);
  });
});

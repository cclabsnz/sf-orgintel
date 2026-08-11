import { mockSoql, mockTooling } from '../helpers/mocks.js';
import { collectIdentity } from '../../../src/anatomy/collectors/identity.js';

describe('collectIdentity', () => {
  it('reports login counts by type as facts, with no grading', async () => {
    const notes: string[] = [];
    const out = await collectIdentity(
      { soql: mockSoql([{ test: (s) => s.includes('LoginHistory'), records: [
          { Application: 'Portal', LoginType: 'Application', expr0: 900 },
          { Application: 'Portal', LoginType: 'SAML Sfdc Initiated SSO', expr0: 80 },
        ] }]),
        tooling: mockTooling([{ test: () => true, records: [] }]),
        metadata: { list: async () => [] } } as any,
      notes,
    );
    expect(out.loginsByType).toHaveLength(2);

    // A word-scan for "risk"/"should" etc. is a tautology here: Identity has no free-text
    // field for such a word to land in, so the scan would pass even if a severity field
    // were added. Pin the exact shape instead: adding a judgement field to the type or the
    // collector fails this test, which is the behaviour worth protecting.
    expect(Object.keys(out).sort()).toEqual(['loginsByType', 'ssoConfigs']);
    for (const entry of out.loginsByType) {
      expect(Object.keys(entry).sort()).toEqual(['application', 'count', 'loginType']);
    }
  });

  it('sorts ssoConfigs by issuer, null-safe, for deterministic output', async () => {
    const notes: string[] = [];
    const out = await collectIdentity(
      {
        soql: mockSoql([{ test: (s) => s.includes('LoginHistory'), records: [] }]),
        tooling: mockTooling([
          {
            test: (s) => s.includes('SamlSsoConfig'),
            records: [{ Issuer: 'https://zed.example.com' }, { Issuer: null }, { Issuer: 'https://acme.example.com' }],
          },
        ]),
        metadata: { list: async () => [] },
      } as any,
      notes,
    );
    expect(out.ssoConfigs.map((c) => c.issuer)).toEqual([
      null,
      'https://acme.example.com',
      'https://zed.example.com',
    ]);
  });

  it('still returns login data when SSO metadata cannot be retrieved', async () => {
    const notes: string[] = [];
    const out = await collectIdentity(
      { soql: mockSoql([{ test: (s) => s.includes('LoginHistory'), records: [
          { Application: 'X', LoginType: 'Application', expr0: 1 } ] }]),
        tooling: mockTooling([{ test: () => true, error: new Error('no access') }]),
        metadata: { list: async () => { throw new Error('denied'); } } } as any,
      notes,
    );
    expect(out.ssoConfigs).toEqual([]);
    expect(out.loginsByType).toHaveLength(1);
    expect(notes.length).toBeGreaterThan(0);
  });
});

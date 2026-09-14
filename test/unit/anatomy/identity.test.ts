import { mockSoql, mockTooling, mockIntelContext } from '../helpers/mocks.js';
import { collectIdentity } from '../../../src/anatomy/collectors/identity.js';
import type { Unavailable } from '../../../src/anatomy/types.js';

describe('collectIdentity', () => {
  it('reports login counts by type as facts, with no grading', async () => {
    const notes: string[] = [];
    const unavailable: Unavailable[] = [];
    const out = await collectIdentity(
      mockIntelContext({ soql: mockSoql([{ test: (s) => s.includes('LoginHistory'), records: [
          { Application: 'Portal', LoginType: 'Application', expr0: 900 },
          { Application: 'Portal', LoginType: 'SAML Sfdc Initiated SSO', expr0: 80 },
        ] }]),
        tooling: mockTooling([{ test: () => true, records: [] }]) }),
      notes,
      unavailable,
    );
    expect(out.loginsByType).toHaveLength(2);

    // A word-scan for "risk"/"should" etc. is a tautology here: Identity has no free-text
    // field for such a word to land in, so the scan would pass even if a severity field
    // were added. Pin the exact shape instead: adding a judgement field to the type or the
    // collector fails this test, which is the behaviour worth protecting.
    // `ssoConfigKeys` is the one legitimate addition to this shape: `DeveloperName`, threaded
    // to the fragment only (see identity.ts's `CollectedIdentity` doc), never a judgement field.
    expect(Object.keys(out).sort()).toEqual(['loginsByType', 'ssoConfigKeys', 'ssoConfigs']);
    for (const entry of out.loginsByType) {
      expect(Object.keys(entry).sort()).toEqual(['application', 'count', 'loginType']);
    }
  });

  it('sorts ssoConfigs by issuer, null-safe, for deterministic output', async () => {
    const notes: string[] = [];
    const unavailable: Unavailable[] = [];
    const out = await collectIdentity(
      mockIntelContext({
        soql: mockSoql([{ test: (s) => s.includes('LoginHistory'), records: [] }]),
        tooling: mockTooling([
          {
            test: (s) => s.includes('SamlSsoConfig'),
            records: [{ Issuer: 'https://zed.example.com' }, { Issuer: null }, { Issuer: 'https://acme.example.com' }],
          },
        ]),
      }),
      notes,
      unavailable,
    );
    expect(out.ssoConfigs.map((c) => c.issuer)).toEqual([
      null,
      'https://acme.example.com',
      'https://zed.example.com',
    ]);
  });

  it('gives two issuer-less configs distinct keys from DeveloperName, aligned with ssoConfigs', async () => {
    // The bug this guards against: an id built from `issuer ?? type` alone collapses every
    // issuer-less SamlSsoConfig row onto one id (`ssoConfig.saml`), and `mergeGraphs` returns
    // `graph: null` for the whole merged graph on that collision, not just the duplicate.
    const notes: string[] = [];
    const unavailable: Unavailable[] = [];
    const out = await collectIdentity(
      mockIntelContext({
        soql: mockSoql([{ test: (s) => s.includes('LoginHistory'), records: [] }]),
        tooling: mockTooling([
          {
            test: (s) => s.includes('SamlSsoConfig'),
            records: [
              { DeveloperName: 'Internal_IdP', Issuer: null },
              { DeveloperName: 'Experience_Cloud_IdP', Issuer: null },
            ],
          },
        ]),
      }),
      notes,
      unavailable,
    );
    expect(out.ssoConfigs.every((c) => c.issuer === null)).toBe(true);
    expect(out.ssoConfigKeys).toHaveLength(2);
    expect(new Set(out.ssoConfigKeys).size).toBe(2);
    expect(out.ssoConfigKeys.sort()).toEqual(['Experience_Cloud_IdP', 'Internal_IdP']);
  });

  it('still returns login data when SSO metadata cannot be retrieved', async () => {
    const notes: string[] = [];
    const unavailable: Unavailable[] = [];
    const out = await collectIdentity(
      mockIntelContext({ soql: mockSoql([{ test: (s) => s.includes('LoginHistory'), records: [
          { Application: 'X', LoginType: 'Application', expr0: 1 } ] }]),
        tooling: mockTooling([{ test: () => true, error: new Error('no access') }]) }),
      notes,
      unavailable,
    );
    expect(out.ssoConfigs).toEqual([]);
    expect(out.loginsByType).toHaveLength(1);
    expect(notes.length).toBeGreaterThan(0);
  });
});

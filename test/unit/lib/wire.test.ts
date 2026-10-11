import { describe, it, expect } from '@jest/globals';
import type { Connection } from '@salesforce/core';
import { resolveOrgInfo, resolveOrgIdentity } from '../../../src/lib/wire.js';

/**
 * A user without "View Setup and Configuration" cannot read `Organization`: the platform answers
 * `sObject type 'Organization' is not supported`. Every intel command read it first, so such a
 * user could not run any of them -- found by running View A as a restricted user on a Developer
 * Edition org. `map` and `anatomy` need only the org's identity, which the connection's own auth
 * info already carries; `probe` and `discover` report edition and sandbox status, which cannot be
 * honestly guessed.
 */

const REFUSED = "sObject type 'Organization' is not supported.";

function conn(opts: { refuse: boolean }): Connection {
  return {
    instanceUrl: 'https://example.my.salesforce.com',
    getAuthInfoFields: () => ({ orgId: '00Dxx0000000000EAA' }),
    async query() {
      if (opts.refuse) throw new Error(REFUSED);
      return {
        records: [
          {
            Id: '00Dxx0000000000EAA',
            Name: 'Acme',
            OrganizationType: 'Developer Edition',
            IsSandbox: false,
            InstanceName: 'NA1',
            NamespacePrefix: null,
          },
        ],
      };
    },
  } as unknown as Connection;
}

describe('resolveOrgIdentity', () => {
  it('reads the identity from Organization when the user can', async () => {
    const identity = await resolveOrgIdentity(conn({ refuse: false }));

    expect(identity.id).toBe('00Dxx0000000000EAA');
    expect(identity.name).toBe('Acme');
    expect(identity.orgInfo?.type).toBe('Developer Edition');
    expect(identity.note).toBeNull();
  });

  it('falls back to the connection for the id when Organization is refused, and says so', async () => {
    const identity = await resolveOrgIdentity(conn({ refuse: true }));

    expect(identity.id).toBe('00Dxx0000000000EAA');
    // The name was not read, so it is not invented: the id stands in for it.
    expect(identity.name).toBe('00Dxx0000000000EAA');
    // No OrgInfo at all, rather than one with a guessed edition and sandbox flag.
    expect(identity.orgInfo).toBeNull();
    expect(identity.note).toContain('View Setup and Configuration');
    expect(identity.note).toContain(REFUSED);
    // Not the strict command's wording: this command carries on without the record.
    expect(identity.note).not.toContain('which this command needs');
  });
});

describe('resolveOrgInfo', () => {
  it('names the missing permission when Organization is refused, instead of the bare platform error', async () => {
    await expect(resolveOrgInfo(conn({ refuse: true }))).rejects.toThrow(/View Setup and Configuration/);
  });
});

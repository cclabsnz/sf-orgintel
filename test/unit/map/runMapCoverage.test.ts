import { describe, it, expect } from '@jest/globals';
import type { QueryResult, SoqlClient, ToolingClient } from '@cclabsnz/sf-core';
import { runMap } from '../../../src/map/runMap.js';
import type { IntelContext } from '../../../src/lib/wire.js';
import { mockRest, noopMetadata } from '../helpers/mocks.js';

/**
 * The two drops `runMap` makes itself, rather than inheriting from retrieval: the object catalog
 * and the 90-day record-count sweep. Both used to fall back silently -- an empty catalog, a `0`
 * count -- and both reach the fragment as contributions a consumer would otherwise believe.
 */

const REFUSED = new Error('INSUFFICIENT_ACCESS');

/** One readable class touching Account, Case and Contact, so all three form coupling pairs. */
function org(opts: { refuseCountsOn?: string[]; refuseCatalog?: boolean }): IntelContext {
  const soql: SoqlClient = {
    async query<T>(q: string): Promise<QueryResult<T>> {
      const counted = /SELECT COUNT\(\) FROM (\w+)/.exec(q)?.[1];
      if (counted && opts.refuseCountsOn?.includes(counted)) throw REFUSED;
      return { totalSize: counted ? 7 : 0, done: true, records: [] as T[] };
    },
    async queryAll<T>(): Promise<T[]> {
      return [] as T[];
    },
  };
  const tooling: ToolingClient = {
    async query<T>(q: string): Promise<T[]> {
      if (/FROM ApexClass\b/.test(q)) {
        return [
          {
            Name: 'Svc',
            NamespacePrefix: null,
            Body: null,
            SymbolTable: { externalReferences: [{ name: 'Account' }, { name: 'Case' }, { name: 'Contact' }] },
          },
        ] as T[];
      }
      return [] as T[];
    },
    async getRecord<T>(): Promise<T> {
      throw new Error('not implemented');
    },
  };
  return {
    soql,
    tooling,
    rest: opts.refuseCatalog ? mockRest(REFUSED) : mockRest([{ name: 'Account' }, { name: 'Case' }, { name: 'Contact' }]),
    metadata: noopMetadata,
    orgInfo: { id: '00D', name: 'T', type: 'Enterprise', isSandbox: true, instance: 'NA1', instanceUrl: 'https://x' },
    apiVersion: '62.0',
    namespace: null,
  };
}

const run = (ctx: IntelContext, maxNodeCounts?: number) =>
  runMap(ctx, { generatedAt: '2026-01-01T00:00:00.000Z', orgId: '00D' }, { maxNodeCounts });

const coverageOf = async (ctx: IntelContext, maxNodeCounts?: number) =>
  (await run(ctx, maxNodeCounts)).fragment.coverage.unavailable;

describe('runMap: record-count drops reach the fragment', () => {
  it('records nothing when every count was read and none was capped', async () => {
    expect(await coverageOf(org({}))).toEqual([]);
  });

  it('marks a capped sweep as deferred', async () => {
    const unavailable = await coverageOf(org({}), 2);

    expect(unavailable).toEqual([
      { scope: 'map.recordCounts', reason: 'deferred', detail: 'Record counts computed for 2 of 3 graph objects.' },
    ]);
  });

  it('marks a refused count as failed and names the object, instead of a silent 0', async () => {
    const result = await run(org({ refuseCountsOn: ['Case'] }));

    expect(result.fragment.coverage.unavailable).toHaveLength(1);
    expect(result.fragment.coverage.unavailable[0]).toMatchObject({ scope: 'map.recordCounts', reason: 'failed' });
    expect(result.fragment.coverage.unavailable[0].detail).toContain('Case');
    // And the person reading the report hears about it too, which before this they did not.
    expect(result.notes.some((n) => n.includes('Case'))).toBe(true);
  });
});

describe('runMap: a refused object catalog reaches the fragment', () => {
  it('marks the catalog as failed rather than running against an empty one unannounced', async () => {
    const result = await run(org({ refuseCatalog: true }));

    expect(result.fragment.coverage.unavailable.map((u) => `${u.scope}:${u.reason}`)).toContain('map.objects:failed');
    expect(result.notes.some((n) => n.includes('INSUFFICIENT_ACCESS'))).toBe(true);
  });
});

import { describe, it, expect } from '@jest/globals';
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { OrgIntelCache, contentHash } from '../../../src/lib/cache.js';

/**
 * The cache is meant to be a pure memo — same input, same result, so it can never change an
 * answer. That only holds if a change to the *analysis* invalidates it. Nothing keyed on the
 * tool version, so a summary computed by older logic survived every upgrade and silently
 * contradicted the determinism claim.
 */
const tempDir = (): string => mkdtempSync(join(tmpdir(), 'orgintel-cache-'));

describe('cache versioning', () => {
  it('does not serve an entry written by a different analysis version', () => {
    const base = tempDir();
    const old = new OrgIntelCache('00Dxx0000000000EAA', base, { version: '0.1.0' });
    old.set('flow', 'abc', { touched: 'old-logic' });

    const current = new OrgIntelCache('00Dxx0000000000EAA', base, { version: '0.2.0' });

    expect(old.get('flow', 'abc')).toEqual({ touched: 'old-logic' });
    expect(current.get('flow', 'abc')).toBeNull();
  });

  it('keeps orgs isolated from each other', () => {
    const base = tempDir();
    const a = new OrgIntelCache('00Dxx0000000000EAA', base, { version: '1.0.0' });
    const b = new OrgIntelCache('00Dyy0000000000EAA', base, { version: '1.0.0' });
    a.set('flow', 'k', { org: 'a' });

    expect(b.get('flow', 'k')).toBeNull();
  });

  it('recomputes rather than throwing when an entry is corrupt', async () => {
    const base = tempDir();
    const cache = new OrgIntelCache('00Dxx0000000000EAA', base, { version: '1.0.0' });
    cache.set('flow', 'k', { good: true });
    // Simulate a truncated write — a real risk if a run is interrupted.
    const path = cache.pathFor('flow', 'k');
    writeFileSync(path, '{"good":', 'utf8');

    expect(cache.get('flow', 'k')).toBeNull();
    await expect(cache.memoize('flow', 'k', () => ({ recomputed: true }))).resolves.toEqual({ recomputed: true });
  });
});

describe('refresh mode', () => {
  it('ignores existing entries but still writes fresh ones', async () => {
    const base = tempDir();
    const warm = new OrgIntelCache('00Dxx0000000000EAA', base, { version: '1.0.0' });
    // get/set take a hash; memoize hashes its content argument. Use one key form throughout.
    const key = contentHash('flow-version-id');
    warm.set('flow', key, { from: 'cache' });

    const refreshing = new OrgIntelCache('00Dxx0000000000EAA', base, { version: '1.0.0', refresh: true });

    expect(refreshing.get('flow', key)).toBeNull();
    const value = await refreshing.memoize('flow', 'flow-version-id', () => ({ from: 'fresh' }));
    expect(value).toEqual({ from: 'fresh' });
    // The fresh result must be persisted so the *next* ordinary run is warm.
    expect(warm.get('flow', key)).toEqual({ from: 'fresh' });
  });

  it('memoize recomputes exactly once per key when not refreshing', async () => {
    const cache = new OrgIntelCache('00Dxx0000000000EAA', tempDir(), { version: '1.0.0' });
    let calls = 0;
    const analyse = () => {
      calls++;
      return { n: calls };
    };

    await cache.memoize('flow', 'k', analyse);
    await cache.memoize('flow', 'k', analyse);

    expect(calls).toBe(1);
  });
});

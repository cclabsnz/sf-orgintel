import { readFileSync } from 'node:fs';
import { TOOL_VERSION } from '../../../src/version.js';

/**
 * `TOOL_VERSION` is stamped into the `provenance` block of the artifacts `intel probe`,
 * `intel discover` and `intel anatomy` build -- the payload each returns from `--json`, and for
 * `discover` the `orgintel-fingerprint-<orgId>-<timestamp>.json` it writes -- and it namespaces
 * the on-disk cache directory (`src/lib/cache.ts`). A value that disagrees with the published package version makes those
 * artifacts lie about what produced them. That matters more here than in most projects: they are
 * handed to clients and diffed across runs, and provenance is the part a reader has no way to
 * check.
 *
 * Not every artifact: the graph fragments carry no tool version at all. `graph-fragment.json`
 * and `anatomy-fragment.json` have a `CanonicalGraph` envelope whose capture facts are
 * `capturedAt` and the org id, and 1.0 dropped the unread `toolVersion` that `intel map` was
 * still threading through `runMap` for the retired `coupling-graph.json`. So this test covers
 * the artifacts named above and nothing else claims to be covered by it.
 *
 * It was kept in sync by a comment asking politely, which is not a mechanism. Releasing 0.2.0
 * with the constant still reading 0.1.0 would have been silent, would have passed every other
 * test, and would have been visible only in files already sent to someone.
 */
describe('TOOL_VERSION', () => {
  it('matches the version in package.json', () => {
    const pkg = JSON.parse(readFileSync(new URL('../../../package.json', import.meta.url), 'utf-8')) as {
      version: string;
    };
    expect(TOOL_VERSION).toBe(pkg.version);
  });
});

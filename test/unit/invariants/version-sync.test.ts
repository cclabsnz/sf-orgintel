import { readFileSync } from 'node:fs';
import { TOOL_VERSION } from '../../../src/version.js';

/**
 * `TOOL_VERSION` is stamped into the `provenance` block of every artifact this tool emits, so a
 * value that disagrees with the published package version makes the artifact lie about what
 * produced it. That matters more here than in most projects: these artifacts are handed to
 * clients and diffed across runs, and provenance is the part a reader has no way to check.
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

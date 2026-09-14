// The load-bearing test of the map/anatomy convergence work. Everything else asserts the new
// path is coherent; only this one asserts the old path did not quietly lose a fact on the way.
// `anatomy.json` is a published IR contract and sf-orgintel 0.2.0 is out, so a consumer is
// entitled to identical bytes for identical input until 1.0 retires it.
//
// Written before any later task in this plan touches the collectors or `@cclabsnz/sf-core`, so
// the golden file is a freeze of the artifact as the code stands today -- not of whatever a
// later change already produced.
import { describe, it, expect } from '@jest/globals';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { artifacts } from './fixtures/input.js';

const GOLDEN = join(process.cwd(), 'test/unit/anatomy/fixtures/anatomy.golden.json');

describe('anatomy.json', () => {
  it('produces a byte-identical artifact', async () => {
    const actual = JSON.stringify(await artifacts(), null, 2) + '\n';
    expect(actual).toBe(readFileSync(GOLDEN, 'utf8'));
  });
});

// The load-bearing test of the convergence work. Everything else asserts the new path is
// coherent; only this one asserts the old path did not quietly lose a fact on the way. These
// two artifacts are published IR contracts, and sf-orgintel 0.2.0 is out, so a consumer is
// entitled to identical bytes for identical input until 1.0 retires them.
import { describe, it, expect } from '@jest/globals';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { artifacts } from './fixtures/input.js';

const GOLDEN = join(process.cwd(), 'test/unit/map/fixtures/golden');

describe('legacy IR artifacts', () => {
  it('produces a byte-identical coupling-graph.json', () => {
    const actual = JSON.stringify(artifacts().couplingGraph, null, 2) + '\n';
    expect(actual).toBe(readFileSync(join(GOLDEN, 'coupling-graph.golden.json'), 'utf8'));
  });

  it('produces a byte-identical landscape-manifest.json', () => {
    const actual = JSON.stringify(artifacts().manifest, null, 2) + '\n';
    expect(actual).toBe(readFileSync(join(GOLDEN, 'landscape-manifest.golden.json'), 'utf8'));
  });
});

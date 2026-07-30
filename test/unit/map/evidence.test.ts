import { describe, it, expect } from '@jest/globals';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveEvidence } from '../../../src/map/evidence.js';
import { OrgIntelCache } from '../../../src/lib/cache.js';

/**
 * `intel map` stamped `evidenceTier: 'C'` into coupling-graph.json whenever no probe had run,
 * asserting a grade nobody measured. A tool whose premise is evidence quality must not invent
 * its own evidence quality.
 */
const cache = (): OrgIntelCache =>
  new OrgIntelCache('00Dxx0000000000EAA', mkdtempSync(join(tmpdir(), 'orgintel-ev-')));

describe('resolveEvidence', () => {
  it('propagates a tier that was actually measured', () => {
    const c = cache();
    c.set('probe', 'latest', { evidenceTier: 'B' });

    const e = resolveEvidence(c);

    expect(e.evidenceTier).toBe('B');
    expect(e.measured).toBe(true);
    expect(e.note).toBeUndefined();
  });

  it('reports null — never a default — when no probe has run', () => {
    const e = resolveEvidence(cache());

    expect(e.evidenceTier).toBeNull();
    expect(e.measured).toBe(false);
    expect(e.note).toMatch(/intel probe/);
  });

  it('rejects a cached tier outside the scale rather than trusting it', () => {
    const c = cache();
    c.set('probe', 'latest', { evidenceTier: 'Z' });

    const e = resolveEvidence(c);

    expect(e.evidenceTier).toBeNull();
    expect(e.measured).toBe(false);
  });

  it('surfaces cached anchors only when a discover has run', () => {
    const c = cache();
    expect(resolveEvidence(c).anchors).toBeUndefined();

    c.set('discover', 'latest', { anchors: [{ object: 'Case', label: 'Case', score: 0.9 }] });
    expect(resolveEvidence(c).anchors).toEqual([{ object: 'Case', label: 'Case', score: 0.9 }]);
  });
});

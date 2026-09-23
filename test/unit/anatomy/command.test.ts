// test/unit/anatomy/command.test.ts
import { readFileSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeFragment, writeReport } from '../../../src/commands/intel/anatomy.js';

/**
 * These claims used to be made against `writeArtifact`, which wrote `anatomy.json`. 1.0 retired
 * that artifact and deleted the writer; the fragment is the only IR `intel anatomy` emits now, so
 * the same three claims are made against the writer that survived rather than dropped with the
 * one that did not.
 */
describe('writeFragment', () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'anatomy-')); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it('writes anatomy-fragment.json and returns its path', () => {
    const fragment = { schemaVersion: '1.0.0', nodes: [], edges: [] } as any;
    const p = writeFragment(dir, fragment);
    expect(p).toBe(join(dir, 'anatomy-fragment.json'));
    expect(JSON.parse(readFileSync(p, 'utf-8'))).toEqual(fragment);
  });

  it('writes stable JSON, so two runs of the same fragment diff cleanly', () => {
    const fragment = { schemaVersion: '1.0.0', nodes: [], edges: [] } as any;
    const a = readFileSync(writeFragment(dir, fragment), 'utf-8');
    const b = readFileSync(writeFragment(dir, fragment), 'utf-8');
    expect(a).toBe(b);
    expect(a.endsWith('\n')).toBe(true);
  });

  it('writes no HTML of its own, so a run without --html leaves none behind', () => {
    // The two writers are separate on purpose: --html is opt-in, and a report carrying real
    // product names and endpoints must never appear on disk because a flag was defaulted on.
    writeFragment(dir, { schemaVersion: '1.0.0', nodes: [], edges: [] } as any);
    expect(readdirSync(dir).filter((f) => f.endsWith('.html'))).toEqual([]);
  });

  it('no longer writes anatomy.json alongside it', () => {
    // The retirement, asserted rather than assumed: the output directory after a fragment write
    // must contain the fragment and nothing else, so a reinstated artifact write fails here.
    writeFragment(dir, { schemaVersion: '1.0.0', nodes: [], edges: [] } as any);
    expect(readdirSync(dir)).toEqual(['anatomy-fragment.json']);
  });
});

describe('writeReport', () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'anatomy-')); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it('names the file on the same convention as the map report', () => {
    const p = writeReport(dir, '<html></html>', '00Dxx0000000000EAA', 1_760_000_000_000);
    expect(p).toBe(join(dir, 'orgintel-anatomy-00Dxx0000000000EAA-1760000000000.html'));
    expect(readFileSync(p, 'utf-8')).toBe('<html></html>');
  });

  it('creates the output directory rather than failing on a path that does not exist yet', () => {
    const nested = join(dir, 'reports');
    expect(writeReport(nested, '<html></html>', '00Dxx0000000000EAA', 1)).toBe(
      join(nested, 'orgintel-anatomy-00Dxx0000000000EAA-1.html'),
    );
  });

  it('keeps each run as its own file, so an earlier report is never overwritten', () => {
    writeReport(dir, '<html>a</html>', '00Dxx0000000000EAA', 1);
    writeReport(dir, '<html>b</html>', '00Dxx0000000000EAA', 2);
    expect(readdirSync(dir).filter((f) => f.endsWith('.html'))).toHaveLength(2);
  });
});

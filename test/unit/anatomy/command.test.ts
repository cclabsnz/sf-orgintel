// test/unit/anatomy/command.test.ts
import { readFileSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeArtifact, writeReport } from '../../../src/commands/intel/anatomy.js';

describe('writeArtifact', () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'anatomy-')); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it('writes anatomy.json and returns its path', () => {
    const artifact = { version: 2, edges: [] } as any;
    const p = writeArtifact(dir, artifact);
    expect(p).toBe(join(dir, 'anatomy.json'));
    expect(JSON.parse(readFileSync(p, 'utf-8'))).toEqual(artifact);
  });

  it('writes stable JSON, so two runs of the same artifact diff cleanly', () => {
    const artifact = { version: 2, edges: [] } as any;
    const a = readFileSync(writeArtifact(dir, artifact), 'utf-8');
    const b = readFileSync(writeArtifact(dir, artifact), 'utf-8');
    expect(a).toBe(b);
    expect(a.endsWith('\n')).toBe(true);
  });

  it('writes no HTML of its own, so a run without --html leaves none behind', () => {
    // The two writers are separate on purpose: --html is opt-in, and a report carrying real
    // product names and endpoints must never appear on disk because a flag was defaulted on.
    writeArtifact(dir, { version: 2, edges: [] } as any);
    expect(readdirSync(dir).filter((f) => f.endsWith('.html'))).toEqual([]);
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

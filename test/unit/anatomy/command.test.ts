// test/unit/anatomy/command.test.ts
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeArtifact } from '../../../src/commands/intel/anatomy.js';

describe('writeArtifact', () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'anatomy-')); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it('writes anatomy.json and returns its path', () => {
    const artifact = { version: 1, edges: [] } as any;
    const p = writeArtifact(dir, artifact);
    expect(p).toBe(join(dir, 'anatomy.json'));
    expect(JSON.parse(readFileSync(p, 'utf-8'))).toEqual(artifact);
  });

  it('writes stable JSON, so two runs of the same artifact diff cleanly', () => {
    const artifact = { version: 1, edges: [] } as any;
    const a = readFileSync(writeArtifact(dir, artifact), 'utf-8');
    const b = readFileSync(writeArtifact(dir, artifact), 'utf-8');
    expect(a).toBe(b);
    expect(a.endsWith('\n')).toBe(true);
  });
});

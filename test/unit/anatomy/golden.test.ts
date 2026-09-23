// The one absolute assertion over the anatomy artifact this fixture's org produces.
//
// 1.0 retired the FILE, not the SHAPE. `anatomy.json` is no longer written, but
// `IntelAnatomyCommand extends SfCommand<AnatomyArtifact>` and `run()` still returns the
// artifact, so `sf intel anatomy --json` emits exactly this content. It is as published as it
// ever was; only its delivery changed. What this freezes is therefore the `--json` payload, and
// a consumer is still entitled to identical bytes for identical input.
//
// It cannot be replaced by fragmentConsistency.test.ts, which is the obvious candidate and the
// wrong one: that suite compares two halves derived from ONE collector run, so a collector that
// silently returns nothing empties both halves together and every one of its assertions passes
// on `[] === []`. Only an absolute comparison against frozen bytes catches that. It is also the
// only determinism check over a POPULATED artifact -- `runAnatomy.test.ts`'s byte-identity test
// runs against `emptyCtx()`.
//
// The golden was captured before any task in this plan touched the collectors or
// `@cclabsnz/sf-core`, so it freezes the artifact as the code stood then -- not whatever a later
// change already produced. Do not regenerate it to clear a failure: a regenerated golden pins
// the change, which is the guarantee this file exists to refuse. A field added to or dropped
// from `AnatomyArtifact` moves nothing else in the suite.
import { describe, it, expect } from '@jest/globals';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { artifacts } from './fixtures/input.js';

const GOLDEN = join(process.cwd(), 'test/unit/anatomy/fixtures/anatomy.golden.json');

describe('the anatomy artifact `--json` emits', () => {
  it('produces a byte-identical artifact', async () => {
    const actual = JSON.stringify(await artifacts(), null, 2) + '\n';
    expect(actual).toBe(readFileSync(GOLDEN, 'utf8'));
  });
});

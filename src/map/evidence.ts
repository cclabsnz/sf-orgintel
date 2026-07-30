import type { EvidenceTier } from '@cclabsnz/sf-core';
import type { OrgIntelCache } from '../lib/cache.js';

export interface MapAnchor {
  object: string;
  label: string;
  score: number;
}

export interface ResolvedEvidence {
  /** The measured tier, or null when no probe has graded this org. */
  evidenceTier: EvidenceTier | null;
  /** True only when the tier came from an actual `intel probe` run. */
  measured: boolean;
  /** Operator-facing explanation, present only when the tier is unmeasured. */
  note?: string;
  /** Ranked anchors from a cached `intel discover`, if one has run. */
  anchors?: MapAnchor[];
}

const TIERS: readonly string[] = ['A', 'B', 'C', 'D'];

/**
 * Resolve the evidence tier and anchors `intel map` should report, from whatever earlier
 * commands have cached.
 *
 * `map` previously defaulted to 'C' when no probe had run, writing a grade into
 * coupling-graph.json that was never measured. A tool whose premise is evidence quality must
 * not invent its own: an unmeasured tier is null, and the operator is told how to get a real
 * one. A cached value outside the A–D scale is treated as unmeasured rather than trusted —
 * the cache is on disk and can be stale or hand-edited.
 */
export function resolveEvidence(cache: OrgIntelCache): ResolvedEvidence {
  const probe = cache.get<{ evidenceTier?: unknown }>('probe', 'latest');
  const discover = cache.get<{ anchors?: Array<{ object: string; label: string; score: number }> }>(
    'discover',
    'latest',
  );

  const cached = probe?.evidenceTier;
  const measured = typeof cached === 'string' && TIERS.includes(cached);

  return {
    evidenceTier: measured ? (cached as EvidenceTier) : null,
    measured,
    note: measured
      ? undefined
      : 'Evidence tier not measured — run `sf intel probe` first to grade what this org can evidence.',
    anchors: discover?.anchors?.map((a) => ({ object: a.object, label: a.label, score: a.score })),
  };
}

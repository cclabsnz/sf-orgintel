import type { Layer } from './layers.js';

export type DetailTier = 'landscape' | 'domains' | 'objects';

export interface DetailNode {
  object: string;
  layer: Layer;
  /** How many couplings touch this object; drives what survives at lower zoom. */
  degree: number;
}

export interface DetailLevel {
  tier: DetailTier;
  objects: DetailNode[];
  showLabels: boolean;
  showEdges: boolean;
}

export interface DetailOptions {
  /** Never hidden, whatever the zoom — a reader following a thread must not lose it. */
  selected?: string | null;
}

/** What each tier is for, shown to the reader so the view never changes without explanation. */
export const DETAIL_TIERS: Readonly<Record<DetailTier, string>> = {
  landscape: 'layers and their sizes',
  domains: 'the most connected objects',
  objects: 'every object, labelled',
};

/** Below this the reader is looking at shape, not detail. */
const LANDSCAPE_BELOW = 0.7;
/** Above this everything is legible, so show everything. */
const OBJECTS_ABOVE = 1.8;

/**
 * Choose what to draw for a given zoom.
 *
 * Semantic zoom rather than magnification: zooming out does not shrink the picture, it removes
 * detail that is not readable at that size. Drawing every object at every zoom is precisely
 * what made the flat graph a cloud — the information was all present and none of it legible.
 *
 * What survives at middle zoom is chosen by coupling degree, so the objects that shape the org
 * appear first and the long tail arrives only when there is room for it.
 */
export function detailAt(
  zoom: number,
  nodes: readonly DetailNode[],
  opts: DetailOptions = {},
): DetailLevel {
  const ranked = [...nodes].sort((a, b) => b.degree - a.degree || a.object.localeCompare(b.object));
  const keep = (n: number): DetailNode[] => {
    const head = ranked.slice(0, n);
    if (!opts.selected) return head;
    if (head.some((o) => o.object === opts.selected)) return head;
    const pinned = ranked.find((o) => o.object === opts.selected);
    return pinned ? [...head, pinned] : head;
  };

  if (zoom < LANDSCAPE_BELOW) {
    return { tier: 'landscape', objects: keep(0), showLabels: false, showEdges: false };
  }
  if (zoom < OBJECTS_ABOVE) {
    // Grow smoothly through the middle band so zooming feels continuous rather than stepped.
    const span = (zoom - LANDSCAPE_BELOW) / (OBJECTS_ABOVE - LANDSCAPE_BELOW);
    const n = Math.max(1, Math.round(ranked.length * (0.25 + 0.55 * span)));
    return { tier: 'domains', objects: keep(n), showLabels: false, showEdges: true };
  }
  return { tier: 'objects', objects: keep(ranked.length), showLabels: true, showEdges: true };
}

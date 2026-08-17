// src/anatomy/view/bandLayout.ts
// View A geometry: turns the seven bands into positioned, sized rectangles. Pure arithmetic.
// It knows nothing about SVG, colour, or the artifact, so the renderer can change entirely
// without touching a single coordinate rule, and every rule here is testable without an org.
//
// Two invariants carry the honesty rule of docs/ANATOMY_SPEC.md section 6 into the geometry:
//
//  1. A band with no tiles still gets a full row of height. A band collapsed to zero height is
//     visually identical to a band that was never drawn, which is exactly the "we never looked"
//     misreading that `emptiness` exists to prevent. The renderer needs somewhere to write
//     "none" or the not-collected note, and that somewhere is reserved here.
//  2. Every tile gets at least FLOOR_W. A tile scaled to invisibility is a finding the reader
//     never sees, so one dominant product must not be able to squeeze the rest out of sight.
import type { BandContent, BandId, Tile } from './bands.js';

/** Canvas coordinates, not band-relative: `x`/`y` are absolute so the renderer needs no transform. */
export interface PlacedTile {
  tile: Tile;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface PlacedBand {
  id: BandId;
  title: string;
  y: number;
  height: number;
  tiles: PlacedTile[];
  emptiness: BandContent['emptiness'];
  note: string | null;
}

export interface BandLayout {
  bands: PlacedBand[];
  width: number;
  height: number;
}

export interface LayoutOptions {
  width?: number;
  tileHeight?: number;
  gutter?: number;
}

const DEFAULT_WIDTH = 960;
const DEFAULT_TILE_HEIGHT = 44;
const DEFAULT_GUTTER = 8;

/** Left and right page margin. Tiles start at MARGIN_X and never cross `width - MARGIN_X`. */
const MARGIN_X = 16;
/** Top and bottom page margin. */
const MARGIN_Y = 12;
/** Strip above each band's tiles, holding the band title. */
const HEADER_H = 26;
/** Breathing room under the last row of a band, before the next band's header. */
const BAND_PAD_BOTTOM = 12;

/**
 * Narrowest a tile may be drawn. Below roughly this, a label is unreadable and a reading is lost.
 *
 * Set from the rendered result, not from taste. At the first value tried, 64, the fixed
 * capability tiles (whose metric is often small or zero, so they always land on the floor)
 * truncated to `Syste…` and `Even…`, and the hatched not-read tile had no room for a label at
 * all: a tile saying "not read" without saying what was not read. 112 fits around seventeen
 * characters beside nothing else, which is enough to tell `Remote Site S…` from `Named Cred…`.
 */
const FLOOR_W = 112;
/** Widest a tile may be drawn, so the largest reading cannot monopolise a row. */
const CAP_W = 260;

/** One decimal place, matching mapReport.ts, so the same input yields the same bytes of markup. */
const r = (n: number): number => Math.round(n * 10) / 10;

/**
 * Width for a tile, scaled against the largest metric in its own band.
 *
 * Square-rooted rather than linear. Component counts across products routinely span three orders
 * of magnitude, and under a linear scale everything except the largest lands on the floor, which
 * throws away the comparison the tile sizes exist to make. The square root keeps the small
 * readings distinguishable from each other while still ranking them all below the largest.
 */
function tileWidth(metric: number, maxMetric: number, available: number): number {
  // maxMetric 0 means every reading in the band is 0, a real and common answer (an org with no
  // Apex, say). There is nothing to scale against, so every tile takes the floor.
  const ratio = maxMetric > 0 ? Math.sqrt(Math.max(0, metric) / maxMetric) : 0;
  const w = FLOOR_W + ratio * (CAP_W - FLOOR_W);
  // A narrow canvas wins over the cap: overflowing the page is worse than an undersized tile.
  return r(Math.min(w, available));
}

function layoutBand(band: BandContent, top: number, width: number, tileHeight: number, gutter: number): PlacedBand {
  const available = Math.max(FLOOR_W, width - MARGIN_X * 2);
  const maxMetric = band.tiles.reduce((m, t) => Math.max(m, t.metric), 0);
  const tilesTop = top + HEADER_H;

  const placed: PlacedTile[] = [];
  let x = MARGIN_X;
  let row = 0;
  for (const tile of band.tiles) {
    const w = tileWidth(tile.metric, maxMetric, available);
    // Wrap before drawing, never after: a tile that would cross the right margin starts the next
    // row instead. The `x > MARGIN_X` guard stops a tile as wide as the canvas looping forever on
    // an empty row it can never fit into.
    if (x > MARGIN_X && x + w > width - MARGIN_X) {
      row += 1;
      x = MARGIN_X;
    }
    placed.push({ tile, x: r(x), y: r(tilesTop + row * (tileHeight + gutter)), w, h: tileHeight });
    x += w + gutter;
  }

  // Empty and not-collected bands reserve one row anyway. See invariant 1 above.
  const rows = band.tiles.length === 0 ? 1 : row + 1;
  const height = HEADER_H + rows * tileHeight + (rows - 1) * gutter + BAND_PAD_BOTTOM;

  return {
    id: band.id,
    title: band.title,
    y: r(top),
    height: r(height),
    tiles: placed,
    emptiness: band.emptiness,
    note: band.note,
  };
}

/**
 * Stack the given bands top to bottom, in the order supplied. Bands are never reordered, merged
 * or dropped: seven in means seven out, so a missing band can only ever be a missing band.
 */
export function layoutBands(bands: readonly BandContent[], opts: LayoutOptions = {}): BandLayout {
  const width = opts.width ?? DEFAULT_WIDTH;
  const tileHeight = opts.tileHeight ?? DEFAULT_TILE_HEIGHT;
  const gutter = opts.gutter ?? DEFAULT_GUTTER;

  const placed: PlacedBand[] = [];
  let y = MARGIN_Y;
  for (const band of bands) {
    const b = layoutBand(band, y, width, tileHeight, gutter);
    placed.push(b);
    y = b.y + b.height + gutter;
  }

  // Drop the trailing inter-band gutter, then add the bottom margin.
  const height = placed.length === 0 ? MARGIN_Y * 2 : y - gutter + MARGIN_Y;
  return { bands: placed, width, height: r(height) };
}

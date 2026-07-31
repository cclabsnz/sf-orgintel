import { LAYERS, type Layer } from './layers.js';

export interface StrataObject {
  object: string;
  layer: Layer;
}

export interface StrataEdge {
  from: string;
  to: string;
  weight: number;
}

export interface Point {
  x: number;
  y: number;
}

export interface Band {
  layer: Layer;
  /** Vertical centre of the band. */
  y: number;
  /** Objects placed in it. */
  count: number;
}

export interface StrataLayout {
  positions: Map<string, Point>;
  bands: Band[];
  width: number;
  height: number;
  /**
   * Weighted edge crossings in the chosen ordering. Reported so callers can see the layout is
   * never worse than the naive alphabetical one — the only guarantee barycentre offers, since
   * it minimises crossings globally rather than placing any particular pair together.
   */
  crossings: number;
}

export interface StrataOptions {
  width?: number;
  height?: number;
  /** Barycentre sweeps used to reduce edge crossings. */
  passes?: number;
}

const MARGIN_X = 70;
const MARGIN_Y = 44;

/**
 * Lay objects out in horizontal bands, one per architectural layer.
 *
 * A force-directed picture of a real org is a hairball: 200 objects and 2000 couplings resolve
 * into a cloud with no readable structure. Fixing each object's vertical position to its layer
 * turns the same data into strata, so a reader sees immediately how much of the graph is
 * business process and how heavily it reaches into identity, logging or configuration.
 *
 * Vertical position is therefore not free. The only remaining freedom is horizontal order, and
 * that is chosen by repeated barycentre sweeps — each object moves toward the average position
 * of its neighbours — which is the standard way to reduce edge crossings in a layered drawing.
 * Ordering is fully determined by name on ties, so the picture is reproducible.
 */
export function computeStrataLayout(
  objects: readonly StrataObject[],
  edges: readonly StrataEdge[],
  opts: StrataOptions = {},
): StrataLayout {
  const width = opts.width ?? 1000;
  const height = opts.height ?? 700;
  const passes = opts.passes ?? 6;

  if (objects.length === 0) return { positions: new Map(), bands: [], width, height, crossings: 0 };

  // Group by layer, keeping only layers that actually have objects, in canonical order.
  const byLayer = new Map<Layer, string[]>();
  for (const o of [...objects].sort((a, b) => a.object.localeCompare(b.object))) {
    if (!byLayer.has(o.layer)) byLayer.set(o.layer, []);
    byLayer.get(o.layer)!.push(o.object);
  }
  const present = LAYERS.filter((l) => byLayer.has(l));

  const neighbours = buildNeighbours(objects, edges);
  const order = new Map(present.map((l) => [l, byLayer.get(l)!.slice()]));

  // Barycentre sweeps: each object drifts toward the mean position of what it couples to.
  //
  // The best arrangement seen is kept rather than whichever the last pass left behind, because
  // barycentre ordering is known to oscillate — a sweep can flip two rows and the next flip
  // them back, making the answer depend on the parity of the pass count. This is defensive:
  // with alternating sweeps no fixture tried so far actually oscillates, so the guard is
  // insurance against a documented failure mode rather than something the tests exercise.
  let best = snapshot(order, present);
  let bestCrossings = countCrossings(best, present, edges);

  for (let pass = 0; pass < passes; pass++) {
    // Alternate direction and sort each band against neighbours already placed in this sweep.
    // Reordering every band against one stale snapshot cannot fix the classic fully-crossed
    // case: both sides flip together and the crossings survive untouched.
    const sweep = pass % 2 === 0 ? present : [...present].reverse();
    for (const layer of sweep) {
      const row = order.get(layer)!;
      if (row.length < 2) continue;
      const index = positionIndex(order, present);
      const bary = new Map(
        row.map((name) => {
          const ns = (neighbours.get(name) ?? [])
            .filter((n) => !row.includes(n))
            .map((n) => index.get(n))
            .filter((v): v is number => v !== undefined);
          return [name, ns.length > 0 ? ns.reduce((s, v) => s + v, 0) / ns.length : index.get(name)!];
        }),
      );
      row.sort((a, b) => bary.get(a)! - bary.get(b)! || a.localeCompare(b));
    }
    const crossings = countCrossings(order, present, edges);
    if (crossings < bestCrossings) {
      bestCrossings = crossings;
      best = snapshot(order, present);
    }
  }
  for (const layer of present) order.set(layer, best.get(layer)!);

  const bandHeight = (height - 2 * MARGIN_Y) / present.length;
  const positions = new Map<string, Point>();
  const bands: Band[] = [];

  present.forEach((layer, i) => {
    const row = order.get(layer)!;
    const y = MARGIN_Y + bandHeight * (i + 0.5);
    bands.push({ layer, y: round(y), count: row.length });
    const span = width - 2 * MARGIN_X;
    row.forEach((name, j) => {
      const x = row.length === 1 ? width / 2 : MARGIN_X + (span * j) / (row.length - 1);
      positions.set(name, { x: round(x), y: round(y) });
    });
  });

  return { positions, bands, width, height, crossings: bestCrossings };
}

function snapshot(order: Map<Layer, string[]>, present: readonly Layer[]): Map<Layer, string[]> {
  return new Map(present.map((l) => [l, order.get(l)!.slice()]));
}

/**
 * Weighted count of edge crossings under the current ordering. Two edges cross when their
 * endpoints are in opposite horizontal order, and a heavier pair crossing is worse to read.
 */
function countCrossings(
  order: Map<Layer, string[]>,
  present: readonly Layer[],
  edges: readonly StrataEdge[],
): number {
  const index = positionIndex(order, present);
  const drawn = edges
    .map((e) => ({ a: index.get(e.from), b: index.get(e.to), w: e.weight }))
    .filter((e): e is { a: number; b: number; w: number } => e.a !== undefined && e.b !== undefined);

  let total = 0;
  for (let i = 0; i < drawn.length; i++) {
    for (let j = i + 1; j < drawn.length; j++) {
      const p = drawn[i];
      const q = drawn[j];
      if ((p.a - q.a) * (p.b - q.b) < 0) total += p.w + q.w;
    }
  }
  return total;
}

/** object -> objects it couples to, heaviest first so barycentre follows the strongest pull. */
function buildNeighbours(
  objects: readonly StrataObject[],
  edges: readonly StrataEdge[],
): Map<string, string[]> {
  const known = new Set(objects.map((o) => o.object));
  const acc = new Map<string, { name: string; weight: number }[]>();
  for (const e of edges) {
    if (!known.has(e.from) || !known.has(e.to) || e.from === e.to) continue;
    if (!acc.has(e.from)) acc.set(e.from, []);
    if (!acc.has(e.to)) acc.set(e.to, []);
    acc.get(e.from)!.push({ name: e.to, weight: e.weight });
    acc.get(e.to)!.push({ name: e.from, weight: e.weight });
  }
  const out = new Map<string, string[]>();
  for (const [name, ns] of acc) {
    ns.sort((a, b) => b.weight - a.weight || a.name.localeCompare(b.name));
    out.set(name, ns.map((n) => n.name));
  }
  return out;
}

/** Normalised 0..1 horizontal index of every object under the current ordering. */
function positionIndex(order: Map<Layer, string[]>, present: readonly Layer[]): Map<string, number> {
  const index = new Map<string, number>();
  for (const layer of present) {
    const row = order.get(layer)!;
    row.forEach((name, j) => index.set(name, row.length === 1 ? 0.5 : j / (row.length - 1)));
  }
  return index;
}

function round(n: number): number {
  return Math.round(n * 10) / 10;
}

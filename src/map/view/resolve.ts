// Turns a NavigationViewSpec plus a merged graph into the same coordinates buildManifest
// produces for L0 and L1. This module changes no rendering behaviour and reads no org data --
// it is a second route to the coordinates buildManifest already writes to landscape-manifest.json,
// so test/unit/map/view/equivalence.test.ts can prove the two agree while buildManifest still
// exists to compare against.
//
// LAYOUT REUSE: computeLayout is called here, not reimplemented. A second layout algorithm would
// make the equivalence test compare two algorithms instead of two routes to one algorithm, which
// would prove nothing about whether the view spec is a faithful description of buildManifest's
// rules.
//
// EDGE DEDUPLICATION: buildManifest derives its cross-cluster edges with a private helper,
// interClusterEdges (src/map/graph/manifest.ts, bottom of file), that deduplicates cluster-to-
// cluster links in a deterministic order. crossDomainEdges below reproduces that behaviour
// exactly (same pair-key ordering, same sort) rather than importing it: manifest.ts is deleted
// at 1.0, and a replacement that imports from the thing it replaces cannot outlive it.
// Duplication is correct while both exist; test/unit/map/view/equivalence.test.ts is what keeps
// them honest.
//
// LEVEL RESOLUTION: both L0 and L1 are resolved from the selector's own item list -- L0 from the
// 'domain' items, L1 from the 'object' items grouped by domainId -- rather than L1 falling back
// to iterating clusters directly. A resolver that ignores the view's output for half its levels
// would make the spec decorative for those levels, which is the opposite of what this module is
// for. The objects grouped by domainId are the same set as cluster.objects, and computeLayout
// sorts its node list internally before laying anything out, so the order they are gathered in
// cannot affect the coordinates produced.
import { computeLayout, type LayoutEdge, type Point } from '../graph/layout.js';
import type { Cluster } from '../graph/clusters.js';
import type { NavigationViewSpec } from './spec.js';

export interface ResolvedLevel {
  id: 'L0_landscape' | 'L1_domain';
  /** L0: one entry per domain, keyed by cluster id. L1: one entry per domain, each holding that
   *  domain's own object coordinate space, keyed by object name. */
  coordinates: Map<string, Map<string, Point>>;
}

export function resolveNavigationView(
  spec: NavigationViewSpec,
  clusters: readonly Cluster[],
  edges: readonly LayoutEdge[],
): ResolvedLevel[] {
  const items = spec.selector(clusters);
  const clusterOf = new Map<string, string>();
  for (const c of clusters) for (const o of c.objects) clusterOf.set(o, c.id);

  const out: ResolvedLevel[] = [];
  for (const level of spec.levels) {
    const selected = items.filter((i) => level.match(i));

    if (level.id === 'L0_landscape') {
      const ids = selected.map((i) => i.id);
      const coords = computeLayout(ids, crossDomainEdges(edges, clusterOf));
      out.push({ id: level.id, coordinates: new Map([['landscape', coords]]) });
      continue;
    }

    // L1_domain: group the selector's own 'object' items by domainId, rather than iterating
    // clusters directly -- see the module header note on why that distinction matters.
    const objectsByDomain = new Map<string, string[]>();
    for (const item of selected) {
      if (item.kind !== 'object') continue;
      const list = objectsByDomain.get(item.domainId);
      if (list) list.push(item.id);
      else objectsByDomain.set(item.domainId, [item.id]);
    }

    const perDomain = new Map<string, Map<string, Point>>();
    for (const [domainId, objects] of objectsByDomain) {
      const within = new Set(objects);
      const internal = edges.filter((e) => within.has(e.from) && within.has(e.to));
      perDomain.set(domainId, computeLayout(objects, internal));
    }
    out.push({ id: level.id, coordinates: perDomain });
  }
  return out;
}

/**
 * Distinct cluster-to-cluster links, for laying the landscape out. Deterministically ordered.
 * Reproduces manifest.ts's interClusterEdges exactly (same pair-key ordering, same dedup, same
 * sort) rather than importing it -- see the module header.
 */
function crossDomainEdges(edges: readonly LayoutEdge[], clusterOf: Map<string, string>): LayoutEdge[] {
  const seen = new Set<string>();
  const out: LayoutEdge[] = [];
  for (const e of edges) {
    const a = clusterOf.get(e.from);
    const b = clusterOf.get(e.to);
    if (a === undefined || b === undefined || a === b) continue;
    const key = a < b ? `${a}|${b}` : `${b}|${a}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ from: a, to: b });
  }
  return out.sort((x, y) => (x.from + x.to).localeCompare(y.from + y.to));
}

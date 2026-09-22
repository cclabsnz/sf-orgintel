// The navigation view expressed as data: a name, a selector, and a level list -- exactly the shape
// sf-orgviz's own design taxonomy gives a "view" (a saved selector plus band order). This is
// what makes `intel map` a *projection* rather than a third hardcoded view name: the
// membership rules `buildManifest` used to bury in the L0/L1 layout logic are now a value that can
// be inspected, tested and (eventually) resolved by something other than `buildManifest`.
//
// This module changes no rendering behaviour. `buildManifest` still builds the manifest
// `intel map` writes, unchanged. The NAVIGATION_VIEW spec is the value this module contributes;
// a resolver in a later change will consume it to prove that the coordinates agree on level
// *membership*, which is the whole point of turning the rules into data.
//
// TYPE OWNERSHIP: `NavigationViewSpec` is declared LOCALLY here, not imported from a shared package.
// sf-orgviz still hardcodes its own view types and there is no `NavigationViewSpec` in
// @cclabsnz/sf-core@0.6.0 for the two repos to share. Promoting this type -- and a resolver
// sf-orgviz could run against its own `CanonicalGraph` -- to sf-core, so sf-orgviz can resolve
// this exact spec, is follow-on work gated on that package's next release. It is not attempted here.
//
// SELECTOR SCOPE: sf-orgviz may apply its own narrowing to graph queries. `navigation`'s selector
// performs no narrowing: it projects every cluster and every object in that cluster into a flat
// item list; the levels, not the selector, partition that list by kind. The selector's one job is
// to express the cluster-to-domain and cluster-to-object relationships that buildManifest lays out.
import type { Cluster } from '../graph/clusters.js';

/** One thing a navigation level can place. A domain at L0, an object at L1. */
export type NavItem =
  | { kind: 'domain'; id: string; objects: string[]; anchorObject: string }
  | { kind: 'object'; id: string; domainId: string };

export interface LevelSpec {
  id: 'L0_landscape' | 'L1_domain';
  title: string;
  /** Selects which of the selector's items this level places. */
  match: (item: NavItem) => boolean;
}

export interface NavigationViewSpec {
  name: string;
  /** Projects clusters into the flat item list levels select over. No narrowing. */
  selector: (clusters: readonly Cluster[]) => NavItem[];
  levels: LevelSpec[];
}

export const NAVIGATION_VIEW: NavigationViewSpec = {
  name: 'navigation',
  selector: (clusters) => {
    const items: NavItem[] = [];
    for (const c of clusters) {
      items.push({ kind: 'domain', id: c.id, objects: c.objects, anchorObject: c.anchorObject });
      for (const o of c.objects) items.push({ kind: 'object', id: o, domainId: c.id });
    }
    return items;
  },
  levels: [
    // Where each domain sits in the landscape, relative to the other domains.
    { id: 'L0_landscape', title: 'Landscape', match: (i) => i.kind === 'domain' },
    // Where each object sits inside its own domain. A different coordinate space from L0's,
    // deliberately: buildManifest lays each domain out on its own.
    { id: 'L1_domain', title: 'Domain', match: (i) => i.kind === 'object' },
  ],
};

// The anatomy view expressed as data: a name, a selector, and a band list -- exactly the shape
// sf-orgviz's own design taxonomy gives a "view" (a saved selector plus band order). This is
// what makes `intel anatomy` a *projection* rather than a third hardcoded view name: the
// membership rules `bands.ts` used to bury in seven separate functions are now a value that can
// be inspected, tested and (eventually) resolved by something other than `buildBands`.
//
// This module changes no rendering behaviour. `buildBands` still builds the tiles anatomy
// renders, unchanged; `ANATOMY_VIEW` and `resolveAnatomyView` exist so a test can prove the two
// agree on band *membership*, which is the whole point of turning the rules into data.
//
// TYPE OWNERSHIP: `ViewSpec` is declared LOCALLY here, not imported from a shared package.
// sf-orgviz still hardcodes `ViewName = 'permset' | 'reach'` (src/export/views.ts) and there is
// no `ViewSpec` in @cclabsnz/sf-core@0.6.0 for the two repos to share. Promoting this type -- and
// a resolver sf-orgviz could run against its own `CanonicalGraph` -- to sf-core, so sf-orgviz can
// resolve this exact spec, is follow-on work gated on that package's next release. It is not
// attempted here.
//
// SELECTOR SCOPE: sf-orgviz's `permset`/`reach` views narrow a large graph down to a
// neighbourhood (see its src/export/views.ts). `anatomy`'s selector does the opposite kind of
// nothing: the seven bands exist to summarise the *entire* org on one screen, so
// `ANATOMY_VIEW.selector` performs no narrowing at all. It projects every population in the
// artifact into a flat list of items; the bands, not the selector, partition that list by kind.
// The one piece of real work the selector does is grouping: `integration` and `external` are not
// "one item per edge" but "one item per distinct detection / distinct endpoint", because that is
// the granularity `buildIntegrationBand`/`buildExternalBand` render at (a tile per detection
// type, a tile per endpoint, not a tile per edge). A resolver over an actual merged
// `CanonicalGraph` would need that same grouping available on the graph's edges -- and, more
// importantly, would need edges that today's anatomy fragment (`src/anatomy/fragment.ts`)
// deliberately drops (`edges.unattributed`, `edges.remoteProxy`, `edges.unresolvedTarget` in its
// coverage). Those dropped edges still count in `integration`/`external` here because
// `buildIntegrationBand`/`buildExternalBand` read `artifact.edges` directly, not the fragment.
// That gap -- the fragment's graph is lossier than the artifact bands render from -- is a real
// property of the current design, not an artifact of this module, and is left for whoever
// eventually resolves this spec against a real merged graph rather than against the artifact.
import { classify, type BandId } from './bands.js';
import type { AnatomyArtifact, Detection } from '../types.js';

/**
 * One thing a band can claim, tagged by the artifact population it comes from. Deliberately not
 * a `CanonicalGraph` node: see the SELECTOR SCOPE note above for why a real graph's edges are not
 * yet rich enough to stand in for `artifact.edges` here.
 */
export type ViewItem =
  | { kind: 'persona'; id: string }
  | { kind: 'channel'; id: string }
  | { kind: 'product'; id: string }
  | { kind: 'capabilityTile'; id: string }
  | { kind: 'integrationEdge'; id: string; detection: Detection }
  | { kind: 'externalEndpoint'; id: string }
  | { kind: 'opsTile'; id: string };

export interface BandSpec {
  id: BandId;
  title: string;
  /** Selects which of the selector's items belong to this band. Every band here is a plain kind
   * equality check -- see the module header for where the real work (grouping) actually lives. */
  match: (item: ViewItem) => boolean;
}

export interface ViewSpec {
  name: string;
  /** Projects an artifact into the flat item list `bands[].match` selects over. Performs no
   * narrowing -- every item in the artifact is represented, grouped only where `buildBands`
   * itself groups (integration by detection, external by endpoint). */
  selector: (artifact: AnatomyArtifact) => ViewItem[];
  bands: BandSpec[];
}

/**
 * The eight capability tiles `buildCapabilitiesBand` always renders, fixed set per
 * ANATOMY_SPEC.md section 6: an absent capability is a finding, not an omission. Order here is
 * irrelevant -- `resolveAnatomyView` compares membership as a sorted set, the same way
 * `buildBands`'s own `sortByLabel` makes tile order a rendering detail, not a membership one.
 */
const FIXED_CAPABILITY_TILE_IDS = [
  'apexClasses',
  'apexTriggers',
  'flows',
  'lwc',
  'aura',
  'namedCredentials',
  'externalDataSources',
  'remoteSites',
] as const;

/** The three ops tiles `buildOpsBand` always renders, same fixed-set rule as capabilities. */
const FIXED_OPS_TILE_IDS = ['eventRelay', 'platformEvents', 'changeDataCapture'] as const;

/**
 * The artifact -> flat item list. Tile ids match `bands.ts`'s own tile id formulas exactly
 * (`${profile}::${licence}`, `${type}::${name}`, `product.key`, the fixed capability/ops ids, one
 * item per distinct edge detection, one item per distinct non-null endpoint) so that comparing
 * `resolveAnatomyView`'s membership against `buildBands`'s tile ids is a direct set comparison,
 * not a translation between two id schemes.
 */
function selectAnatomyItems(artifact: AnatomyArtifact): ViewItem[] {
  const items: ViewItem[] = [];

  for (const p of artifact.personas) {
    items.push({ kind: 'persona', id: `${p.profile}::${p.licence}` });
  }
  for (const c of artifact.channels) {
    items.push({ kind: 'channel', id: `${c.type}::${c.name}` });
  }
  for (const p of artifact.products) {
    items.push({ kind: 'product', id: p.key });
  }
  for (const id of FIXED_CAPABILITY_TILE_IDS) {
    items.push({ kind: 'capabilityTile', id });
  }
  for (const id of FIXED_OPS_TILE_IDS) {
    items.push({ kind: 'opsTile', id });
  }

  // One item per distinct detection present, mirroring buildIntegrationBand's Map<Detection,
  // number> -- a tile per detection *type*, not per edge.
  const detections = new Set(artifact.edges.map((e) => e.detection));
  for (const detection of detections) {
    items.push({ kind: 'integrationEdge', id: detection, detection });
  }

  // One item per distinct non-null endpoint, mirroring buildExternalBand's Map<string, number>.
  const endpoints = new Set(
    artifact.edges.map((e) => e.endpoint).filter((e): e is string => e !== null),
  );
  for (const endpoint of endpoints) {
    items.push({ kind: 'externalEndpoint', id: endpoint });
  }

  return items;
}

export const ANATOMY_VIEW: ViewSpec = {
  name: 'anatomy',
  selector: selectAnatomyItems,
  bands: [
    { id: 'users', title: 'Users', match: (i) => i.kind === 'persona' },
    { id: 'channels', title: 'Channels', match: (i) => i.kind === 'channel' },
    { id: 'products', title: 'Products', match: (i) => i.kind === 'product' },
    { id: 'capabilities', title: 'Platform Capabilities', match: (i) => i.kind === 'capabilityTile' },
    { id: 'integration', title: 'Integration Methods', match: (i) => i.kind === 'integrationEdge' },
    { id: 'external', title: 'External Systems', match: (i) => i.kind === 'externalEndpoint' },
    { id: 'ops', title: 'Ops and Security', match: (i) => i.kind === 'opsTile' },
  ],
};

export interface ResolvedBand {
  id: BandId;
  /** Item ids matched into this band, sorted for a deterministic, order-independent comparison
   * against `buildBands`'s tile ids. */
  itemIds: string[];
  emptiness: 'populated' | 'empty' | 'not-collected';
  note: string | null;
  caveats: string[];
}

/**
 * Local resolver: not general, and not meant to be. It exists so this task's equivalence test has
 * something to resolve `ANATOMY_VIEW` against -- there is no shared resolver to call yet, and
 * building a general one (over an actual merged `CanonicalGraph`) is the follow-on work the
 * module header describes, not this task.
 *
 * Reuses `classify` from `bands.ts` rather than re-deriving the empty/not-collected rule, so the
 * two can never quietly disagree about which `coverage.unavailable` scopes matter to which band.
 */
export function resolveAnatomyView(spec: ViewSpec, artifact: AnatomyArtifact): ResolvedBand[] {
  const items = spec.selector(artifact);
  return spec.bands.map((band) => {
    const itemIds = items
      .filter(band.match)
      .map((i) => i.id)
      .sort();
    const { emptiness, note, caveats } = classify(band.id, itemIds.length, artifact.coverage.unavailable);
    return { id: band.id, itemIds, emptiness, note, caveats };
  });
}

// src/anatomy/view/bands.ts
// View A: seven fixed bands answering "what is in this org" in one screen. Pure layout data,
// no rendering. See docs/ANATOMY_SPEC.md section 6.
//
// The honesty rule this module exists to carry forward from the collection layer: a band with
// no tiles must say whether that is because the org genuinely has none (`empty`) or because
// this phase never looked (`not-collected`). Collapsing the two into "just don't show the band"
// would silently tell the reader the org has none of that thing.
//
// That classification, and the analogous per-tile one for `capabilities` and `ops`, is driven
// entirely by `coverage.unavailable`, structured data the collectors record for every failed
// read or deliberate deferral (see docs/ANATOMY_SPEC.md section 7). No band inspects
// `coverage.notes`: matching prose is brittle by construction, and a band's honesty must not
// depend on a sentence staying worded exactly one way.
import type { AnatomyArtifact, Detection, Unavailable } from '../types.js';

export type BandId = 'users' | 'channels' | 'products' | 'capabilities' | 'integration' | 'external' | 'ops';

export interface Tile {
  id: string;
  label: string;
  sublabel: string | null;
  /** Drives tile size. Always a measured reading, never a placeholder. */
  metric: number;
  /** 0 to 1 proportion for a filled bar, or null when the tile has no such reading. */
  fill: number | null;
  /**
   * True when `metric` is a stand-in for a failed read, not a measured reading. Only the fixed
   * tiles in `capabilities` and `ops` can carry this: every other tile only exists because its
   * source record was actually collected, so `metric` there is always real. Set from
   * `coverage.unavailable`, never from prose.
   */
  unavailable: boolean;
}

export interface BandContent {
  id: BandId;
  title: string;
  tiles: Tile[];
  /**
   * `populated`: there are tiles.
   * `empty`: the data was collected and the org genuinely has none.
   * `not-collected`: this phase never gathered it, and `note` says so.
   */
  emptiness: 'populated' | 'empty' | 'not-collected';
  note: string | null;
}

const DETECTION_LABELS: Record<Detection, string> = {
  namedCredential: 'Named Credential',
  apexCallout: 'Apex Callout',
  remoteActionChain: 'Remote Action Chain',
  endpointOnly: 'Endpoint Only',
};

/**
 * Which `coverage.unavailable` scopes feed each band, listed exactly rather than by string
 * prefix. Exactness matters: `personas` (the whole-category failure of the active-user query)
 * must mark `users` `not-collected`, but `personas.landingApp` (an unconditional, field-level
 * deferral of one optional field) must not, because `activeUsers`, the metric `users` actually
 * renders, is queried for real on every run. A prefix rule of "starts with personas" cannot
 * express that distinction; an explicit list can, and does, by simply never including
 * `personas.landingApp` here. `channels` has no such asymmetry: `channels.network` and
 * `channels.appConsoleApi` are also unconditional field-level deferrals, but they cover the
 * entire category phase 1 does not collect (three of four channel types, plus the Network
 * join), so an empty `channels` band really is "not checked", not "checked and found none".
 */
const BAND_SCOPES: Record<BandId, readonly string[]> = {
  users: ['personas'],
  channels: ['channels', 'channels.network', 'channels.appConsoleApi'],
  products: ['products.apps', 'products.packages', 'products.recordTypes', 'products.componentNames'],
  capabilities: [],
  integration: ['edges.apexBodies', 'edges.omniStudio', 'edges.namedCredentials', 'edges.remoteProxies'],
  external: ['edges.apexBodies', 'edges.omniStudio', 'edges.namedCredentials', 'edges.remoteProxies'],
  ops: [],
};

function sortByLabel(tiles: Tile[]): Tile[] {
  return [...tiles].sort((a, b) => a.label.localeCompare(b.label));
}

function isUnavailable(unavailable: readonly Unavailable[], scope: string): boolean {
  return unavailable.some((u) => u.scope === scope);
}

function classify(
  id: BandId,
  tiles: Tile[],
  unavailable: readonly Unavailable[],
): { emptiness: BandContent['emptiness']; note: string | null } {
  if (tiles.length > 0) return { emptiness: 'populated', note: null };
  const scopes = BAND_SCOPES[id];
  // `unavailable` arrives pre-sorted by scope from runAnatomy, so picking the first match keeps
  // this deterministic without an extra sort here.
  const match = unavailable.find((u) => scopes.includes(u.scope));
  return match ? { emptiness: 'not-collected', note: match.detail } : { emptiness: 'empty', note: null };
}

function buildUsersBand(artifact: AnatomyArtifact): BandContent {
  const tiles = sortByLabel(
    artifact.personas.map((p) => ({
      id: `${p.profile}::${p.licence}`,
      label: p.profile,
      sublabel: p.licence,
      metric: p.activeUsers,
      // No licence-total figure exists anywhere in the artifact, so a used-of-total bar would
      // have to invent the denominator. Left null until that data is collected.
      fill: null,
      unavailable: false,
    })),
  );
  const { emptiness, note } = classify('users', tiles, artifact.coverage.unavailable);
  return { id: 'users', title: 'Users', tiles, emptiness, note };
}

function buildChannelsBand(artifact: AnatomyArtifact): BandContent {
  const tiles = sortByLabel(
    artifact.channels.map((c) => ({
      id: `${c.type}::${c.name}`,
      label: c.name,
      sublabel: c.type,
      // Each channel is one confirmed surface; there is no further size reading recorded.
      metric: 1,
      fill: null,
      unavailable: false,
    })),
  );
  const { emptiness, note } = classify('channels', tiles, artifact.coverage.unavailable);
  return { id: 'channels', title: 'Channels', tiles, emptiness, note };
}

function buildProductsBand(artifact: AnatomyArtifact): BandContent {
  const tiles = sortByLabel(
    artifact.products.map((p) => ({
      id: p.key,
      label: p.label,
      sublabel: p.source,
      metric: p.componentCount,
      fill: null,
      unavailable: false,
    })),
  );
  const { emptiness, note } = classify('products', tiles, artifact.coverage.unavailable);
  return { id: 'products', title: 'Products', tiles, emptiness, note };
}

function buildCapabilitiesBand(artifact: AnatomyArtifact): BandContent {
  const c = artifact.capabilities;
  const u = artifact.coverage.unavailable;
  // Fixed set, always rendered, per the coverage rule in ANATOMY_SPEC.md section 6: an absent
  // capability is a finding, not an omission. Every one of these counts is attempted on every
  // run (see collectCapabilities). A zero is normally a real reading, except when the read
  // itself failed, in which case `unavailable` says so rather than letting the resulting zero
  // read as a confident count.
  const tiles = sortByLabel([
    { id: 'apexClasses', label: 'Apex Classes', sublabel: null, metric: c.apexClasses, fill: null, unavailable: isUnavailable(u, 'capabilities.apexClasses') },
    { id: 'apexTriggers', label: 'Apex Triggers', sublabel: null, metric: c.apexTriggers, fill: null, unavailable: isUnavailable(u, 'capabilities.apexTriggers') },
    { id: 'flows', label: 'Flows', sublabel: null, metric: c.flows, fill: null, unavailable: isUnavailable(u, 'capabilities.flows') },
    { id: 'lwc', label: 'Lightning Web Components', sublabel: null, metric: c.lwc, fill: null, unavailable: isUnavailable(u, 'capabilities.lwc') },
    { id: 'aura', label: 'Aura Components', sublabel: null, metric: c.aura, fill: null, unavailable: isUnavailable(u, 'capabilities.aura') },
    { id: 'namedCredentials', label: 'Named Credentials', sublabel: null, metric: c.namedCredentials, fill: null, unavailable: isUnavailable(u, 'capabilities.namedCredentials') },
    { id: 'externalDataSources', label: 'External Data Sources', sublabel: null, metric: c.externalDataSources, fill: null, unavailable: isUnavailable(u, 'capabilities.externalDataSources') },
    { id: 'remoteSites', label: 'Remote Site Settings', sublabel: null, metric: c.remoteSites, fill: null, unavailable: isUnavailable(u, 'capabilities.remoteSites') },
  ]);
  const { emptiness, note } = classify('capabilities', tiles, u);
  return { id: 'capabilities', title: 'Platform Capabilities', tiles, emptiness, note };
}

function buildIntegrationBand(artifact: AnatomyArtifact): BandContent {
  const counts = new Map<Detection, number>();
  for (const e of artifact.edges) counts.set(e.detection, (counts.get(e.detection) ?? 0) + 1);
  const tiles = sortByLabel(
    [...counts.entries()].map(([detection, metric]) => ({
      id: detection,
      label: DETECTION_LABELS[detection],
      sublabel: null,
      metric,
      fill: null,
      unavailable: false,
    })),
  );
  const { emptiness, note } = classify('integration', tiles, artifact.coverage.unavailable);
  return { id: 'integration', title: 'Integration Methods', tiles, emptiness, note };
}

function buildExternalBand(artifact: AnatomyArtifact): BandContent {
  const counts = new Map<string, number>();
  for (const e of artifact.edges) {
    if (e.endpoint === null) continue;
    counts.set(e.endpoint, (counts.get(e.endpoint) ?? 0) + 1);
  }
  const tiles = sortByLabel(
    [...counts.entries()].map(([endpoint, metric]) => ({
      id: endpoint,
      label: endpoint,
      sublabel: null,
      metric,
      fill: null,
      unavailable: false,
    })),
  );
  const { emptiness, note } = classify('external', tiles, artifact.coverage.unavailable);
  return { id: 'external', title: 'External Systems', tiles, emptiness, note };
}

function buildOpsBand(artifact: AnatomyArtifact): BandContent {
  const c = artifact.capabilities;
  const u = artifact.coverage.unavailable;
  // Fixed set, always rendered, same rule as `capabilities`: "No Event Relay configured" gets
  // a slot rather than vanishing (ANATOMY_SPEC.md section 6).
  const tiles = sortByLabel([
    { id: 'eventRelay', label: 'Event Relay', sublabel: null, metric: c.eventRelayConfigured ? 1 : 0, fill: null, unavailable: isUnavailable(u, 'capabilities.eventRelayConfigured') },
    { id: 'platformEvents', label: 'Platform Events', sublabel: null, metric: c.platformEvents.length, fill: null, unavailable: isUnavailable(u, 'capabilities.platformEvents') },
    { id: 'changeDataCapture', label: 'Change Data Capture', sublabel: null, metric: c.changeDataCapture.length, fill: null, unavailable: isUnavailable(u, 'capabilities.changeDataCapture') },
  ]);
  const { emptiness, note } = classify('ops', tiles, u);
  return { id: 'ops', title: 'Ops and Security', tiles, emptiness, note };
}

export function buildBands(artifact: AnatomyArtifact): BandContent[] {
  return [
    buildUsersBand(artifact),
    buildChannelsBand(artifact),
    buildProductsBand(artifact),
    buildCapabilitiesBand(artifact),
    buildIntegrationBand(artifact),
    buildExternalBand(artifact),
    buildOpsBand(artifact),
  ];
}

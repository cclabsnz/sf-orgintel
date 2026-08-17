// src/anatomy/view/bands.ts
// View A: seven fixed bands answering "what is in this org" in one screen. Pure layout data,
// no rendering. See docs/ANATOMY_SPEC.md section 6.
//
// The honesty rule this module exists to carry forward from the collection layer: a band with
// no tiles must say whether that is because the org genuinely has none (`empty`) or because
// this phase never looked (`not-collected`). Collapsing the two into "just don't show the band"
// would silently tell the reader the org has none of that thing.
import type { AnatomyArtifact, Detection } from '../types.js';

export type BandId = 'users' | 'channels' | 'products' | 'capabilities' | 'integration' | 'external' | 'ops';

export interface Tile {
  id: string;
  label: string;
  sublabel: string | null;
  /** Drives tile size. Always a measured reading, never a placeholder. */
  metric: number;
  /** 0 to 1 proportion for a filled bar, or null when the tile has no such reading. */
  fill: number | null;
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
 * A band whose tiles came back empty is `not-collected`, rather than `empty`, only when a
 * coverage note says this band's own data was never gathered. Matched against a durable
 * fragment of the note text, never the full sentence, so a reworded note still resolves.
 *
 * Only `channels` is wired up: it is the one band where phase 1 defers the *entire* category
 * (three of four channel types, and the Network join, were never queried; the `site` type
 * collected is a partial view of "channels", not the whole thing). `personas` also carries an
 * unconditional deferral note (`landingApp is not collected in this phase...`), but that note
 * describes one optional field on an otherwise fully-collected record: `activeUsers`, the
 * metric the `users` band actually renders, is queried for real on every run. Wiring that note
 * to the `users` band would mark it `not-collected` on the ordinary case of a query that
 * genuinely found zero active users (or genuinely failed, which already carries its own,
 * separate "Active user counts could not be read" note), misreporting "we looked and found
 * none" as "we never looked" exactly backwards from what this field exists to prevent.
 */
const DEFERRAL_SIGNALS: ReadonlyArray<{ band: BandId; matches: (note: string) => boolean }> = [
  {
    band: 'channels',
    // "channel types" names what collectChannels says it skipped (app, console, api); "not
    // attempted" is its fixed vocabulary for a deliberate deferral (see
    // src/anatomy/collectors/channels.ts). Requiring both fragments together survives a
    // reworded sentence while refusing to match a note that only shares one of the two ideas.
    matches: (note) => /channel types/i.test(note) && /not attempted/i.test(note),
  },
];

function sortByLabel(tiles: Tile[]): Tile[] {
  return [...tiles].sort((a, b) => a.label.localeCompare(b.label));
}

function classify(id: BandId, tiles: Tile[], notes: readonly string[]): { emptiness: BandContent['emptiness']; note: string | null } {
  if (tiles.length > 0) return { emptiness: 'populated', note: null };
  const signal = DEFERRAL_SIGNALS.find((s) => s.band === id);
  const note = signal ? notes.find((n) => signal.matches(n)) ?? null : null;
  return note ? { emptiness: 'not-collected', note } : { emptiness: 'empty', note: null };
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
    })),
  );
  const { emptiness, note } = classify('users', tiles, artifact.coverage.notes);
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
    })),
  );
  const { emptiness, note } = classify('channels', tiles, artifact.coverage.notes);
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
    })),
  );
  const { emptiness, note } = classify('products', tiles, artifact.coverage.notes);
  return { id: 'products', title: 'Products', tiles, emptiness, note };
}

function buildCapabilitiesBand(artifact: AnatomyArtifact): BandContent {
  const c = artifact.capabilities;
  // Fixed set, always rendered, per the coverage rule in ANATOMY_SPEC.md section 6: an absent
  // capability is a finding, not an omission. Every one of these counts is attempted on every
  // run (see collectCapabilities), a zero is a real reading, not a sign the tile was skipped.
  const tiles = sortByLabel([
    { id: 'apexClasses', label: 'Apex Classes', sublabel: null, metric: c.apexClasses, fill: null },
    { id: 'apexTriggers', label: 'Apex Triggers', sublabel: null, metric: c.apexTriggers, fill: null },
    { id: 'flows', label: 'Flows', sublabel: null, metric: c.flows, fill: null },
    { id: 'lwc', label: 'Lightning Web Components', sublabel: null, metric: c.lwc, fill: null },
    { id: 'aura', label: 'Aura Components', sublabel: null, metric: c.aura, fill: null },
    { id: 'namedCredentials', label: 'Named Credentials', sublabel: null, metric: c.namedCredentials, fill: null },
    { id: 'externalDataSources', label: 'External Data Sources', sublabel: null, metric: c.externalDataSources, fill: null },
    { id: 'remoteSites', label: 'Remote Site Settings', sublabel: null, metric: c.remoteSites, fill: null },
  ]);
  const { emptiness, note } = classify('capabilities', tiles, artifact.coverage.notes);
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
    })),
  );
  const { emptiness, note } = classify('integration', tiles, artifact.coverage.notes);
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
    })),
  );
  const { emptiness, note } = classify('external', tiles, artifact.coverage.notes);
  return { id: 'external', title: 'External Systems', tiles, emptiness, note };
}

function buildOpsBand(artifact: AnatomyArtifact): BandContent {
  const c = artifact.capabilities;
  // Fixed set, always rendered, same rule as `capabilities`: "No Event Relay configured" gets
  // a slot rather than vanishing (ANATOMY_SPEC.md section 6).
  const tiles = sortByLabel([
    { id: 'eventRelay', label: 'Event Relay', sublabel: null, metric: c.eventRelayConfigured ? 1 : 0, fill: null },
    { id: 'platformEvents', label: 'Platform Events', sublabel: null, metric: c.platformEvents.length, fill: null },
    { id: 'changeDataCapture', label: 'Change Data Capture', sublabel: null, metric: c.changeDataCapture.length, fill: null },
  ]);
  const { emptiness, note } = classify('ops', tiles, artifact.coverage.notes);
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

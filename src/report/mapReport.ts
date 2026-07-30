import { esc, type Branding } from '@cclabsnz/sf-core';
import type { CouplingGraph, CouplingGraphEdge } from '@cclabsnz/sf-core';
import type { Cluster } from '../map/graph/clusters.js';
import { summariseLayers, crossLayerCoupling, LAYER_DESCRIPTIONS } from '../map/graph/layers.js';
import { extractProcessChains } from '../map/graph/chains.js';
import type { Point } from '../map/graph/layout.js';
import { htmlDocument } from './shell.js';

export interface MapAnchorRow {
  object: string;
  label: string;
  score: number;
}

export interface MapReportInput {
  orgName: string;
  couplingGraph: CouplingGraph;
  clusters: Cluster[];
  layout: Map<string, Point>;
  anchors?: MapAnchorRow[];
  /** Null when unmeasured; the report says so rather than showing a grade. */
  evidenceTier: string | null;
  flowsAnalyzed: number;
  apexClassesAnalyzed: number;
  apexTriggersAnalyzed: number;
  generatedAt: string;
  branding: Branding;
}

const CLUSTER_COLORS = ['#3a5a82', '#7a5c3e', '#4f7a52', '#82406a', '#5a6b8a', '#8a6d1e', '#4a7d7d', '#6a4a8a'];

export function renderMapHtml(input: MapReportInput): string {
  const body = [
    summarySection(input),
    graphSection(input),
    processSection(input.couplingGraph),
    layerSection(input.couplingGraph),
    couplingTableSection(input.couplingGraph.edges),
    anchorSection(input.anchors),
    clusterSection(input.clusters, input.couplingGraph),
  ].join('\n');

  return htmlDocument({
    title: 'Cross-Object Coupling Map',
    subtitle: input.orgName,
    branding: input.branding,
    bodyHtml: body,
    generatedAt: input.generatedAt,
  });
}

function summarySection(i: MapReportInput): string {
  const rows: Array<[string, string]> = [
    ['Evidence tier', i.evidenceTier ?? 'Not measured — run `sf intel probe`'],
    ['Objects', String(i.couplingGraph.nodes.length)],
    ['Coupled pairs', String(i.couplingGraph.edges.length)],
    ['Domains (clusters)', String(i.clusters.length)],
    ['Flows analysed', String(i.flowsAnalyzed)],
    ['Apex classes / triggers', `${i.apexClassesAnalyzed} / ${i.apexTriggersAnalyzed}`],
  ];
  return `<dl class="kv">${rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl>`;
}

function graphSection(i: MapReportInput): string {
  const clusterOf = new Map<string, number>();
  i.clusters.forEach((c, idx) => c.objects.forEach((o) => clusterOf.set(o, idx)));

  const degree = new Map<string, number>();
  for (const e of i.couplingGraph.edges) {
    degree.set(e.from, (degree.get(e.from) ?? 0) + e.weight);
    degree.set(e.to, (degree.get(e.to) ?? 0) + e.weight);
  }

  const laidOut = new Set(i.layout.keys());
  const lines = i.couplingGraph.edges
    .filter((e) => laidOut.has(e.from) && laidOut.has(e.to))
    .map((e) => {
      const a = i.layout.get(e.from)!;
      const b = i.layout.get(e.to)!;
      const w = Math.min(6, 0.6 + e.weight * 0.6);
      return `<line x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" stroke="var(--border)" stroke-width="${w.toFixed(1)}" stroke-opacity="0.7"/>`;
    })
    .join('');

  const nodes = [...i.layout.entries()]
    .map(([obj, p]) => {
      const r = Math.min(26, 8 + (degree.get(obj) ?? 0) * 1.5);
      const color = CLUSTER_COLORS[(clusterOf.get(obj) ?? 0) % CLUSTER_COLORS.length];
      return `<g><circle cx="${p.x}" cy="${p.y}" r="${r.toFixed(1)}" fill="${color}" fill-opacity="0.85"/>` +
        `<text x="${p.x}" y="${(p.y + r + 12).toFixed(1)}" text-anchor="middle" font-size="11" fill="var(--ink)">${esc(obj)}</text></g>`;
    })
    .join('');

  if (i.layout.size === 0) {
    return `<h2>Coupling graph</h2><p class="muted">No coupled objects were found to visualise.</p>`;
  }
  return `<h2>Coupling graph <span class="muted" style="font-size:13px">(top ${i.layout.size} objects)</span></h2>
<svg viewBox="0 0 960 600" width="100%" style="border:1px solid var(--border);border-radius:8px;background:var(--bgAlt)" role="img" aria-label="Cross-object coupling graph">
${lines}
${nodes}
</svg>`;
}

/**
 * Architectural layers and how heavily they couple to one another.
 *
 * The instinct on a real org is to filter identity, logging and metadata objects out of the
 * graph — they are most of it, and none of them carry business process. Doing so deletes the
 * strongest finding the graph contains: on a production org the business layer coupled to the
 * security layer more heavily than to anything except itself, which says the business model is
 * wired into the permission model. Layers keep those objects and make that legible.
 */
/**
 * Candidate business processes, chained from directional couplings.
 *
 * Everything else in this report describes association — these objects are touched together.
 * Only a record-triggered flow or an Apex trigger says *order*: when a Case changes, an
 * Account is updated. Chaining those is the one output here shaped like a process.
 */
function processSection(graph: CouplingGraph): string {
  const chains = extractProcessChains(graph.edges).slice(0, 10);
  const directional = graph.edges.filter((e) => e.direction).length;

  if (chains.length === 0) {
    return `<h2>Candidate processes</h2>
<p class="muted">No directional couplings were found. Process order comes from record-triggered
flows and Apex triggers; without those, the graph shows association only.</p>`;
  }

  const rows = chains
    .map((c) => {
      const steps = c.steps.map((s) => esc(s)).join(' <span class="muted">&rarr;</span> ');
      return `<tr><td>${steps}</td><td class="num">${c.steps.length}</td>` +
        `<td class="num">${c.weight}</td><td>${chip(c.confidence)}</td></tr>`;
    })
    .join('');

  return `<h2>Candidate processes <span class="muted" style="font-size:13px">(from directional automation)</span></h2>
<p class="muted">Order comes only from record-triggered flows and Apex triggers &mdash;
${directional} of ${graph.edges.length} couplings carry it. Undirected couplings are excluded
rather than guessed at, so these are candidates to confirm, not a mined process model.</p>
<table><thead><tr><th>Process</th><th class="num">Steps</th><th class="num">Weight</th><th>Confidence</th></tr></thead>
<tbody>${rows}</tbody></table>`;
}

function layerSection(graph: CouplingGraph): string {
  const objects = graph.nodes.map((n) => n.object);
  if (objects.length === 0) return '';

  const layers = summariseLayers(objects);
  const pairs = crossLayerCoupling(graph.edges).slice(0, 8);
  const heaviest = pairs[0]?.weight ?? 1;

  const layerRows = layers
    .map(
      (l) => `<tr><td><strong>${esc(l.layer)}</strong></td><td class="num">${l.count}</td>` +
        `<td class="muted">${esc(LAYER_DESCRIPTIONS[l.layer])}</td></tr>`,
    )
    .join('');

  const pairRows = pairs
    .map((p) => {
      const label = p.from === p.to ? `${esc(p.from)} (internal)` : `${esc(p.from)} ↔ ${esc(p.to)}`;
      const bar = Math.max(2, Math.round((p.weight / heaviest) * 100));
      return `<tr><td>${label}</td><td class="num">${p.couplings}</td><td class="num">${p.weight}</td>` +
        `<td><span style="display:inline-block;height:7px;width:${bar}%;background:#3c3c3c"></span></td></tr>`;
    })
    .join('');

  return `<h2>Architectural layers</h2>
<p class="muted">Every object is classified, none are hidden. Infrastructure objects carry no
business process but reveal how the business model is wired to identity, logging and configuration.</p>
<table><thead><tr><th>Layer</th><th class="num">Objects</th><th>What it holds</th></tr></thead>
<tbody>${layerRows}</tbody></table>
<h3 style="font-size:15px;margin-top:22px">Cross-layer coupling</h3>
<table><thead><tr><th>Relationship</th><th class="num">Pairs</th><th class="num">Weight</th><th></th></tr></thead>
<tbody>${pairRows}</tbody></table>`;
}

function couplingTableSection(edges: CouplingGraphEdge[]): string {
  const top = edges.slice(0, 25);
  const rows = top
    .map((e) => {
      const conf = e.components.some((c) => c.confidence === 'high') ? 'high' : 'approximate';
      const comps = e.components.map((c) => `${c.type}:${c.name}`).slice(0, 3).join(', ') + (e.components.length > 3 ? ` +${e.components.length - 3}` : '');
      return `<tr><td>${esc(e.from)} ↔ ${esc(e.to)}</td><td class="num">${e.weight}</td><td>${esc(e.operations.join(', '))}</td><td class="muted">${esc(comps)}</td><td>${chip(conf)}</td></tr>`;
    })
    .join('');
  return `<h2>Process backbones <span class="muted" style="font-size:13px">(top coupled object pairs)</span></h2>
<table><thead><tr><th>Object pair</th><th>Weight</th><th>Operations</th><th>Via</th><th>Confidence</th></tr></thead><tbody>${rows}</tbody></table>`;
}

function anchorSection(anchors?: MapAnchorRow[]): string {
  if (!anchors || anchors.length === 0) {
    return `<h2>Process anchors</h2><p class="muted">No cached <code>intel discover</code> results found. Run <code>sf intel discover</code> first to include ranked anchors here.</p>`;
  }
  const rows = anchors
    .slice(0, 10)
    .map((a) => `<tr><td>${esc(a.label)} (${esc(a.object)})</td><td class="num">${a.score.toFixed(3)}</td></tr>`)
    .join('');
  return `<h2>Process anchors <span class="muted" style="font-size:13px">(from cached discover)</span></h2>
<table><thead><tr><th>Object</th><th>Score</th></tr></thead><tbody>${rows}</tbody></table>`;
}

function clusterSection(clusters: Cluster[], graph: CouplingGraph): string {
  const labelOf = new Map(graph.nodes.map((n) => [n.object, n.object]));
  const rows = clusters
    .slice(0, 12)
    .map((c, idx) => {
      const color = CLUSTER_COLORS[idx % CLUSTER_COLORS.length];
      return `<tr><td><span class="chip" style="background:${color};color:#fff">${esc(c.anchorObject)}</span></td><td>${c.objects.length}</td><td class="muted">${esc(c.objects.slice(0, 8).map((o) => labelOf.get(o) ?? o).join(', '))}${c.objects.length > 8 ? ' …' : ''}</td></tr>`;
    })
    .join('');
  return `<h2>Domains</h2>
<table><thead><tr><th>Anchor</th><th>Objects</th><th>Members</th></tr></thead><tbody>${rows}</tbody></table>`;
}

function chip(status: string): string {
  const cls = status === 'high' ? 'full' : 'partial';
  return `<span class="chip ${cls}">${esc(status)}</span>`;
}

import { esc, type Branding } from '@cclabsnz/sf-core';
import type { CouplingGraph, CouplingGraphEdge } from '@cclabsnz/sf-core';
import type { Cluster } from '../map/graph/clusters.js';
import { summariseLayers, crossLayerCoupling, LAYER_DESCRIPTIONS } from '../map/graph/layers.js';
import { extractProcessChains } from '../map/graph/chains.js';
import { summariseCoverage, coverageHeadline, edgeConfidence } from '../map/graph/coverage.js';
import { computeStrataLayout } from '../map/graph/strata.js';
import { renderStrataViewer } from './strataViewer.js';
import { renderExecutionFlow } from './executionFlow.js';
import { layerOf } from '../map/graph/layers.js';
import type { Point } from '../map/graph/layout.js';
import type { ObjectTimeline } from '../map/graph/timeline.js';
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
  /** Per-object save sequences; the only guaranteed ordering in the report. */
  timelines?: readonly ObjectTimeline[];
  anchors?: MapAnchorRow[];
  /** Null when unmeasured; the report says so rather than showing a grade. */
  evidenceTier: string | null;
  /**
   * What the run could not analyse — unreadable managed-package metadata, unqueryable
   * objects, flows that failed to parse. Previously logged to the terminal and lost, which
   * left the HTML silently overstating its own coverage to anyone reading it later.
   */
  notes?: readonly string[];
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
    coverageSection(input),
    graphSection(input),
    renderStrataViewer({ couplingGraph: input.couplingGraph, objects: [...input.layout.keys()] }),
    processSection(input.couplingGraph),
    timelineSection(input.timelines ?? []),
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
    ['Evidence tier', i.evidenceTier ?? 'Not measured: run `sf intel probe`'],
    ['Objects', String(i.couplingGraph.nodes.length)],
    ['Coupled pairs', String(i.couplingGraph.edges.length)],
    ['Domains (clusters)', String(i.clusters.length)],
    ['Flows analysed', String(i.flowsAnalyzed)],
    ['Apex classes / triggers', `${i.apexClassesAnalyzed} / ${i.apexTriggersAnalyzed}`],
  ];
  return `<dl class="kv">${rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl>`;
}

/**
 * Placed second, directly under the summary and above the graph, because it qualifies
 * everything below it. A reader who scrolls past the picture and never reaches a caveat has
 * been misled by the layout, however accurate the caveat is.
 */
function coverageSection(i: MapReportInput): string {
  const s = summariseCoverage(i.couplingGraph);
  const notes = i.notes ?? [];
  const pct = Math.round(s.approximateShare * 100);
  const tone = pct >= 50 ? 'partial' : 'full';

  // The chip carries the same value as the row label. Anything else contradicts it: the
  // first cut mapped every non-exact row to an 'approximate' chip, so the Mixed row read
  // "Mixed … approximate" and told a reader two different things about one number.
  const bars = (
    [
      ['Exact', s.edgesByConfidence.high, 'high'],
      ['Mixed', s.edgesByConfidence.mixed, 'mixed'],
      ['Approximate', s.edgesByConfidence.approximate, 'approximate'],
    ] as Array<[string, number, string]>
  )
    .map(
      ([label, n, status]) =>
        `<tr><td>${esc(label)}</td><td class="num">${n}</td><td class="muted">${
          s.totalEdges === 0 ? '—' : `${Math.round((n / s.totalEdges) * 100)}%`
        }</td><td>${chip(status)}</td></tr>`,
    )
    .join('');

  const notesHtml =
    notes.length === 0
      ? '<p class="muted">Nothing was skipped: every flow and Apex component in scope was analysed.</p>'
      : `<ul>${notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>`;

  return `<h2>Coverage and confidence</h2>
<p class="chip ${tone}" style="display:inline-block">${esc(coverageHeadline(s))}</p>
<p class="muted">Exact evidence means an Apex SymbolTable or parsed Flow XML named the object.
Approximate means it was matched by regex in an Apex body with no SymbolTable. That is a real
signal, but one that can miss references and invent them. An edge counts as exact only when
every contributing component is exact.</p>
<table><thead><tr><th>Coupled pairs by evidence</th><th class="num">Count</th><th>Share</th><th></th></tr></thead>
<tbody>${bars}</tbody></table>
<h3 style="font-size:15px;margin-top:22px">Not analysed</h3>
${notesHtml}`;
}

function graphSection(i: MapReportInput): string {
  const drawn = new Set(i.layout.keys());
  const nodes = i.couplingGraph.nodes
    .filter((n) => drawn.has(n.object))
    .map((n) => ({ object: n.object, layer: n.layer ?? layerOf(n.object) }));

  if (nodes.length === 0) {
    return `<h2>Coupling graph</h2><p class="muted">No coupled objects were found to visualise.</p>`;
  }

  const edges = i.couplingGraph.edges.filter((e) => drawn.has(e.from) && drawn.has(e.to));
  const strata = computeStrataLayout(nodes, edges, { width: 1000, height: 620 });
  const maxWeight = Math.max(...edges.map((e) => e.weight), 1);
  const r = (n: number): number => Math.round(n * 10) / 10;

  const bandHeight = (strata.height - 88) / strata.bands.length;
  const bands = strata.bands
    .map((b, idx) => {
      const y = 44 + bandHeight * idx;
      return `<rect x="0" y="${r(y)}" width="${strata.width}" height="${r(bandHeight)}" fill="${idx % 2 ? '#efece5' : '#f4f1ea'}"/>` +
        `<text x="10" y="${r(y + 15)}" font-size="10" fill="#7a766d" letter-spacing="1.2">${esc(b.layer.toUpperCase())} &middot; ${b.count}</text>`;
    })
    .join('');

  const wires = edges
    .map((e) => {
      const a = strata.positions.get(e.from)!;
      const b = strata.positions.get(e.to)!;
      const mid = (a.y + b.y) / 2;
      const d = Math.abs(a.y - b.y) < 1
        ? `M ${a.x} ${a.y} Q ${r((a.x + b.x) / 2)} ${r(a.y - 26)} ${b.x} ${b.y}`
        : `M ${a.x} ${a.y} C ${a.x} ${r(mid)} ${b.x} ${r(mid)} ${b.x} ${b.y}`;
      return `<path d="${d}" fill="none" stroke="#8d8880" stroke-width="${r(0.4 + (e.weight / maxWeight) * 2.4)}" opacity="0.5"/>`;
    })
    .join('');

  const marks = nodes
    .map((n) => {
      const p2 = strata.positions.get(n.object)!;
      return `<rect x="${r(p2.x - 4)}" y="${r(p2.y - 4)}" width="8" height="8" fill="#4a4a4a"/>` +
        `<text x="${r(p2.x + 2)}" y="${r(p2.y - 9)}" font-size="8" fill="#2b2823" ` +
        `transform="rotate(-32 ${r(p2.x + 2)} ${r(p2.y - 9)})">${esc(n.object)}</text>`;
    })
    .join('');

  return `<h2>Coupling graph <span class="muted" style="font-size:13px">(top ${nodes.length} objects, by layer)</span></h2>
<p class="muted">Each band is an architectural layer: vertical position is the layer, horizontal
position is chosen to reduce crossings, and line thickness is coupling weight.</p>
<div style="border:1px solid var(--rule);background:#f4f1ea">
<svg viewBox="0 0 ${strata.width} ${strata.height}" style="display:block;width:100%;height:auto">
${bands}${wires}${marks}
</svg></div>`;
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

/**
 * What runs when a record saves, in the order the platform runs it.
 *
 * Every other sequence in this report is inferred from evidence and labelled as a candidate. This
 * one is not: Salesforce documents the order of execution and guarantees it, so the ladder below
 * is what happens, not what probably happens. The distinction is worth making loudly, because a
 * reader has no way to tell a guaranteed sequence from an inferred one by looking at it.
 *
 * Where the platform guarantees nothing — two automations in the same phase on the same object —
 * that is called out rather than hidden behind an arbitrary order.
 */
function timelineSection(timelines: readonly ObjectTimeline[]): string {
  if (timelines.length === 0) {
    return `<h2>Order of execution</h2>
<p class="muted">No record-triggered automation was found, so no object has a save sequence.</p>`;
  }

  const shown = timelines.slice(0, 12);
  const contended = timelines.filter((t) => t.unorderedPhases > 0).length;

  // Drawn as a flow rather than tabulated. A table states the same facts, but a reader has to
  // already know the order of execution to see that the rows are a sequence at all.
  const flows = shown
    .map(
      (t) =>
        `<h3 style="margin-bottom:6px">${esc(t.object)} <span class="muted" style="font-size:13px">` +
        `(${t.componentCount} automations, ${t.entries.length} phases` +
        `${t.unorderedPhases > 0 ? `, ${t.unorderedPhases} unordered` : ''})</span></h3>
<div style="border:1px solid var(--rule);background:#f4f1ea;margin-bottom:26px">
${renderExecutionFlow(t)}
</div>`,
    )
    .join('\n');

  const more = timelines.length > shown.length
    ? `<p class="muted">${timelines.length - shown.length} further object(s) with automation are not shown.</p>`
    : '';

  return `<h2>Order of execution <span class="muted" style="font-size:13px">(guaranteed by the platform)</span></h2>
<p class="muted">Unlike the candidate processes above, this sequence is not inferred. Salesforce
documents the order of execution and runs every save through it, so these steps happen in this
order every time. Each stage flows into the next. ${contended} of ${timelines.length} object(s)
run more than one automation inside a single stage, where the platform defines no order between
them at all &mdash; those stages are bracketed in amber.</p>
${flows}
${more}`;
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
      const conf = edgeConfidence(e);
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

import type { CouplingGraph } from '@cclabsnz/sf-core';
import { computeStrataLayout } from '../map/graph/strata.js';
import { layerOf, LAYER_DESCRIPTIONS } from '../map/graph/layers.js';

export interface StrataViewerInput {
  couplingGraph: CouplingGraph;
  /** Objects to include; the full graph is usually too dense to draw at once. */
  objects: string[];
}

const WIDTH = 1100;
const HEIGHT = 660;

/**
 * An interactive, pan-and-zoom view of the layered coupling graph.
 *
 * The static picture answers "what shape is this org"; it cannot answer "what is this object
 * connected to", which is the question a reader actually arrives with. Scroll zooms, drag pans,
 * and clicking an object isolates its couplings.
 *
 * Zoom is *semantic*: zooming out removes detail rather than shrinking it, because drawing
 * every object at every scale is exactly what made the flat graph a cloud. The tier logic lives
 * in `detailAt` and is unit-tested; only pan, zoom and selection plumbing is here.
 *
 * Everything is inlined — no script src, no stylesheet link, no fetch. A report carries
 * sensitive findings and is routinely opened offline, and the network-egress invariant fails
 * the build if that ever stops being true.
 */
/** JSON for embedding in a `<script>` element: identical to `JSON.stringify` but `<`-safe. */
function jsonForScript(value: unknown): string {
  return JSON.stringify(value).replace(/</g, '\\u003c');
}

export function renderStrataViewer(input: StrataViewerInput): string {
  const included = new Set(input.objects);
  const nodes = input.couplingGraph.nodes
    .filter((n) => included.has(n.object))
    .map((n) => ({ object: n.object, layer: n.layer ?? layerOf(n.object) }));

  if (nodes.length === 0) return '';

  const edges = input.couplingGraph.edges
    .filter((e) => included.has(e.from) && included.has(e.to))
    .map((e) => ({ from: e.from, to: e.to, weight: e.weight, direction: e.direction ?? null }));

  const layout = computeStrataLayout(nodes, edges, { width: WIDTH, height: HEIGHT });

  const degree = new Map<string, number>();
  for (const e of edges) {
    degree.set(e.from, (degree.get(e.from) ?? 0) + 1);
    degree.set(e.to, (degree.get(e.to) ?? 0) + 1);
  }

  // `<` is escaped to its JSON unicode form on the way out. The payload sits inside
  // `<script type="application/json">`, and the HTML parser looks for `</script` in that
  // element's text without caring that the text is JSON: a value containing one would close
  // the element early and hand the rest of the payload to the HTML parser as markup, in a
  // file whose whole purpose is to be sent to a client. `JSON.stringify` escapes neither `<`
  // nor `/`, so it cannot prevent that on its own.
  //
  // No Salesforce API name can contain `<` today, so nothing here is currently reachable.
  // This is the guard rather than the cure: it has to hold for whichever field is added to
  // the payload next, and `\u003c` is a valid JSON escape for `<`, so the browser's
  // `JSON.parse` still returns the original string byte for byte.
  const payload = jsonForScript({
    width: layout.width,
    height: layout.height,
    bands: layout.bands.map((b) => ({ ...b, description: LAYER_DESCRIPTIONS[b.layer] })),
    nodes: nodes.map((n) => ({
      object: n.object,
      layer: n.layer,
      degree: degree.get(n.object) ?? 0,
      x: layout.positions.get(n.object)!.x,
      y: layout.positions.get(n.object)!.y,
    })),
    edges,
  });


  return `<h2>Explore <span class="muted" style="font-size:13px">(scroll to zoom, drag to pan, click an object)</span></h2>
<p class="muted">Zooming changes what is shown, not just how big it is: layers and their sizes
when zoomed out, the most connected objects in the middle, every object and label when zoomed
in. Click an object to isolate what it couples to.</p>
<div class="viewer" data-orgintel-viewer>
  <div class="viewer-bar">
    <span class="viewer-tier" data-tier>layers and their sizes</span>
    <span class="viewer-legend">
      <span class="k k-out"></span>flows out
      <span class="k k-in"></span>flows in
      <span class="k k-undir"></span>order unknown
    </span>
    <span class="viewer-sel muted" data-selection>nothing selected</span>
    <button type="button" data-reset>Reset</button>
  </div>
  <svg viewBox="0 0 ${WIDTH} ${HEIGHT}" data-canvas>
    <defs>
      <marker id="oi-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7"
              orient="auto-start-reverse" markerUnits="userSpaceOnUse">
        <path d="M0,0 L8,4 L0,8 z" fill="#6e6a63"/>
      </marker>
      <marker id="oi-arrow-out" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="8" markerHeight="8"
              orient="auto-start-reverse" markerUnits="userSpaceOnUse">
        <path d="M0,0 L8,4 L0,8 z" fill="#b3261e"/>
      </marker>
      <marker id="oi-arrow-in" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="8" markerHeight="8"
              orient="auto-start-reverse" markerUnits="userSpaceOnUse">
        <path d="M0,0 L8,4 L0,8 z" fill="#1d6fa5"/>
      </marker>
    </defs>
    <g data-scene></g>
  </svg>
  <script type="application/json" data-strata>${payload}</script>
</div>
<style>
.viewer { border:1px solid var(--rule); background:#f4f1ea; }
.viewer svg { display:block; width:100%; height:auto; cursor:grab; touch-action:none; }
.viewer svg.dragging { cursor:grabbing; }
.viewer-bar { display:flex; align-items:center; gap:14px; padding:7px 12px; background:#e6e2da;
  border-bottom:1px solid var(--rule); font-size:11px; letter-spacing:.08em; text-transform:uppercase; }
.viewer-tier { font-weight:600; }
.viewer-sel { margin-left:auto; text-transform:none; letter-spacing:0; }
.viewer button { font:inherit; text-transform:uppercase; letter-spacing:.08em; padding:3px 10px;
  border:1px solid #9a968e; background:#f4f1ea; cursor:pointer; }
.viewer button:hover { background:#fff; }
.v-band { fill:#efece5; }
.v-band.alt { fill:#f4f1ea; }
.v-bandlabel { font-size:10px; fill:#7a766d; letter-spacing:1.2px; }
.v-edge { fill:none; stroke:#8d8880; opacity:.45; transition:opacity .14s cubic-bezier(.7,0,.2,1); }
.v-edge.dim { opacity:.05; }
.v-edge.on { stroke:#b3261e; opacity:.95; }
.v-edge.out { stroke:#b3261e; opacity:.95; }
.v-edge.in { stroke:#1d6fa5; opacity:.95; }
.v-edge.undirected { stroke-dasharray:3 3; }
.viewer-legend { display:flex; align-items:center; gap:6px; text-transform:none; letter-spacing:0; color:#5e5a53; }
.viewer-legend .k { display:inline-block; width:14px; height:0; border-top:2px solid; margin-left:10px; }
.viewer-legend .k-out { border-color:#b3261e; }
.viewer-legend .k-in { border-color:#1d6fa5; }
.viewer-legend .k-undir { border-color:#8d8880; border-top-style:dashed; }
.v-node { fill:#4a4a4a; transition:fill .14s cubic-bezier(.7,0,.2,1), opacity .14s cubic-bezier(.7,0,.2,1); cursor:pointer; }
.v-node.dim { opacity:.2; }
.v-node.sel { fill:#f2c200; stroke:#111; stroke-width:1.5; }
.v-label { font-size:8px; fill:#2b2823; pointer-events:none; }
.v-label.dim { opacity:.15; }
@media (prefers-reduced-motion: reduce) { .v-edge, .v-node { transition:none; } }
</style>
<script>${viewerScript()}</script>`;
}

/** Vanilla, dependency-free, and inlined — a CDN import would fail the egress invariant. */
function viewerScript(): string {
  return `
(function () {
  var root = document.querySelector('[data-orgintel-viewer]');
  if (!root) return;
  var data = JSON.parse(root.querySelector('[data-strata]').textContent);
  var svg = root.querySelector('[data-canvas]');
  var scene = root.querySelector('[data-scene]');
  var tierEl = root.querySelector('[data-tier]');
  var selEl = root.querySelector('[data-selection]');

  var LANDSCAPE_BELOW = 0.7, OBJECTS_ABOVE = 1.8;
  var TIERS = { landscape: 'layers and their sizes', domains: 'the most connected objects', objects: 'every object, labelled' };
  var view = { zoom: 1, x: 0, y: 0 }, selected = null;

  var ranked = data.nodes.slice().sort(function (a, b) {
    return b.degree - a.degree || (a.object < b.object ? -1 : 1);
  });

  function detail(zoom) {
    if (zoom < LANDSCAPE_BELOW) return { tier: 'landscape', keep: 0, labels: false, edges: false };
    if (zoom < OBJECTS_ABOVE) {
      var span = (zoom - LANDSCAPE_BELOW) / (OBJECTS_ABOVE - LANDSCAPE_BELOW);
      return { tier: 'domains', keep: Math.max(1, Math.round(ranked.length * (0.25 + 0.55 * span))), labels: false, edges: true };
    }
    return { tier: 'objects', keep: ranked.length, labels: true, edges: true };
  }

  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) {
    return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]; }); }

  function render() {
    var d = detail(view.zoom);
    var shown = {};
    ranked.slice(0, d.keep).forEach(function (n) { shown[n.object] = true; });
    if (selected) shown[selected] = true;

    var neighbours = {};
    if (selected) {
      data.edges.forEach(function (e) {
        if (e.from === selected) neighbours[e.to] = true;
        if (e.to === selected) neighbours[e.from] = true;
      });
      Object.keys(neighbours).forEach(function (k) { shown[k] = true; });
    }

    var bandH = (data.height - 88) / data.bands.length, parts = [];
    data.bands.forEach(function (b, i) {
      var y = 44 + bandH * i;
      parts.push('<rect class="v-band' + (i % 2 ? ' alt' : '') + '" x="0" y="' + y + '" width="' + data.width + '" height="' + bandH + '"/>');
      parts.push('<text class="v-bandlabel" x="10" y="' + (y + 15) + '">' + esc(b.layer.toUpperCase()) + ' \\u00b7 ' + b.count + '</text>');
    });

    var pos = {};
    data.nodes.forEach(function (n) { pos[n.object] = n; });
    var maxW = data.edges.reduce(function (m, e) { return Math.max(m, e.weight); }, 1);

    if (d.edges) {
      data.edges.forEach(function (e) {
        if (!shown[e.from] || !shown[e.to]) return;
        // Draw along the direction the process actually runs, so the arrowhead means something.
        var srcName = e.direction === 'to-from' ? e.to : e.from;
        var dstName = e.direction === 'to-from' ? e.from : e.to;
        var a = pos[srcName], b = pos[dstName];
        var cls = 'v-edge', marker = '';
        if (selected) {
          if (srcName === selected && e.direction) { cls += ' out'; marker = 'url(#oi-arrow-out)'; }
          else if (dstName === selected && e.direction) { cls += ' in'; marker = 'url(#oi-arrow-in)'; }
          else if (e.from === selected || e.to === selected) { cls += ' on'; }
          else { cls += ' dim'; }
        } else if (e.direction) {
          marker = 'url(#oi-arrow)';
        }
        if (!e.direction) cls += ' undirected';
        var mid = (a.y + b.y) / 2;
        var path = Math.abs(a.y - b.y) < 1
          ? 'M ' + a.x + ' ' + a.y + ' Q ' + ((a.x + b.x) / 2) + ' ' + (a.y - 26) + ' ' + b.x + ' ' + b.y
          : 'M ' + a.x + ' ' + a.y + ' C ' + a.x + ' ' + mid + ' ' + b.x + ' ' + mid + ' ' + b.x + ' ' + b.y;
        parts.push('<path class="' + cls + '" d="' + path + '" stroke-width="' +
          (0.4 + (e.weight / maxW) * 2.4) + '"' +
          (marker ? ' marker-end="' + marker + '"' : '') +
          (e.direction === 'both' && marker ? ' marker-start="' + marker + '"' : '') + '/>');
      });
    }

    data.nodes.forEach(function (n) {
      if (!shown[n.object]) return;
      var dim = selected && n.object !== selected && !neighbours[n.object];
      var s = n.object === selected ? 11 : 8;
      parts.push('<rect class="v-node' + (n.object === selected ? ' sel' : dim ? ' dim' : '') +
        '" x="' + (n.x - s / 2) + '" y="' + (n.y - s / 2) + '" width="' + s + '" height="' + s +
        '" data-object="' + esc(n.object) + '"><title>' + esc(n.object) + ' \\u2014 ' + n.degree + ' couplings</title></rect>');
      if (d.labels || n.object === selected) {
        parts.push('<text class="v-label' + (dim ? ' dim' : '') + '" x="' + (n.x + 2) + '" y="' + (n.y - 9) +
          '" transform="rotate(-32 ' + (n.x + 2) + ' ' + (n.y - 9) + ')">' + esc(n.object) + '</text>');
      }
    });

    scene.innerHTML = parts.join('');
    scene.setAttribute('transform', 'translate(' + view.x + ' ' + view.y + ') scale(' + view.zoom + ')');
    tierEl.textContent = TIERS[d.tier];
    if (selected) {
      var into = 0, outOf = 0, undir = 0;
      data.edges.forEach(function (e) {
        if (e.from !== selected && e.to !== selected) return;
        if (!e.direction) { undir++; return; }
        var src = e.direction === 'to-from' ? e.to : e.from;
        if (e.direction === 'both') { into++; outOf++; }
        else if (src === selected) outOf++;
        else into++;
      });
      selEl.textContent = selected + ' \\u2014 ' + outOf + ' out, ' + into + ' in, ' + undir + ' unordered';
    } else {
      selEl.textContent = 'nothing selected';
    }
  }

  // A collapsed or not-yet-laid-out element reports a zero-width rect; dividing by it yields
  // Infinity and every subsequent coordinate becomes NaN, silently breaking pan for the rest
  // of the session. Fall back to 1:1 rather than propagating that.
  function unitScale() {
    var rect = svg.getBoundingClientRect();
    return rect.width > 0 ? data.width / rect.width : 1;
  }

  svg.addEventListener('wheel', function (ev) {
    ev.preventDefault();
    var rect = svg.getBoundingClientRect();
    var scale = unitScale();
    var px = (ev.clientX - rect.left) * scale, py = (ev.clientY - rect.top) * scale;
    var factor = Math.exp(-ev.deltaY * 0.0015);
    var next = Math.min(6, Math.max(0.3, view.zoom * factor));
    // Keep the point under the cursor fixed, so zoom feels anchored rather than arbitrary.
    view.x = px - (px - view.x) * (next / view.zoom);
    view.y = py - (py - view.y) * (next / view.zoom);
    view.zoom = next;
    if (!isFinite(view.x) || !isFinite(view.y)) { view.x = 0; view.y = 0; }
    render();
  }, { passive: false });

  var drag = null;
  svg.addEventListener('pointerdown', function (ev) {
    // Capture the hit element now. Once setPointerCapture is called every later pointer event
    // is retargeted at the capturing element, so reading ev.target on pointerup would always
    // give the svg and selection could never work.
    var hit = ev.target && ev.target.closest ? ev.target.closest('[data-object]') : null;
    drag = {
      x: ev.clientX, y: ev.clientY, vx: view.x, vy: view.y, moved: false,
      hit: hit ? hit.getAttribute('data-object') : null,
    };
    svg.classList.add('dragging');
    svg.setPointerCapture(ev.pointerId);
  });
  svg.addEventListener('pointermove', function (ev) {
    if (!drag) return;
    var scale = unitScale();
    var dx = (ev.clientX - drag.x) * scale, dy = (ev.clientY - drag.y) * scale;
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) drag.moved = true;
    view.x = drag.vx + dx; view.y = drag.vy + dy;
    scene.setAttribute('transform', 'translate(' + view.x + ' ' + view.y + ') scale(' + view.zoom + ')');
  });
  function endDrag() { svg.classList.remove('dragging'); drag = null; }
  svg.addEventListener('pointerup', function () {
    var wasDrag = drag && drag.moved;
    var name = drag ? drag.hit : null;
    endDrag();
    // A drag that happens to end over an object is a pan, not a selection.
    if (wasDrag) return;
    selected = name && name !== selected ? name : null;
    render();
  });
  svg.addEventListener('pointercancel', endDrag);

  root.querySelector('[data-reset]').addEventListener('click', function () {
    view = { zoom: 1, x: 0, y: 0 }; selected = null; render();
  });

  render();
})();
`;
}

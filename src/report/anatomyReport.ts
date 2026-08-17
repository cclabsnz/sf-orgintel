// src/report/anatomyReport.ts
// View A: the seven-band layer map, rendered as inline SVG inside the shared report shell.
// See docs/ANATOMY_SPEC.md section 6.
//
// This module holds markup only. What goes in a band is bands.ts, where the tiles sit is
// bandLayout.ts, and neither of those needs an org or a browser to be tested. The split is the
// reason the honesty rules below can be asserted as data long before anyone looks at a picture.
//
// Three rules the drawing must not break:
//
//  1. The coverage section renders above the drawing, never below it. A reader who scrolls past
//     a picture and never reaches the caveat has been misled by the layout, however accurate the
//     caveat is. Same rule, same reason, as mapReport.ts.
//  2. An empty band and a never-collected band render differently, in words. "None found" and
//     "Not collected" are opposite claims, and a blank row asserts the first while meaning the
//     second.
//  3. A tile whose count could not be read is hatched and labelled "not read" rather than drawn
//     with its placeholder 0. Every other tile's number is a measured reading.
//
// Everything that came from the org is escaped. Product keys, persona profiles, channel names
// and endpoints are all customer-controlled strings on their way into markup.
import { esc, type Branding } from '@cclabsnz/sf-core';
import type { AnatomyArtifact } from '../anatomy/types.js';
import { buildBands, type Tile } from '../anatomy/view/bands.js';
import { layoutBands, type PlacedBand } from '../anatomy/view/bandLayout.js';
import { htmlDocument } from './shell.js';

export interface AnatomyReportInput {
  orgName: string;
  artifact: AnatomyArtifact;
  generatedAt: string;
  branding: Branding;
}

/** One decimal place, matching mapReport.ts and bandLayout.ts, so the same artifact yields the same bytes. */
const r = (n: number): number => Math.round(n * 10) / 10;

/**
 * The neutral ramp for tile fill. Cadmium is reserved for selection and there is no selection in
 * View A, so it appears nowhere here. Fill re-encodes the metric the tile's width already
 * carries, which is the brief's rule: one reading, more than one encoding.
 *
 * These are the light half of DESIGN_BRIEF.md's graphite ramp rather than its full range. The
 * full range was tried first and read badly on a real org's proportions: `edges` and `products`
 * put most of their tiles near the band maximum, so most of the drawing came out as black slabs
 * with reversed text, which is a dark HUD, the one thing the brief says this is not. Keeping to
 * the light half holds the ranking, keeps every label ink-on-light, and leaves the page a
 * daylight object.
 */
const RAMP = ['#E7E3DA', '#D9D3C7', '#C8C1B1', '#B4AC9A'];
/** Band grounds, alternating, as in the map report's strata drawing. */
const BAND_FILLS = ['#f4f1ea', '#efece5'];
const INK = '#2b2823';
const DIM = '#7a766d';
const RULE = '#a49c8e';

const LABEL_SIZE = 11;
const SUB_SIZE = 9.5;
/** Rough advance width per character at LABEL_SIZE, used only to decide where to truncate. */
const LABEL_CHAR_W = 6.2;
const SUB_CHAR_W = 5.2;

export function renderAnatomyHtml(input: AnatomyReportInput): string {
  const body = [
    summarySection(input),
    coverageSection(input.artifact),
    bandsSection(input.artifact),
    identitySection(input.artifact),
  ].join('\n');

  return htmlDocument({
    title: 'Org Anatomy',
    subtitle: input.orgName,
    branding: input.branding,
    bodyHtml: body,
    generatedAt: input.generatedAt,
  });
}

function summarySection(i: AnatomyReportInput): string {
  const a = i.artifact;
  const endpoints = new Set(a.edges.filter((e) => e.endpoint !== null).map((e) => e.endpoint));
  const unattributed = a.edges.filter((e) => e.attribution === 'unattributed').length;
  const rows: Array<[string, string]> = [
    ['Org ID', a.provenance.orgId],
    ['API version', a.provenance.apiVersion],
    ['Products', String(a.products.length)],
    ['Personas (profile / licence)', String(a.personas.length)],
    ['Channels', String(a.channels.length)],
    ['Integration edges', String(a.edges.length)],
    ['External endpoints', String(endpoints.size)],
    [
      'Edges with no owner established',
      a.edges.length === 0 ? '0' : `${unattributed} of ${a.edges.length}`,
    ],
  ];
  return `<dl class="kv">${rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl>
<p class="muted">Every figure below is a count of records this run actually read. Where a read was
deferred or refused, the affected band or tile says so rather than showing a zero, and the same
gap is listed under coverage.</p>`;
}

/**
 * What was read, what was not, and why. Placed above the drawing because it qualifies it.
 *
 * `unavailable` is the load-bearing part: prefix resolution runs at roughly half on real orgs,
 * and a band that says "not collected" here is the only thing standing between a reader and the
 * conclusion that the org has none of that thing.
 */
function coverageSection(a: AnatomyArtifact): string {
  const c = a.coverage;
  const rows: Array<[string, string]> = [
    ['Apex bodies scanned', `${c.apexBodiesScanned} scanned, ${c.apexBodiesUnreadable} unreadable`],
    ['OmniStudio elements scanned', String(c.omniElementsScanned)],
    ['Integration Procedures involved', String(c.omniProceduresWithIntegrationElements)],
    ['Elements on superseded versions, skipped', String(c.omniElementsSkippedSuperseded)],
    [
      'Prefixes that resolved to no product',
      c.prefixesUnresolved.length === 0 ? 'none' : `${c.prefixesUnresolved.length}: ${c.prefixesUnresolved.join(', ')}`,
    ],
  ];

  const unavailable =
    c.unavailable.length === 0
      ? '<p class="muted">Nothing was deferred and no read was refused: every collector returned what it went for.</p>'
      : `<table><thead><tr><th>What</th><th>Why</th><th>Detail</th></tr></thead><tbody>${c.unavailable
          .map(
            (u) =>
              `<tr><td><code>${esc(u.scope)}</code></td><td>${chip(u.reason)}</td>` +
              `<td class="muted">${esc(u.detail)}</td></tr>`,
          )
          .join('')}</tbody></table>`;

  const notes =
    c.notes.length === 0
      ? ''
      : `<h3 style="font-size:15px;margin-top:22px">Notes</h3><ul>${c.notes
          .map((n) => `<li>${esc(n)}</li>`)
          .join('')}</ul>`;

  return `<h2>Coverage and limits</h2>
<p class="muted">Read-only, and from metadata alone. Nothing here is inferred from a sample: a
number is either a count of records read or it is marked as unavailable below.</p>
<table><thead><tr><th>Reading</th><th>Value</th></tr></thead>
<tbody>${rows.map(([k, v]) => `<tr><td>${esc(k)}</td><td class="muted">${esc(v)}</td></tr>`).join('')}</tbody></table>
<h3 style="font-size:15px;margin-top:22px">Not collected</h3>
<p class="muted"><strong>deferred</strong> means this phase never gathers it.
<strong>failed</strong> means the read was attempted and refused or errored. A band or tile
carrying either is not a measured zero.</p>
${unavailable}
${notes}`;
}

function bandsSection(a: AnatomyArtifact): string {
  const layout = layoutBands(buildBands(a));
  const bands = layout.bands.map((b, idx) => renderBand(b, idx, layout.width)).join('');

  return `<h2>What is in this org <span class="muted" style="font-size:13px">(seven bands, top to bottom)</span></h2>
<p class="muted">Each tile is one thing the run found, sized and shaded by its own count: wider and
darker is more. A hatched tile is one whose count could not be read, and its number is withheld
rather than shown as zero. Bands are never merged, reordered or dropped, so an empty row is an
empty band and not a missing one.</p>
<div style="border:1px solid var(--border);background:#f4f1ea">
<svg viewBox="0 0 ${layout.width} ${r(layout.height)}" style="display:block;width:100%;height:auto">
<defs><pattern id="anatomyUnread" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
<rect width="6" height="6" fill="#efece5"/><line x1="0" y1="0" x2="0" y2="6" stroke="#b8b3a9" stroke-width="2"/></pattern></defs>
${bands}
</svg></div>`;
}

function renderBand(b: PlacedBand, idx: number, width: number): string {
  const ground = `<rect x="0" y="${b.y}" width="${width}" height="${b.height}" fill="${BAND_FILLS[idx % BAND_FILLS.length]}"/>`;
  // Titles keep their given case. The map report's strata labels are upper-cased because they
  // are single enum tokens; these are prose ("Platform Capabilities"), and shouting them costs
  // legibility without buying the instrument-label effect.
  const heading =
    `<text x="16" y="${r(b.y + 17)}" font-size="10.5" font-weight="600" fill="${DIM}" letter-spacing="0.6">` +
    `${esc(b.title)} &middot; ${b.tiles.length}</text>`;

  // The status word is the whole point of `emptiness`, so it is written out rather than encoded
  // in a shade a reader would have to decode. Blank means "we looked and found none" to nobody.
  //
  // Truncated to the canvas like every other string here, and for a sharper reason: a `failed`
  // entry's detail carries the underlying platform error verbatim, which is routinely longer
  // than the drawing is wide, and SVG text neither wraps nor clips. The untruncated text is a
  // hover away in the `<title>`, and already printed in full in the coverage table above.
  const statusText =
    b.emptiness === 'empty'
      ? 'None found. This band was collected and the org has none.'
      : `Not collected. ${b.note ?? 'This phase does not gather it.'}`;
  const status =
    b.emptiness === 'populated'
      ? ''
      : `<text x="16" y="${r(b.y + 44)}" font-size="11" fill="${DIM}">` +
        `${esc(truncate(statusText, width - 32, LABEL_CHAR_W))}<title>${esc(statusText)}</title></text>`;

  const maxMetric = b.tiles.reduce((m, t) => Math.max(m, t.tile.metric), 0);
  const minMetric = b.tiles.reduce((m, t) => Math.min(m, t.tile.metric), maxMetric);
  // A band whose readings are all the same has no ranking to show, and shading it by ratio would
  // paint every tile at the top of the ramp: `channels` scores every surface 1, so a two-site org
  // came out as two of the heaviest tiles on the page. Flat means flat.
  const uniform = maxMetric === minMetric;
  const tiles = b.tiles.map((p) => renderTile(p.tile, p.x, p.y, p.w, p.h, uniform ? 0 : maxMetric)).join('');

  return ground + heading + status + tiles;
}

function renderTile(tile: Tile, x: number, y: number, w: number, h: number, maxMetric: number): string {
  // Same square root as the width scale in bandLayout.ts, so shade and width tell one story.
  const ratio = maxMetric > 0 ? Math.sqrt(Math.max(0, tile.metric) / maxMetric) : 0;
  const shade = RAMP[Math.min(RAMP.length - 1, Math.floor(ratio * RAMP.length))];

  const face = tile.unavailable
    ? `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="url(#anatomyUnread)" stroke="${RULE}"/>`
    : `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${shade}" stroke="${RULE}"/>`;

  // A tile whose count failed to read shows the words, not the placeholder zero it fell back to.
  const value = tile.unavailable ? 'not read' : String(tile.metric);

  // The label owns the first line outright and the readout sits under it. Sharing one line was
  // the first cut, and on a narrow tile the readout took enough of the width that the label
  // truncated to nothing: the not-read tile rendered as "not read" with no clue what had not
  // been read. The reading is still the loudest thing in the tile, just below the name of it.
  const label = `<text x="${r(x + 7)}" y="${r(y + 17)}" font-size="${LABEL_SIZE}" fill="${INK}">` +
    `${esc(truncate(tile.label, w - 14, LABEL_CHAR_W))}</text>`;

  const readout = `<text x="${r(x + w - 7)}" y="${r(y + 31)}" font-size="${tile.unavailable ? 10 : 13}" ` +
    `font-weight="${tile.unavailable ? 400 : 600}" fill="${tile.unavailable ? DIM : INK}" text-anchor="end" ` +
    `style="font-variant-numeric:tabular-nums">${esc(value)}</text>`;

  // Sublabel shares line two with the readout, so it gives up the readout's share of the width.
  const sublabel = tile.sublabel === null
    ? ''
    : `<text x="${r(x + 7)}" y="${r(y + 31)}" font-size="${SUB_SIZE}" fill="${DIM}">` +
      `${esc(truncate(tile.sublabel, w - 14 - (value.length * 8 + 10), SUB_CHAR_W))}</text>`;

  // The filled bar for a proportional reading. No tile carries one yet: no licence-total figure
  // is collected, and inventing the denominator is exactly what this report must not do.
  const bar = tile.fill === null
    ? ''
    : `<rect x="${r(x + 7)}" y="${r(y + h - 7)}" width="${r(w - 14)}" height="4" fill="#00000018"/>` +
      `<rect x="${r(x + 7)}" y="${r(y + h - 7)}" width="${r(Math.max(0, Math.min(1, tile.fill)) * (w - 14))}" height="4" fill="${INK}"/>`;

  // The full, untruncated value, for a reader who hovers a tile that had to be shortened.
  const full = `<title>${esc(tile.label)}${tile.sublabel === null ? '' : ` (${esc(tile.sublabel)})`}: ${esc(value)}</title>`;

  return `<g>${full}${face}${label}${sublabel}${readout}${bar}</g>`;
}

/**
 * SVG text neither wraps nor clips on its own, so a long endpoint would run straight across its
 * neighbours. Truncation is by estimated advance width rather than a fixed character count, and
 * the full string stays reachable in the tile's `<title>`.
 */
function truncate(s: string, available: number, charWidth: number): string {
  const max = Math.floor(available / charWidth);
  if (max < 1) return '';
  if (s.length <= max) return s;
  return s.slice(0, Math.max(1, max - 1)) + '…';
}

function chip(reason: string): string {
  return `<span class="chip ${reason === 'failed' ? 'none' : 'partial'}">${esc(reason)}</span>`;
}

/**
 * Identity sits outside the seven bands because it is not a population to size: two SSO
 * configurations are not "more identity" than one. It is described, never graded, per the
 * spec's non-goal: whether a posture is acceptable belongs to `sf-audit`.
 */
function identitySection(a: AnatomyArtifact): string {
  const { ssoConfigs, loginsByType } = a.identity;

  const sso = ssoConfigs.length === 0
    ? '<p class="muted">No SSO configuration was read. Check the coverage table above for whether that means none is configured or that the read was refused.</p>'
    : `<table><thead><tr><th>Type</th><th>Issuer</th><th>Identity mapping</th><th>User provisioning</th></tr></thead><tbody>${ssoConfigs
        .map(
          (s) =>
            `<tr><td>${esc(s.type)}</td><td class="muted">${esc(s.issuer ?? 'not stated')}</td>` +
            `<td class="muted">${esc(s.identityMapping ?? 'not stated')}</td>` +
            `<td>${s.userProvisioning ? 'yes' : 'no'}</td></tr>`,
        )
        .join('')}</tbody></table>`;

  const logins = loginsByType.length === 0
    ? '<p class="muted">No login history was returned.</p>'
    : `<table><thead><tr><th>Application</th><th>Login type</th><th class="num">Logins</th></tr></thead><tbody>${loginsByType
        .map(
          (l) =>
            `<tr><td>${esc(l.application)}</td><td class="muted">${esc(l.loginType)}</td>` +
            `<td class="num">${l.count}</td></tr>`,
        )
        .join('')}</tbody></table>`;

  return `<h2>How people get in</h2>
${sso}
<h3 style="font-size:15px;margin-top:22px">Logins by application and type</h3>
${logins}`;
}

import { esc } from '@cclabsnz/sf-core';
import type { ObjectTimeline } from '../map/graph/timeline.js';
import type { Phase } from '../map/graph/executionOrder.js';

export interface FlowComponentBox {
  name: string;
  type: string;
  y: number;
}

export interface FlowStage {
  phase: Phase;
  description: string;
  y: number;
  height: number;
  ordered: boolean;
  components: FlowComponentBox[];
}

export interface FlowConnector {
  fromY: number;
  toY: number;
}

export interface FlowLayout {
  stages: FlowStage[];
  connectors: FlowConnector[];
  width: number;
  height: number;
}

const WIDTH = 900;
/** Left column holds the phase spine; components hang to its right. */
const SPINE_X = 210;
const ROW = 21;
const STAGE_PAD = 13;
const GAP = 18;
const TOP = 12;

/**
 * Lay out one object's save sequence as a top-to-bottom process flow.
 *
 * A table of phases states the same facts, but a reader has to already know the order of execution
 * to see that it *is* an order. Drawing it as a flow makes the sequence the primary thing on the
 * page and the component names secondary, which is the right way round: the sequence is the part
 * the platform guarantees.
 *
 * Stages are stacked and never overlap, so a stage holding fourteen automations simply takes more
 * vertical room rather than colliding with its neighbour. Geometry is computed here rather than in
 * the SVG string so it can be asserted.
 */
export function computeFlowLayout(timeline: ObjectTimeline): FlowLayout {
  const stages: FlowStage[] = [];
  const connectors: FlowConnector[] = [];
  let y = TOP;

  for (const entry of timeline.entries) {
    const height = Math.max(46, entry.components.length * ROW + STAGE_PAD * 2);
    const startY = y + STAGE_PAD;
    const components = entry.components.map((c, i) => ({
      name: c.name,
      type: c.type,
      y: startY + i * ROW,
    }));

    stages.push({
      phase: entry.phase,
      description: entry.description,
      y,
      height,
      ordered: entry.ordered,
      components,
    });

    y += height + GAP;
  }

  for (let i = 1; i < stages.length; i++) {
    connectors.push({
      fromY: stages[i - 1].y + stages[i - 1].height,
      toY: stages[i].y,
    });
  }

  return {
    stages,
    connectors,
    width: WIDTH,
    height: stages.length === 0 ? 0 : y - GAP + TOP,
  };
}

/** Render one object's save sequence as an SVG process flow. */
export function renderExecutionFlow(timeline: ObjectTimeline): string {
  const layout = computeFlowLayout(timeline);
  if (layout.stages.length === 0) return '';

  const r = (n: number): number => Math.round(n * 10) / 10;

  const stages = layout.stages
    .map((s) => {
      const mid = s.y + s.height / 2;
      const marker = s.ordered
        ? ''
        : `<text x="${SPINE_X - 20}" y="${r(s.y + s.height - 4)}" font-size="10" fill="#8a6d1e" text-anchor="end">` +
          `&#9888; no guaranteed order</text>`;

      // A stage the platform does not order internally is drawn as a bracketed group rather than
      // a list, so it reads as "these, in any order" instead of "these, top to bottom".
      const bracket = s.ordered
        ? ''
        : `<path d="M ${SPINE_X + 8} ${r(s.y + STAGE_PAD - 5)} h -6 v ${r(s.height - STAGE_PAD * 2 + 10)} h 6" ` +
          `fill="none" stroke="#8a6d1e" stroke-width="1"/>`;

      const rows = s.components
        .map(
          (c) =>
            `<text x="${SPINE_X + 20}" y="${r(c.y + 4)}" font-size="11.5" fill="#2b2823" ` +
            `font-family="ui-monospace,SFMono-Regular,Menlo,monospace">${esc(c.name)}</text>` +
            `<text x="${WIDTH - 8}" y="${r(c.y + 4)}" font-size="9.5" fill="#9a958c" text-anchor="end">${esc(c.type)}</text>`,
        )
        .join('');

      return `<rect x="0" y="${r(s.y)}" width="${WIDTH}" height="${r(s.height)}" fill="#f4f1ea" stroke="#ddd7cb"/>` +
        `<rect x="0" y="${r(s.y)}" width="4" height="${r(s.height)}" fill="${s.ordered ? '#4a7d7d' : '#8a6d1e'}"/>` +
        `<text x="16" y="${r(mid - 3)}" font-size="12" font-weight="600" fill="#2b2823">${esc(s.phase)}</text>` +
        `<text x="16" y="${r(mid + 11)}" font-size="10" fill="#7a766d">${esc(s.description)}</text>` +
        marker + bracket + rows;
    })
    .join('');

  const arrows = layout.connectors
    .map(
      (c) =>
        `<line x1="${SPINE_X / 2}" y1="${r(c.fromY)}" x2="${SPINE_X / 2}" y2="${r(c.toY)}" ` +
        `stroke="#8d8880" stroke-width="1.5" marker-end="url(#execArrow)"/>`,
    )
    .join('');

  return `<svg viewBox="0 0 ${WIDTH} ${r(layout.height)}" style="display:block;width:100%;height:auto">
<defs><marker id="execArrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto">
<path d="M 0 0 L 8 4 L 0 8 z" fill="#8d8880"/></marker></defs>
${stages}${arrows}</svg>`;
}

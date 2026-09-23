import * as fs from 'node:fs';
import * as path from 'node:path';
import { SfCommand, Flags } from '@salesforce/sf-plugins-core';
import type { CanonicalGraph, EvidenceTier, Branding } from '@cclabsnz/sf-core';
import { resolveBranding, type BrandingOverrides } from '@cclabsnz/sf-core';
import { resolveOrgInfo, buildIntelContext } from '../../lib/wire.js';
import { runMap, type MapRunResult } from '../../map/runMap.js';
import { renderMapHtml, type MapAnchorRow, type MapReportInput } from '../../report/mapReport.js';
import { couplingViewOf, type CouplingView } from '../../report/couplingView.js';
import { OrgIntelCache } from '../../lib/cache.js';
import { resolveEvidence } from '../../map/evidence.js';
import { TOOL_VERSION, API_VERSION } from '../../version.js';

interface MapCommandResult {
  fragment: CanonicalGraph;
  flowsAnalyzed: number;
  apexClassesAnalyzed: number;
  apexTriggersAnalyzed: number;
  /** Same names as MapReportInput's, so the --html and --json paths cannot drift apart. */
  flowsListed?: number;
  apexClassesListed?: number;
  apexTriggersListed?: number;
}

/**
 * Assembles the object handed to `renderMapHtml` from a run result. Pulled out of `run()` so the
 * forwarding of every field -- the listed counts included -- is one place that can be tested
 * without an org connection, rather than something only visible inside a live command invocation.
 */
export function buildMapReportInput(params: {
  orgName: string;
  result: MapRunResult;
  anchors: MapAnchorRow[] | undefined;
  evidenceTier: EvidenceTier | null;
  branding: Branding;
  /** The run's fragment, already adapted. Accepted rather than re-derived so `run()` builds one
   *  view and hands the same one to the report and to the terminal summary. */
  view?: CouplingView;
}): MapReportInput {
  const { orgName, result, anchors, evidenceTier, branding } = params;
  return {
    orgName,
    couplingGraph: params.view ?? couplingViewOf(result.fragment),
    clusters: result.clusters,
    layout: result.layout,
    timelines: result.timelines,
    anchors,
    evidenceTier,
    // The same notes the terminal prints. A report read a week later has no terminal.
    notes: result.notes,
    flowsAnalyzed: result.flowsAnalyzed,
    apexClassesAnalyzed: result.apexClassesAnalyzed,
    apexTriggersAnalyzed: result.apexTriggersAnalyzed,
    flowsListed: result.flowsListed,
    apexClassesListed: result.apexClassesListed,
    apexTriggersListed: result.apexTriggersListed,
    // `runMap` stamps the fragment's `capturedAt` from the same run provenance that used to
    // stamp `couplingGraph.provenance.generatedAt`, so this is the same instant, read off the
    // one model that survives rather than a second field kept alongside it.
    generatedAt: result.fragment.capturedAt,
    branding,
  };
}

/**
 * Assembles the --json result from a run result. Same reasoning as `buildMapReportInput`: a
 * plain function the field-forwarding can be tested against, rather than something only visible
 * inside a live command invocation. Reuses the same field names as `MapReportInput` on purpose --
 * the HTML and JSON outputs describe the same run, and a name drift between them is how one path
 * quietly stops telling the truth the other one does.
 */
export function buildMapCommandResult(result: MapRunResult): MapCommandResult {
  return {
    fragment: result.fragment,
    flowsAnalyzed: result.flowsAnalyzed,
    apexClassesAnalyzed: result.apexClassesAnalyzed,
    apexTriggersAnalyzed: result.apexTriggersAnalyzed,
    flowsListed: result.flowsListed,
    apexClassesListed: result.apexClassesListed,
    apexTriggersListed: result.apexTriggersListed,
  };
}

export default class IntelMapCommand extends SfCommand<MapCommandResult> {
  public static summary = 'Map which objects are coupled into cross-cutting processes, and by what automation';
  public static description =
    'Parses Active flows (Flow XML) and Apex (SymbolTable, with a body-regex fallback) to build a cross-object ' +
    'coupling graph: object-pair couplings aggregated across flows, triggers, and classes with weights, ' +
    'operations, contributing components, and confidence. Emits graph-fragment.json, sf-orgintel\'s contribution ' +
    'to the shared canonical org graph. With --html, a branded report with a static coupling graph. Read-only and ' +
    'deterministic: same org in, same graph out.';
  public static examples = [
    '<%= config.bin %> <%= command.id %> --target-org myOrg',
    '<%= config.bin %> <%= command.id %> --target-org myOrg --html --output ./reports',
    '<%= config.bin %> <%= command.id %> --target-org myOrg --include-inactive --json',
  ];

  public static flags = {
    'target-org': Flags.requiredOrg(),
    'include-inactive': Flags.boolean({
      summary: 'Analyse inactive flows too (default: Active flows only).',
      default: false,
    }),
    html: Flags.boolean({ summary: 'Also write a branded HTML coupling report.', default: false }),
    output: Flags.string({
      char: 'o',
      summary: 'Directory to write graph-fragment.json and the --html report.',
      default: '.',
    }),
    branding: Flags.string({
      summary: 'Path to a report-branding.json to override CloudCounsel defaults (HTML report).',
      helpValue: './report-branding.json',
    }),
    'prepared-for': Flags.string({ summary: 'Client name for the HTML report cover line.' }),
    refresh: Flags.boolean({
      summary: 'Ignore cached analysis and recompute, refreshing the cache as it goes.',
      default: false,
    }),
    'domain-size': Flags.integer({
      summary: 'Largest domain to report; clustering resolution is tuned to fit (default 25).',
      description:
        'Lower values resolve finer domains. Tuning stops early if tightening further would ' +
        'only isolate objects rather than reveal structure.',
      min: 2,
    }),
    'top-layout': Flags.integer({
      summary: 'Objects to draw in the HTML coupling picture (default 20).',
      description:
        'Affects the report visual only. The navigation view lays every object out completely, ' +
        'independently of this cap.',
      min: 2,
    }),
    'max-node-counts': Flags.integer({
      summary: 'Objects to fetch 90-day record counts for (default 100).',
      description: 'Each count is a separate SOQL query; objects beyond the cap appear in the notes.',
      min: 1,
    }),
  };

  public async run(): Promise<MapCommandResult> {
    const { flags } = await this.parse(IntelMapCommand);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const conn = flags['target-org'].getConnection(API_VERSION) as any;
    const { orgInfo, namespace } = await resolveOrgInfo(conn);
    const ctx = buildIntelContext(conn, orgInfo, namespace, API_VERSION);
    const cache = new OrgIntelCache(orgInfo.id, undefined, { refresh: flags.refresh });

    const evidence = resolveEvidence(cache);
    const { evidenceTier, anchors } = evidence;
    if (!evidence.measured) this.warn(evidence.note!);

    this.log(`Mapping cross-object couplings for org: ${orgInfo.name} (${orgInfo.id})`);
    const result = await runMap(
      ctx,
      { generatedAt: new Date().toISOString(), toolVersion: TOOL_VERSION, orgId: orgInfo.id, evidenceTier },
      {
        includeInactive: flags['include-inactive'],
        cache,
        targetDomainSize: flags['domain-size'],
        topLayout: flags['top-layout'],
        maxNodeCounts: flags['max-node-counts'],
      },
    );

    // One adaptation of the fragment for this run, shared by the HTML report and the terminal
    // summary below. Both used to read the separate CouplingGraph; deriving the view twice would
    // reintroduce exactly the second model 1.0 removed.
    const view = couplingViewOf(result.fragment);

    fs.mkdirSync(flags.output, { recursive: true });
    const fragmentPath = path.join(flags.output, 'graph-fragment.json');
    fs.writeFileSync(fragmentPath, JSON.stringify(result.fragment, null, 2), 'utf-8');
    this.log(`IR written: ${fragmentPath}`);

    if (flags.html) {
      const overrides = flags.branding
        ? (JSON.parse(fs.readFileSync(flags.branding, 'utf-8')) as BrandingOverrides)
        : undefined;
      const branding = resolveBranding(overrides, flags['prepared-for']);
      const html = renderMapHtml(
        buildMapReportInput({ orgName: orgInfo.name, result, anchors, evidenceTier, branding, view }),
      );
      const htmlPath = path.join(flags.output, `orgintel-map-${orgInfo.id}-${Date.now()}.html`);
      fs.writeFileSync(htmlPath, html, 'utf-8');
      this.log(`Report written: ${htmlPath}`);
    }

    this.printSummary(view, result.clusters.length, evidenceTier);
    for (const note of result.notes) this.log(`  note: ${note}`);

    return buildMapCommandResult(result);
  }

  private printSummary(view: CouplingView, domains: number, tier: EvidenceTier | null): void {
    const g = view;
    this.log('');
    this.log('─────────────────────────────────────────');
    this.log(`  Evidence tier: ${tier ?? 'not measured (run `sf intel probe`)'}`);
    this.log(`  Objects: ${g.nodes.length}   Coupled pairs: ${g.edges.length}   Domains: ${domains}`);
    this.log('─────────────────────────────────────────');
    this.log('  Top process backbones:');
    for (const e of g.edges.slice(0, 8)) {
      this.log(`   ${e.from} ↔ ${e.to}  (weight ${e.weight}, ${e.operations.join('/')})`);
    }
    this.log('─────────────────────────────────────────');
  }
}

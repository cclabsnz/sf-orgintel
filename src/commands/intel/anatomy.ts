import * as fs from 'node:fs';
import * as path from 'node:path';
import { SfCommand, Flags } from '@salesforce/sf-plugins-core';
import { resolveBranding, type BrandingOverrides } from '@cclabsnz/sf-core';
import { resolveOrgInfo, buildIntelContext } from '../../lib/wire.js';
import { runAnatomy } from '../../anatomy/runAnatomy.js';
import { renderAnatomyHtml } from '../../report/anatomyReport.js';
import type { AnatomyArtifact } from '../../anatomy/types.js';
import { TOOL_VERSION, API_VERSION } from '../../version.js';

/** Two spaces and a trailing newline, so consecutive runs diff cleanly in git. */
export function writeArtifact(outputDir: string, artifact: AnatomyArtifact): string {
  fs.mkdirSync(outputDir, { recursive: true });
  const artifactPath = path.join(outputDir, 'anatomy.json');
  fs.writeFileSync(artifactPath, JSON.stringify(artifact, null, 2) + '\n', 'utf-8');
  return artifactPath;
}

/**
 * Same filename convention as the map report: tool, view, org id, run timestamp. The timestamp
 * is what keeps a second run from silently overwriting the first, which matters more here than
 * a tidy directory, because these reports carry real product names, user counts and endpoints
 * and are routinely handed to someone else.
 *
 * Separate from `writeArtifact` so that a run without `--html` writes no report at all.
 */
export function writeReport(outputDir: string, html: string, orgId: string, generatedAtMs: number): string {
  fs.mkdirSync(outputDir, { recursive: true });
  const reportPath = path.join(outputDir, `orgintel-anatomy-${orgId}-${generatedAtMs}.html`);
  fs.writeFileSync(reportPath, html, 'utf-8');
  return reportPath;
}

export default class IntelAnatomyCommand extends SfCommand<AnatomyArtifact> {
  public static summary = 'Map the org one level above coupling: products, personas, channels and integrations';
  public static description =
    'Collects what products live in the org, who uses it on what licence, what it integrates with, and how ' +
    'people authenticate. Every integration edge records how it was detected and, separately, how it was ' +
    'attributed to a product, so a confirmed call with an unknown owner is reported as exactly that. ' +
    'With --html, also renders View A, a seven-band layer map of the same artifact, which adds no reads: ' +
    'a band the artifact does not cover says so rather than going to fetch it. ' +
    'Read-only and deterministic: same org in, same anatomy.json out.';
  public static examples = [
    '<%= config.bin %> <%= command.id %> --target-org myOrg',
    '<%= config.bin %> <%= command.id %> --target-org myOrg --html --output ./reports',
  ];

  // No `char` on any flag here. `Flags.requiredOrg()` already owns `-o` for --target-org, so a
  // short flag added to --output binds to the org instead and fails with an authorization error
  // that names the directory. `intel map` still carries that collision.
  public static flags = {
    'target-org': Flags.requiredOrg(),
    html: Flags.boolean({ summary: 'Also write a branded HTML report of View A, the seven-band layer map.', default: false }),
    output: Flags.string({
      summary: 'Directory to write anatomy.json and the --html report to.',
      default: '.',
    }),
    branding: Flags.string({
      summary: 'Path to a report-branding.json to override CloudCounsel defaults (HTML report).',
      helpValue: './report-branding.json',
    }),
    'prepared-for': Flags.string({ summary: 'Client name for the HTML report cover line.' }),
  };

  public async run(): Promise<AnatomyArtifact> {
    const { flags } = await this.parse(IntelAnatomyCommand);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const conn = flags['target-org'].getConnection(API_VERSION) as any;
    const { orgInfo, namespace } = await resolveOrgInfo(conn);
    const ctx = buildIntelContext(conn, orgInfo, namespace, API_VERSION);

    this.log(`Mapping org anatomy for org: ${orgInfo.name} (${orgInfo.id})`);
    // One timestamp for the run, reused by the artifact, the report and the report's filename,
    // so the three never disagree about when this was collected.
    const startedAt = new Date();
    const artifact = await runAnatomy(ctx, {
      generatedAt: startedAt.toISOString(),
      orgId: orgInfo.id,
      toolVersion: TOOL_VERSION,
      apiVersion: API_VERSION,
    });

    const artifactPath = writeArtifact(flags.output, artifact);
    this.log(`IR written: ${artifactPath}`);

    if (flags.html) {
      const overrides = flags.branding
        ? (JSON.parse(fs.readFileSync(flags.branding, 'utf-8')) as BrandingOverrides)
        : undefined;
      const html = renderAnatomyHtml({
        orgName: orgInfo.name,
        artifact,
        generatedAt: artifact.provenance.generatedAt,
        branding: resolveBranding(overrides, flags['prepared-for']),
      });
      const reportPath = writeReport(flags.output, html, orgInfo.id, startedAt.getTime());
      this.log(`Report written: ${reportPath}`);
    }

    this.printSummary(artifact);
    for (const note of artifact.coverage.notes) this.log(`  note: ${note}`);

    return artifact;
  }

  private printSummary(artifact: AnatomyArtifact): void {
    const total = artifact.edges.length;
    const unattributed = artifact.edges.filter((e) => e.attribution === 'unattributed').length;
    const proportion = total > 0 ? `${((unattributed / total) * 100).toFixed(0)}%` : 'n/a';
    this.log('');
    this.log('─────────────────────────────────────────');
    this.log(`  Products: ${artifact.products.length}   Personas: ${artifact.personas.length}   Channels: ${artifact.channels.length}`);
    this.log(`  Integration edges: ${total}`);
    this.log(`  Unattributed: ${unattributed} of ${total} (${proportion})`);
    this.log(`  Apex bodies: ${artifact.coverage.apexBodiesScanned} scanned, ${artifact.coverage.apexBodiesUnreadable} unreadable`);
    if (artifact.coverage.omniElementsScanned > 0 || artifact.coverage.omniElementsSkippedSuperseded > 0) {
      this.log(
        `  OmniStudio elements: ${artifact.coverage.omniElementsScanned} scanned (active versions), ` +
          `${artifact.coverage.omniElementsSkippedSuperseded} skipped (superseded versions)`,
      );
    }
    if (artifact.coverage.prefixesUnresolved.length > 0) {
      this.log(`  Prefixes with no product source: ${artifact.coverage.prefixesUnresolved.join(', ')}`);
    }
    this.log('─────────────────────────────────────────');
  }
}

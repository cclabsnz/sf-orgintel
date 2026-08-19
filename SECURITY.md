# Security Policy

`@cclabsnz/sf-orgintel` is a **read-only** Salesforce org intelligence plugin. It maps
how an org actually works — its products, personas, channels, integrations and
cross-object couplings — from metadata and behavioural data. It issues only
SOQL / Tooling / REST GET queries and never modifies an org. Even so, we take the
security of the plugin, and of the orgs it runs against, seriously.

The output deserves as much care as the code: `anatomy.json`, `coupling-graph.json`
and the generated HTML reports contain real product names, user counts, endpoints and
org identifiers. Treat a generated report as customer data.

## Supported versions

The latest published minor version receives security fixes. Please upgrade to the
newest release before reporting an issue.

| Version | Supported |
| ------- | --------- |
| latest  | ✅        |
| older   | ❌        |

## Reporting a vulnerability

**Please do not report security vulnerabilities through public GitHub issues.**

Instead, use one of the following private channels:

- **GitHub private vulnerability reporting:** open the repository's **Security**
  tab and choose **Report a vulnerability** (preferred).
- **Email:** [hello@cloudcounsel.co.nz](mailto:hello@cloudcounsel.co.nz) with the
  subject line `SECURITY: sf-orgintel`.

Please include:

- the plugin version (`sf plugins inspect @cclabsnz/sf-orgintel`),
- a description of the issue and its impact,
- steps to reproduce, and
- any relevant logs or report output, **with org identifiers and secrets redacted**.

## What to expect

- We aim to acknowledge a report within **5 business days**.
- We will confirm the issue, keep you updated on remediation, and credit you in the
  release notes unless you prefer to remain anonymous.
- Please give us a reasonable window to release a fix before any public disclosure.

## Scope

In scope: the plugin's code, its handling of org data and credentials, and the
content of the reports and artifacts it writes. Out of scope: vulnerabilities in
Salesforce itself, in the `sf` CLI, or in third-party dependencies (report those
upstream; we will bump dependencies promptly via Dependabot).

## Release integrity & assurance

- **Read-only, enforced.** `test/unit/invariants/readonly-invariant.test.ts` fails the
  build if any org-mutating API, HTTP write verb, or bulk/composite write path is
  introduced into the source.
- **No network egress.** `test/unit/invariants/network-egress.test.ts` fails the build
  if any code path could contact a third party, and if a generated report could
  reference a remote asset. The only destination is the org you authenticated against.
  Reports are self-contained and open offline.
- **No org data in the repository.** A guard runs in CI and as a pre-commit hook,
  rejecting org ids, sandbox hostnames and generated artefacts in the tree, in commit
  messages, and in a pull request's own title and body.
- **Build provenance.** Releases are published from GitHub Actions over OIDC trusted
  publishing, with npm provenance and no stored token. Verify with
  `npm view @cclabsnz/sf-orgintel --json` and check the `dist.attestations` field.
  **Note:** `0.1.0` predates trusted publishing being configured for this package and
  carries **no attestation**. Every release from `0.2.0` onward does.
- **Static analysis & supply chain.** CodeQL, Semgrep, Socket and OpenSSF Scorecard run
  on every change; every GitHub Action is pinned by commit SHA; and a CycloneDX SBOM is
  attached to each GitHub Release.
- **To verify what you installed:** `sf plugins inspect @cclabsnz/sf-orgintel` for the
  version, then compare against the signed release and its provenance attestation.

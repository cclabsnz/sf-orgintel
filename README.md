# @cclabsnz/sf-orgintel

[![CI](https://github.com/cclabsnz/sf-orgintel/actions/workflows/ci.yml/badge.svg)](https://github.com/cclabsnz/sf-orgintel/actions/workflows/ci.yml)
[![CodeQL](https://github.com/cclabsnz/sf-orgintel/actions/workflows/codeql.yml/badge.svg)](https://github.com/cclabsnz/sf-orgintel/actions/workflows/codeql.yml)
[![Semgrep](https://github.com/cclabsnz/sf-orgintel/actions/workflows/semgrep.yml/badge.svg)](https://github.com/cclabsnz/sf-orgintel/actions/workflows/semgrep.yml)
[![OpenSSF Scorecard](https://api.securityscorecards.dev/projects/github.com/cclabsnz/sf-orgintel/badge)](https://securityscorecards.dev/viewer/?uri=github.com/cclabsnz/sf-orgintel)
[![OpenSSF Best Practices](https://www.bestpractices.dev/projects/14151/badge)](https://www.bestpractices.dev/projects/14151)
[![npm version](https://img.shields.io/npm/v/@cclabsnz/sf-orgintel)](https://www.npmjs.com/package/@cclabsnz/sf-orgintel)
[![License: Apache-2.0](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)

> Understand how a Salesforce org actually works (its processes, people, and couplings) from metadata and behavioral data, entirely locally.

A read-only `sf` CLI plugin that analyses an org's metadata and behavioural tables to reveal
how it is actually used. Where a security audit answers *"how secure is this org,"* OrgIntel
answers *"how does this org work."*

**Local-first and deterministic by design.** No metadata ever leaves your machine: the only
network calls are to the authenticated Salesforce org's APIs. No LLM/AI calls, no telemetry,
no analytics. Same org in, same findings out.

## Commands

| Command | Answers |
| --- | --- |
| `sf intel probe` | *What can this org tell us about itself?* A capability & evidence-coverage probe. |
| `sf intel discover` | *Where do this org's business processes live?* Anchor-object ranking + domain fingerprint. |
| `sf intel map` | *Which objects are coupled into cross-cutting processes, and by what automation?* |

Every command supports `--json` (machine output) and `--target-org` per `sf` convention, and
is strictly read-only against the org (SOQL / Tooling / Metadata reads and describes only).

## Command reference

Every command is read-only, supports `--json`, and takes `--target-org` per `sf` convention.
Anything the authenticated user cannot read is reported as a note rather than failing the run,
so a low-privilege user still gets a partial, clearly-labelled result. See
[PERMISSIONS.md](PERMISSIONS.md) for the minimum access each command needs.

### `sf intel probe`

*What can this org tell us about itself?* Grades the org's **evidence tier**, meaning how much of its
own behaviour it can actually evidence, from Event Monitoring availability, field-history
tracking and the standard behavioural tables.

| Flag | Purpose |
| --- | --- |
| `--html` | Also write a branded HTML report |
| `--output <dir>` | Where to write the report (default `.`) |
| `--branding <file>` | `report-branding.json` overriding the defaults |
| `--prepared-for <name>` | Client name for the report cover line |
| `--refresh` | Ignore cached analysis and recompute |

| Tier | Meaning |
| --- | --- |
| A | Full Event Monitoring **and** Field Audit Trail |
| B | Standard behavioural tables readable, with data |
| C | Metadata and snapshots only |
| D | Not even describable; prospective collection recommended |

Run this first: `intel map` reports the tier it measured, and without a probe it reports
`not measured` rather than inventing one.

### `sf intel discover`

*Where do this org's business processes live?* Ranks **anchor objects**, those carrying real
process, and builds a domain fingerprint (installed packages, record types, automation
density). Each candidate carries its score, per-signal contributions and human-readable
evidence, so a ranking can be defended rather than just quoted.

| Flag | Purpose |
| --- | --- |
| `--top <n>` | Anchors to report |
| `--max-objects <n>` | Objects to consider |
| `--output <dir>` | Where to write the fingerprint |
| `--no-fingerprint-file` | Skip writing the fingerprint JSON |
| `--refresh` | Ignore cached analysis and recompute |

### `sf intel map`

*Which objects are coupled into cross-cutting processes, and by what automation?* Parses active
Flows (via `FlowDefinitionView` + `Flow.Metadata`) and Apex (`SymbolTable`, with a body-regex
fallback) into an object-pair coupling graph, then partitions it into domains.

| Flag | Purpose |
| --- | --- |
| `--include-inactive` | Analyse inactive flows too (default: active only) |
| `--domain-size <n>` | Largest domain to report; clustering resolution tunes to fit (default 25) |
| `--top-layout <n>` | Objects drawn in the HTML picture (default 20) |
| `--max-node-counts <n>` | Objects to fetch 90-day record counts for (default 100) |
| `--html` | Also write a branded HTML coupling report |
| `--output <dir>` | Where to write the IR and report |
| `--branding <file>` / `--prepared-for <name>` | Report branding |
| `--refresh` | Ignore cached analysis and recompute |

Emits two versioned IR contracts, validated against the JSON Schemas published in
`@cclabsnz/sf-core`:

| File | Contents |
| --- | --- |
| `coupling-graph.json` | Objects with automation counts and 90-day volumes; coupled pairs with weight, operations, contributing components and confidence |
| `landscape-manifest.json` | Semantic-zoom navigation: L0 domains positioned against each other, L1 objects positioned within each domain |

**Clustering picks its algorithm by graph density.** A sparse org is often a tree, where
modularity has no community structure to find and shatters a chain into pairs; a mature org has
thousands of couplings and almost no bridges, where bridge-cutting returns one blob. Below an
average degree of 2 the graph is a forest and is split structurally; above it, Louvain
modularity runs with its resolution tuned to `--domain-size`.

**Evidence quality is reported, not assumed.** Each contributing component is marked `high`
(parsed structure) or `approximate` (regex fallback), and any source that could not be read
(an unqueryable object, a managed-package flow, a capped record-count sweep) appears in the
run's notes rather than being silently dropped.

## Caching

Analysis is memoised under `~/.orgintel/cache/<orgId>/v<toolVersion>/`, keyed by a hash of the
content analysed. The cache is a pure memo: cold, warm and `--refresh` runs produce identical
output. It is namespaced by tool version so a result computed by older analysis logic is never
served after an upgrade, and `--refresh` recomputes on demand. Delete the directory to clear it.

## Install (local dev)

```
pnpm -r build
sf plugins link packages/sf-orgintel-plugin
sf intel probe --target-org <alias>
```

## Trust & verification

The two claims at the top of this README, strictly read-only and local-first, are enforced
as tests, not asserted in prose:

- **Read-only.** `test/unit/invariants/readonly-invariant.test.ts` statically scans this
  package's entire source tree and fails the build if any jsforce mutation API, HTTP write
  verb, or bulk/composite write path appears. All org I/O funnels through the
  `@cclabsnz/sf-core` clients (SOQL / Tooling / REST **GET** / Metadata reads only); this
  package issues no direct network calls of its own.
- **Local-first.** `test/unit/invariants/network-egress.test.ts` fails the build on any
  third-party HTTP client, raw `node:http`/`https` use, telemetry/analytics/LLM endpoint,
  websocket, or remote asset in a generated report. No metadata leaves your machine: the
  only network destination is the org you authenticated against. No LLM/AI calls, no
  telemetry, no analytics.

Run both yourself:

```
pnpm --filter @cclabsnz/sf-orgintel test test/unit/invariants
```

Analysis is also **deterministic** (same org in, same findings out) and cached under
`~/.orgintel/cache/<orgId>` keyed by a content hash of the component analysed, so the cache
is a pure memo and never changes a result.

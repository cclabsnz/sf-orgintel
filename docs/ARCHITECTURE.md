# Architecture

How `@cclabsnz/sf-orgintel` is put together, and why. Read this before changing anything that
crosses a module boundary.

## What it is

A read-only `sf` CLI plugin (oclif, TypeScript ESM/NodeNext) that analyses a Salesforce org's
metadata and behavioural tables and writes artifacts describing how the org actually works.

```
   sf intel discover   probe   map   anatomy
              \          |      |      /
               \         |      |     /
                =========================
                    src/  (this plugin)
                =========================
                            |
                    @cclabsnz/sf-core        (read-only clients, report shell)
                            |
                  a Salesforce org  (SOQL / Tooling / REST GET only)
```

The org boundary lives in `sf-core`, consumed from npm. This repository holds the analysis.

## Commands and what they produce

| Command | Produces |
| --- | --- |
| `sf intel discover` | An org fingerprint: installed packages, clouds, object inventory, record types |
| `sf intel probe` | An evidence tier: what can be measured on this org, and how confidently |
| `sf intel map` | `coupling-graph.json` and `landscape-manifest.json`, plus an HTML coupling report |
| `sf intel anatomy` | `anatomy.json`, plus View A (the seven-band layer map) behind `--html` |

## The shape every command follows

```
command  →  wire (build an IntelContext)  →  collectors        [IO, may fail]
                                              |
                                              v
                                        pure analysis           [no org, fully testable]
                                              |
                                              v
                                        versioned artifact      (anatomy.json, coupling-graph.json)
                                              |
                                              v
                                        renderer  →  self-contained HTML
```

**The split is the design.** Collectors perform IO and are allowed to fail. Everything after
them is pure, which is why attribution, layout and classification can be unit-tested without
an org. A renderer never reaches back for data: View A renders `anatomy.json` and nothing
else, so a band the artifact does not cover says so rather than going to fetch it.

## Modules

| Module | Responsibility |
| --- | --- |
| `src/commands/intel` | oclif command classes. Flag parsing, output paths, terminal summary. Thin by intent. |
| `src/lib` | `wire.ts` builds the `IntelContext` (the sf-core clients plus org identity); `cache.ts` memoises expensive reads. |
| `src/discover` | Org fingerprinting: activity, automation, object insight and resolution. |
| `src/probe` | What is measurable on this org: behavioural tables, field history, event monitoring, and the resulting evidence tier. |
| `src/map` | The coupling graph: Apex and Flow parsing, edge assembly, layering, clustering, strata layout. |
| `src/anatomy` | Products, personas, channels, capabilities, identity and integration edges, plus the View A band model in `anatomy/view`. |
| `src/report` | Renderers. Inline SVG and HTML inside the shared report shell from sf-core. |

## Honesty rules that are not stylistic

These exist because breaking them produces a confident, wrong answer — the worst output this
tool can give.

**Absence renders explicitly.** "We looked and found none" and "we never looked" are
different findings and must never render the same way. `coverage.unavailable` carries the
distinction as structured data (a stable scope key, a reason of `deferred` or `failed`, and
the human detail), and View A classifies bands and tiles from that data. **No consumer reads
`coverage.notes` prose**: a band's honesty must not depend on a sentence staying worded one
way. See `docs/ANATOMY_SPEC.md` sections 6 and 7.1.

**Partial collection renders explicitly too.** A band with tiles is not necessarily complete.
A populated band carries the caveats from its own scopes and renders "Partly collected",
because an uncaveated band is a claim of completeness.

**Every number is a measured reading.** A count that could not be read is marked
`unavailable` and drawn differently, never printed as the placeholder zero it fell back to.

**Detection and attribution are separate.** How an integration edge was *proven to exist* is
recorded independently of how it was *attributed to a product*, so a confirmed call with an
unknown owner is reported as exactly that rather than being dropped or guessed at.

**Deterministic output.** The same org in, the same bytes out. No `Date.now()` or
`Math.random()` in a render path, and no iteration over unordered structures. This is what
lets a reader diff two runs and attribute the difference to the org.

## Untrusted input

Everything returned by the org is untrusted. It reaches three sinks, each with a rule:

- **Generated HTML** — escaped with `esc` from sf-core. Note that `esc` covers element text
  and double-quoted attributes; JSON embedded in a `<script>` element additionally escapes
  `<`, so a value containing a closing script tag cannot terminate the element early.
- **SOQL** — identifiers are allowlisted to `[A-Za-z0-9_]` rather than escaped.
- **File paths** — org-derived values are reduced to a single safe path segment by sf-core
  before being joined.

Generated artifacts contain real product names, user counts and endpoints. They are customer
data and the repository guard exists to keep them out of the tree.

# OrgIntel M5 hardening status

Working repo: `cclabsnz/sf-orgintel`. Depends on `@cclabsnz/sf-core` from npm (^0.6.0).

**M5 is complete and this page is history.** The work that followed it is the three-plan
convergence onto one canonical org graph, shipped in `0.3.0`: `intel map` and `intel anatomy`
each emit a graph fragment in the schema `sf-orgviz` also writes. The three legacy IR artifacts
were deprecated in `0.3.0` and retired in `1.0.0`, which also deleted the in-memory models behind
them; the fragments are the only IR now. Current direction lives in [ROADMAP.md](ROADMAP.md);
what shipped lives in [CHANGELOG.md](CHANGELOG.md).

| Task | State |
| --- | --- |
| 1. Cluster degeneration | done: density gate + Louvain modularity |
| 2. Manifest layout complete | done: L0/L1 laid out independently of the report |
| 3. Schema tests on real pipeline output | done: fixtures driven through the real pipeline, JSON round-tripped |
| 4. Evidence tier honesty | done: unmeasured is null, needs core ^0.1.1 or later |
| 5. Cache versioning + `--refresh` | done: version-namespaced, `--refresh` on all commands, Apex memoised |
| 6. Tuning knobs | done: `--domain-size`, `--top-layout`, `--max-node-counts` |
| Interactive strata viewer | done: semantic zoom, pan, selection; self-contained |
| Strata rendering | done: coupling graph drawn as layered bands, Sugiyama-style |
| 7. Packaging / README / validation worksheet | done: PERMISSIONS.md + per-command reference; worksheet remains operator-run |

## Beyond the plan (found on a real org)

- **Layer view:** done. Objects classified into seven layers, carried on each coupling-graph
  node (`@cclabsnz/sf-core@^0.1.2`) and reported as a cross-layer coupling table. Since `1.0.0`
  retired that node, the layer is resolved by `couplingViewOf` when it adapts the fragment for
  the report, since the fragment's contributions carry no layer of their own. The table counts
  the same objects it always did, the ones appearing in a coupling edge; `couplingViewOf` filters
  its nodes down to those, because the contributions it reads cover every known object. On a real org
  `business ↔ security` is the second-heaviest relationship in the graph (1709 weight / 361
  couplings), which filtering infrastructure out would have deleted entirely.
- **Evidence quality not surfaced graph-level:** done. A "Coverage and confidence" section
  sits directly under the summary and above the graph, stating the approximate share in
  words and breaking the coupled pairs down by evidence. Fixing this exposed a second
  problem: an edge was labelled `high` when *any* component was exact, so nine regex guesses
  and one SymbolTable hit read as fact. An edge is now `high` only when every component is,
  with `mixed` named rather than rounded away.
- **110 managed-package flows skipped:** done. Run notes are rendered in the report under
  "Not analysed" instead of being printed to a terminal nobody has a week later.

## Verified on a real org

202 objects, 2078 couplings, ~1:43 cold / 0:59 warm, byte-identical across runs.
Domains: 29 at default; `--domain-size 40` → 14 domains largest 34; `20` → 66 domains largest 15.

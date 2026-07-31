# OrgIntel M5 — hardening status

Working repo: `cclabsnz/sf-orgintel`. Depends on `@cclabsnz/sf-core` from npm (^0.1.1).

| Task | State |
| --- | --- |
| 1. Cluster degeneration | done — density gate + Louvain modularity |
| 2. Manifest layout complete | done — L0/L1 laid out independently of the report |
| 3. Schema tests on real pipeline output | done — fixtures driven through the real pipeline, JSON round-tripped |
| 4. Evidence tier honesty | done — unmeasured is null, needs core ^0.1.1 |
| 5. Cache versioning + `--refresh` | done — version-namespaced, `--refresh` on all commands, Apex memoised |
| 6. Tuning knobs | done — `--domain-size`, `--top-layout`, `--max-node-counts` |
| Interactive strata viewer | done — semantic zoom, pan, selection; self-contained |
| Strata rendering | done — coupling graph drawn as layered bands, Sugiyama-style |
| 7. Packaging / README / validation worksheet | done — PERMISSIONS.md + per-command reference; worksheet remains operator-run |

## Beyond the plan (found on a real org)

- **Layer view** — done. Objects classified into seven layers, carried on each coupling-graph
  node (`@cclabsnz/sf-core@^0.1.2`) and reported as a cross-layer coupling table. On a real org
  `business ↔ security` is the second-heaviest relationship in the graph (1709 weight / 361
  couplings), which filtering infrastructure out would have deleted entirely.
- **Evidence quality not surfaced graph-level** — ~2/3 of components are regex-approximate and
  nothing says so outside a per-edge field.
- **110 managed-package flows skipped** — correct, but belongs in the report, not a note.

## Verified on a real org

202 objects, 2078 couplings, ~1:43 cold / 0:59 warm, byte-identical across runs.
Domains: 29 at default; `--domain-size 40` → 14 domains largest 34; `20` → 66 domains largest 15.

# OrgIntel M5 — hardening status

Working repo: `cclabsnz/sf-orgintel`. Depends on `@cclabsnz/sf-core` from npm (^0.1.1).

| Task | State |
| --- | --- |
| 1. Cluster degeneration | done — density gate + Louvain modularity |
| 2. Manifest layout complete | done — L0/L1 laid out independently of the report |
| 3. Schema tests on real pipeline output | **next** — `schema.test.ts` still validates hand-written literals |
| 4. Evidence tier honesty | done — unmeasured is null, needs core ^0.1.1 |
| 5. Cache versioning + `--refresh` | open — no TOOL_VERSION in the key; Apex uncached |
| 6. Tuning knobs | done — `--domain-size`, `--top-layout`, `--max-node-counts` |
| 7. Packaging / README / validation worksheet | partial — PERMISSIONS.md written; README needs a per-command reference |

## Beyond the plan (found on a real org)

- **Layer view** — strata (business / security / observability / integration) instead of one
  cloud. Prototyped only; the cross-layer matrix surfaced `business ↔ security` at 310
  couplings, invisible in the flat graph.
- **Evidence quality not surfaced graph-level** — ~2/3 of components are regex-approximate and
  nothing says so outside a per-edge field.
- **110 managed-package flows skipped** — correct, but belongs in the report, not a note.

## Verified on a real org

202 objects, 2078 couplings, ~1:43 cold / 0:59 warm, byte-identical across runs.
Domains: 29 at default; `--domain-size 40` → 14 domains largest 34; `20` → 66 domains largest 15.

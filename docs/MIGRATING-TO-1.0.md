# Migrating to 1.0

1.0 stops writing three files that `0.3.0` deprecated, and changes two things that are not files.
This page shows the before and after for each. The release notes summarise; this is the detail.

If you only ran the commands and looked at the HTML report, nothing changed. The report is
byte-identical to what `0.3.0` produced.

## What is gone

| Retired | Replacement |
|---|---|
| `coupling-graph.json` | `graph-fragment.json` |
| `landscape-manifest.json` | no file; navigation resolves from a view over the graph |
| `anatomy.json` | `anatomy-fragment.json` |

All three were deprecated in `0.3.0`, with the `0.x` line announced as the migration window.

## If you read `coupling-graph.json`

The same facts are in `graph-fragment.json`, shaped as a canonical graph rather than a bespoke
document.

| Before | After |
|---|---|
| `nodes[]` with `object` | attribute contributions on `obj.<Name>` node ids |
| `nodes[].recordCount90d` | contribution `attrs.recordCount90d` |
| `nodes[].automationCounts` | contribution `attrs.automationCounts`, which carries four fields rather than three: `workflowRules` travels here too |
| `nodes[].layer` | not carried; `roleOf(object)` derives it, and the report applies it at render time |
| `nodes[].custom` | not carried |
| `edges[]` | edges with `kind: "couples"`, `from`/`to` prefixed `obj.` |
| `edges[].weight`, `.operations`, `.components`, `.direction` | the same fields under the edge's `attrs` |
| edge confidence | not stored; derive it from `components[].confidence` as the report does |

The fragment also carries `touches` edges from each automation component to the objects it
touches, which `coupling-graph.json` had no place for.

## If you read `landscape-manifest.json`

This one has no drop-in replacement, and that is deliberate.

The manifest carried computed **layout coordinates** — L0 positioning domains against each other,
L1 positioning objects inside each domain. Coordinates are derived analytics, and the canonical
graph deliberately does not store them. A view resolves them at render time instead.

**Five fields are withdrawn rather than replaced:** `label`, `objects`, `metrics` (`objects`,
`automations`, `recordCount90d`), `graphRef` and `anchorObject`. All five are derivable — `objects`
and `anchorObject` are cluster membership, `metrics` sums the per-object contributions across a
cluster, `label` was the object's own name, and `graphRef` pointed at a file that no longer
exists — but no replacement was built and none is promised.

If you consume one of them, open an issue describing the use. It will be built against a stated
need rather than guessed at.

The manifest also declared three levels that never carried information: `L2_process` with a null
`processGraphRef`, `L3_transition` as a bare `reserved: true`, and `L4_component` as a permanently
empty array. They shipped in that state from `0.1.0` and are not carried forward. A level appears
when something produces it.

## If you read `anatomy.json`

The entities are in `anatomy-fragment.json`. The seven bands the HTML report renders are resolved
from a view spec rather than baked into the artifact, and the resolution is proven to reproduce
exactly the band membership, emptiness, notes and caveats the artifact produced.

**`sf intel anatomy --json` is unchanged.** It returns the same `AnatomyArtifact` shape it always
has. 1.0 retired the file, not the payload.

## If you script against `sf intel map --json`

This is the change most likely to catch you, because it fails quietly.

`MapCommandResult` no longer carries `couplingGraph` or `manifest`:

```sh
# Before
sf intel map --target-org prod --json | jq '.result.couplingGraph.edges | length'

# After: the key is gone, and jq prints 0 and exits 0
```

A missing key yields `0`, not an error, so a pipeline reading this gets a plausible-looking zero
rather than a failure. Read `.result.fragment` instead, which was already present in `0.3.0`:

```sh
# Coupled pairs
sf intel map --target-org prod --json | jq '[.result.fragment.edges[] | select(.kind == "couples")] | length'

# Per-object measurements
sf intel map --target-org prod --json | jq '.result.fragment.contributions[] | select(.nodeId == "obj.Account")'
```

The result also carries six count fields: `flowsAnalyzed`, `apexClassesAnalyzed` and
`apexTriggersAnalyzed`, each now paired with `flowsListed`, `apexClassesListed` and
`apexTriggersListed`. The three `Listed` fields are new in 1.0. The pair is the point: the tool
reports what it analysed **against** what existed, so a run that read a fraction of the org says
so rather than presenting like one that read all of it.

## If you import the package as a library

Three exported types changed shape:

| Type | Change |
|---|---|
| `MapArtifacts` | dropped `couplingGraph` and `manifest`; carries `edges` |
| `AssembleInput` | dropped `labelOf`, `couplingProvenance` and `manifestProvenance` |
| `MapRunResult` | dropped `couplingGraph` and `manifest` |

`renderMapHtml` now takes a `CouplingView` rather than a `CouplingGraph`. `couplingViewOf` is
exported to obtain one from a fragment, so the render path stays complete:

```ts
import { runMap, couplingViewOf, renderMapHtml } from '@cclabsnz/sf-orgintel';

const result = await runMap(ctx, options);
const html = renderMapHtml({ couplingGraph: couplingViewOf(result.fragment), /* ... */ });
```

`CouplingView` drops `CouplingGraphNode.custom`, which the map report never read.

## What did not change

- Both commands remain read-only. No write path to an org exists, and a test fails the build if
  one is introduced.
- No network call goes anywhere but the authenticated org. No telemetry, no analytics, no model
  APIs. Also enforced by a test.
- The HTML reports are byte-identical to `0.3.0`, pinned by a golden captured while both render
  paths still existed.
- `sf intel probe` and `sf intel discover` are untouched.

## A worked example

`examples/` carries real 1.0 output from a seeded Developer Edition org, with the org id
substituted. See `examples/README.md` for what the org contained and what came out.

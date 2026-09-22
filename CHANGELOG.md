# Changelog

All notable changes to `@cclabsnz/sf-orgintel` are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) loosely, and the project uses
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

From `0.2.0` onward each entry mirrors the
[GitHub Release](https://github.com/cclabsnz/sf-orgintel/releases) for that tag, which is the
canonical published note and carries the provenance attestation and CycloneDX SBOM for the build.

## [Unreleased]

Both analysis commands now state **what they analysed against what they listed**, rather than a
count that implies coverage it does not have. `intel map` reported that it analysed 210 flows
without saying how many the org holds, which reads as completeness and is not. The numbers were
already known at retrieval time on both sides, so this costs no extra org read.

**If you are upgrading, expect numbers to move for an unchanged org.** `Apex classes: 412 of 412`
becomes something like `398 of 412`, because a class nobody could read is no longer counted as one
that was analysed. Nothing about the coupling analysis changed; the three deprecated artifacts
(`coupling-graph.json`, `landscape-manifest.json`, `anatomy.json`) remain byte-identical, but the
fragments do change. On a managed-heavy org, `graph-fragment.json` will show fewer `apexClass`
nodes because classes that could never be read are no longer counted as analysed.

### Added

- **`intel map` states the denominator wherever it states a count.** The HTML report reads
  `Flows analysed: 210 of 340` and `Apex classes / triggers: 398 of 412 / 27 of 29`; `--json`
  gains `flowsListed`, `apexClassesListed` and `apexTriggersListed` alongside the existing
  `*Analyzed` fields. The two answer different questions — how much of this exists, and how much
  of it reached the graph — and the difference is the coverage fact neither number states alone.
  (#25)
- **`graph-fragment.json` contributes `analysed` to `org.root`**: the flow, Apex class and Apex
  trigger counts this run actually parsed. Deliberately not the org's totals, which `intel
  anatomy` contributes to the same node as a census from `COUNT(Id)` aggregates. A consumer
  merging both fragments can now compute the gap between them, which is the reconciliation
  neither command could express on its own. (#25)
- **A refused capability count is marked in `anatomy-fragment.json`.** `collectCapabilities`
  returns `0` from a refused `COUNT(Id)` and records the refusal in the artifact's
  `coverage.unavailable`; the fragment never received that list, so a refused census contributed
  an unmarked `0` to `org.root`. A consumer subtracting analysed from census would have computed
  a negative gap with nothing in the graph explaining why. The collectors' entries now travel
  into the fragment's own `coverage.unavailable`, merged with the ones it derives itself and
  keeping `failed` distinct from `deferred`. `anatomy.json` is unchanged, byte for byte. (#25)
- **The navigation levels are now a view spec**, resolved into L0 and L1 coordinates from the
  merged graph rather than read from a stored artifact, and proven to reproduce exactly the
  coordinates `landscape-manifest.json` carries. Coordinates are the whole of the claim: the view
  resolves L0 and L1 positions, and does not reproduce the manifest's `label`, `objects`,
  `metrics`, `graphRef` or `anchorObject`. Nothing changes in what any command writes or renders
  today: the manifest is still written, and this is the replacement consumers of its coordinates
  move to before 1.0 removes it. The spec declares only the two levels that resolve, because
  `L2_process`, `L3_transition` and `L4_component` have shipped since `0.1.0` carrying a null
  reference, a bare `reserved` flag and an empty array respectively.

### Changed

- **An Apex class nobody could read no longer counts as one that was analysed.** The class path
  was a map with no drop, so the analysed figure was a copy of the listed figure and
  `Apex classes: 412 of 412` was a tautology on every successful run. A class whose body is
  withheld — the platform returns the literal `(hidden)` for managed-package code — and whose
  `SymbolTable` is withheld too has nothing for the analyser to read: it yields no objects and
  contributes no edge to either the coupling graph or the fragment. Such classes are now counted
  as listed but not analysed, dropped from the population the graph is built from, and reported
  in one aggregated note rather than one per class, which on a managed-heavy org would drown the
  report it is meant to qualify. This is the "classes nobody could read" half of the coverage gap,
  and it was previously invisible.
  Triggers are unchanged and deliberately so: a trigger whose body is withheld but whose object
  resolves still reaches the graph, as a node carrying the object it fires on and as an entry in
  that object's order-of-execution timeline. The object, not the body, is the analysable fact
  about a trigger, so an unresolvable object stays the only drop. (#25)
- **`ROADMAP.md` withdraws "give the seven counts real producers".** The seven org-wide counts are
  a census over the whole org, permanently, and stay measurements contributed onto `org.root`. A
  graph-derived count does not restate them, it understates them, by exactly the flows nobody
  activated and the classes nobody could read. What was actually missing was the reconciliation
  above, not a producer. (#25)
- `README.md` and the `0.3.0` deprecation notice now state the two different sets of terms the
  legacy artifacts are deprecated on. `coupling-graph.json` and `anatomy.json` are carried by the
  fragments; `landscape-manifest.json` is not and cannot be, because it holds computed layout
  coordinates that the canonical graph deliberately does not store. (#25)

### Fixed

- **A refused read no longer reports a measured zero.** When `FlowDefinitionView`, `ApexClass` or
  `ApexTrigger` could not be listed, the census recorded `0` and the report rendered
  `Flows analysed: 0 of 0` while `--json` emitted `"flowsListed": 0`. That asserts two false
  things at once: that the org contains none of this kind, and that every one of them was
  analysed — a stronger claim than the bare, merely uninformative `0` the tool produced before
  the census work. The listed count is now optional and left unset on every failure path, so the
  report falls back to the bare figure and the `--json` field is absent rather than zero. Absent
  is not zero, which is the same discipline `coverage.unavailable` already applies one level up.
  The refusal itself still reaches both the terminal and the report's "Not analysed" section,
  carrying the underlying Salesforce error. (#25)
- **`intel map`'s denominator and `intel anatomy`'s census are documented as different
  measurements.** They are different SObjects: the map report counts `FlowDefinitionView` rows,
  `intel anatomy` reports `SELECT COUNT(Id) FROM FlowDefinition`. A user running both commands
  can legitimately see `Flows: 340` from one and `210 of 337` from the other. Neither query
  changed; both definitions now say what they measured and name the other. (#25)

## [0.3.0] — 2026-09-15

Both analysis commands now emit their findings a second time as a **canonical graph fragment**,
in the schema `@cclabsnz/sf-orgviz` also writes, so the two tools describe one org instead of two.
This release is additive: `coupling-graph.json`, `landscape-manifest.json` and `anatomy.json` are
byte-identical to `0.2.0`, pinned by golden tests, and a consumer that does not know about the
fragments is unaffected.

### Added

- **`graph-fragment.json`, written by `sf intel map`** alongside the two existing artifacts. The
  coupling analysis is unchanged — that analysis is the command — but its output is now also
  rendered as a `CanonicalGraph` fragment. The fragment carries no object nodes on purpose:
  `sobject` is a kind `sf-orgviz` owns and the merge refuses a fragment emitting a kind belonging
  to someone else, so `couples` edges point at ids this fragment never declares. It therefore does
  not validate standalone; every such endpoint stays unresolved until an extraction is merged in,
  which is the normal case rather than a defect. (#22)
- **`anatomy-fragment.json`, written by `sf intel anatomy`**, emitting only the three kinds
  `sf-orgintel` owns: `site` (channels of type `site`), `product` (derived, carrying a rule that
  names `buildPrefixRegistry`'s mining) and `ssoConfig`. Personas, change data capture and the
  seven org-wide counts travel as attribute contributions on `profile.*`, `obj.*` and `org.root`
  rather than as new nodes, because those entities belong to `sf-orgviz` or measure the org as a
  whole. Built from the artifact's own assembled fields, so the two files cannot describe
  different products, channels or capability counts for one run. (#23)
- **The seven anatomy bands are now a view spec** — a saved selector plus band order in
  `src/anatomy/view/spec.ts` — proven to reproduce exactly the band membership, emptiness, note
  and caveats that `buildBands` produces from the same artifact. A band whose facts nobody
  collected still reads `not-collected` rather than rendering as empty. No rendering behaviour
  changed. (#23)
- **Every declined integration edge is now counted.** Unattributed edges, `RemoteProxy`
  destinations, edges with no `NamedCredential` hop to resolve a target from, and non-site
  channels each record a scope, reason and detail in `coverage.unavailable` instead of being
  silently dropped. (#23)
- Golden tests pinning `coupling-graph.json`, `landscape-manifest.json` and `anatomy.json` byte
  for byte, with provenance fixed in the fixture so the comparison is not a test of the clock.
  These are the load-bearing evidence that deriving the artifacts alongside a graph lost nothing.
  (#22, #23)

### Changed

- **Objects are classified by `@cclabsnz/sf-core`'s `roleOf`, not by a local copy.** The two
  implementations were the same function, and two implementations of one classification can
  disagree about a real org. The golden artifacts are unchanged, which is the evidence that this
  deleted a copy rather than altered a behaviour. (#22)
- `@cclabsnz/sf-core` raised to `^0.6.0` for the three new graph kinds. The golden anatomy fixture
  is byte-identical across the bump, so it is inert. (#23)
- `capabilities.changeDataCapture` contributions now target the object a change event publishes
  for, not `obj.<change-event-name>`. Both the standard and custom event naming shapes are mapped
  back to the base object. (#23)

### Fixed

- **Anatomy fragment node ids no longer collide.** `ssoConfig` and `site` ids were built from
  issuer and name, which are neither unique nor guaranteed present, and two issuer-less SSO
  configs or two unnamed sites collapsed onto one id — which makes `mergeGraphs` return a null
  graph for the entire merge. Both collectors now thread a stable key
  (`SamlSsoConfig.DeveloperName`, `Site.SiteName`), and a still-colliding pair becomes one node
  with a `coverage.unavailable` entry rather than two nodes sharing an id. (#23)
- **Integration edges resolve to a target that exists.** The fragment targeted
  `namedCredential.<endpoint>`, but `sf-orgviz` writes named credentials as
  `ncred.<DeveloperName>` and the endpoint is frequently a URL. Every such edge could never
  resolve, on every real run. An edge is emitted only where its via chain carries a
  `NamedCredential` hop, whose DeveloperName is the target; the endpoint travels as evidence. (#23)
- **`intel map`'s fragment used the wrong known-object set.** It derived `known` from the merged
  coupling edges rather than the sobject catalog `runMap` already holds, which dropped `touches`
  edges for objects that never formed a coupling pair and knocked `analyzeApex` off its
  SymbolTable branch onto the regex fallback — letting a body that merely mentions an object in
  dynamic SOQL assert a coupling the coupling graph never made. (#22)
- **`couples` edges carry honest provenance.** They were marked `source: 'metadata'`, but they are
  pairwise co-reference inferences plus a direction heuristic, not facts read off a SymbolTable or
  Flow XML. They now carry `source: 'derived'` with the rule `map.coupling.pairwise-co-reference`,
  which is what the schema's validator already required. (#22)
- `automationCounts` contributed three of its four fields; `workflowRules` was computed and then
  dropped. (#22)
- Integration edges sharing from, to and kind are grouped into one edge carrying the union of
  their endpoints, via chains, detections and attributions, instead of one edge per raw
  `IntegrationEdge`. (#23)
- Fragment nodes, edges and contributions sort by codepoint comparison rather than `localeCompare`,
  matching the merge's own ordering. (#22, #23)
- `couplingGraph.ts` is no longer treated by git as a binary file. (#22)

### Security

- `fast-uri` pin raised to `^3.1.6`, clearing four high advisories. (#21)
- A release attaches one CycloneDX SBOM, not two. (#20)

### Deprecated

- **`coupling-graph.json` and `anatomy.json` are deprecated.** They keep their shapes and their
  byte-for-byte guarantee for the whole `0.x` line. `sf-orgintel` 1.0 retires them in favour of
  `graph-fragment.json` and `anatomy-fragment.json`, which carry the same facts in a schema
  shared with `sf-orgviz`. Consumers should move to the fragments during `0.x`.
- **`landscape-manifest.json` is deprecated on different terms.** It is not duplicated by either
  fragment and cannot be: it carries computed layout coordinates, and `CONVERGENCE_SPEC.md` §1.3
  keeps derived analytics out of the canonical graph. At 1.0 its navigation levels become a view
  resolved against the merged graph at render time rather than a stored artifact. A consumer
  reading it for coordinates has no drop-in replacement and should open an issue describing the
  use, so the view can cover it.

## [0.2.0] — 2026-08-25

### Added

- **`sf intel anatomy`** — maps the org one level above coupling: which products live in it, who
  uses it on what licence, what it integrates with, and how people authenticate. Every integration
  edge records how it was *detected* and, separately, how it was *attributed* to a product, so a
  confirmed call with an unknown owner is reported as exactly that. Emits `anatomy.json`. (#7, #8)
- **View A, behind `--html`** — a seven-band layer map answering "what is in this org" in one
  screen, rendered as inline SVG in the existing report shell. Adds no org reads: it renders
  `anatomy.json` and nothing else. Also adds `--branding` and `--prepared-for`, mirroring
  `intel map`. (#10)
- **`coverage.unavailable`** — the structured counterpart to `coverage.notes`. Every collector
  that defers a read or has one refused records a stable scope key, a reason of `deferred` or
  `failed`, and the human detail. View A classifies bands and tiles from that data and never from
  note prose, so rewording a sentence can no longer change what the picture claims. (#10)

### Changed

- **`capabilities.changeDataCapture` now means enabled, not supported**, and the artifact moves to
  `version: 2`. It previously counted every `ChangeEvent` sObject the platform exposes, which is a
  property of Salesforce rather than of the org: 419 on an org with CDC switched off entirely, and
  View A drew it as the largest tile in the Ops band. It now reads
  `PlatformEventChannelMember.SelectedEntity`, covering the standard `ChangeEvents` channel and
  custom channels alike. The version bumped because the key kept its name while the number behind
  it changed by two orders of magnitude. (#12)
- A populated band now declares what it did **not** gather. Previously a band with tiles was
  classified `populated` and stopped consulting `coverage.unavailable`, so ten Site channels drew
  as a complete channel inventory while three of the four channel types had never been attempted.
  Such a band now renders "Partly collected" with the reason. (#10)

### Fixed

- **The report viewer payload can no longer close its own `<script>` element.** It was embedded as
  raw `JSON.stringify` output, which escapes neither `<` nor `/`, so a value containing
  `</script>` would end the element early and hand the remainder to the HTML parser as markup.
  Not reachable in practice, since every payload field is a Salesforce API name, but the reports
  are written to be sent to clients. (#15)
- Coverage rows each carry their own confidence label instead of sharing one. (#4)
- `edges.apexBodies` no longer marks the integration and external bands not-collected when only an
  unrelated namespaced-class count fails. (#10)

### Security

- The org-data guard now scans a pull request's own **title and body**, not just the repository
  and its commit messages. A pull request body is a public page the moment it is opened, and it
  never goes through review first. (#11)
- `js-yaml` override raised past the vulnerable range (GHSA-5p4m-2wfm-xmqj). The override
  permitted the patched version without requiring it, so the lockfile stayed on the vulnerable
  one. (#13)
- `SECURITY.md` rewritten. It was `sf-audit`'s, copied verbatim, and named the wrong package
  throughout. It also no longer overstates provenance: `0.1.0` carries no attestation. (#15)

## [0.1.0] — 2026-08-02

First published version. `sf intel discover`, `sf intel probe` and `sf intel map`: object
discovery, evidence-tier probing, and a cross-object coupling graph built from Active flows and
Apex, with a branded HTML report behind `--html`.

**This release carries no provenance attestation.** It was hand-published before npm trusted
publishing was configured for this package. Every release from `0.2.0` onward carries one
automatically. See [SECURITY.md](SECURITY.md).

[Unreleased]: https://github.com/cclabsnz/sf-orgintel/compare/v0.3.0...HEAD
[0.3.0]: https://github.com/cclabsnz/sf-orgintel/releases/tag/v0.3.0
[0.2.0]: https://github.com/cclabsnz/sf-orgintel/releases/tag/v0.2.0
[0.1.0]: https://github.com/cclabsnz/sf-orgintel/releases/tag/v0.1.0

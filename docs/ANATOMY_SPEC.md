# Design: `sf intel anatomy` phase 1

- **Date:** 2026-08-05
- **Status:** Design, approved for planning
- **Package:** `@cclabsnz/sf-orgintel`
- **Supersedes for implementation purposes:** the collector and View A portions of
  `ANATOMY_BRIEF.md`. The brief remains the statement of intent; where the two disagree, this
  document is the one that was checked against real orgs.

## 1. Scope

Phase 1 of the four the brief implies:

| Phase | Contents | This spec |
| --- | --- | --- |
| 1 | Collectors, prefix registry, attribution, `anatomy.json` | yes |
| 2 | View A, the seven-band layer map | yes |
| 3 | View B, the three-column integration map | no |
| 4 | `--lucid` Standard Import export | no |

Phases 3 and 4 both consume `anatomy.json` and neither blocks the other. Deferring View B also
defers the brief's unresolved question about six product colours inside the Bench Instrument
palette, which would otherwise gate the whole effort.

## 2. What changed after probing real orgs

The brief was written from one org. Three of its assumptions were checked against live orgs
before this design was fixed, and two of them moved.

**OmniStudio is reachable, and cheaply.** The brief treats parsing `OmniProcess` definitions as
a possible-but-costly option. In fact `OmniProcess` (510 rows) and `OmniProcessElement` (12,566
rows) are queryable through the ordinary Data API. Tooling rejects them outright with
`sObject type 'OmniProcess' is not supported`, which is the same shape as the Real-Time Event
base objects in `sf-core`: query the data API, not Tooling, and never assume the reverse.

A `REST Action` element carries `namedCredential` as a plain field in its `PropertySetConfig`
JSON. Ten of thirteen sampled had it set. Those are confirmed integration edges obtained with a
SOQL query and a `JSON.parse`, not a parser.

**Remote Action is the common case and it is a bridge, not an endpoint.** There are 128 of them
against 13 REST Actions. They carry `remoteClass` and `remoteMethod`, so the real path is
Integration Procedure to Apex class to callout. The brief did not anticipate this two-hop
route; it is now the primary way OmniStudio integration reaches a confirmed endpoint, via Apex
bodies that are being read anyway.

**The prefix registry generalises, but resolves about half the time.** Deriving candidate
prefixes by frequency and matching them against `CustomApplication` was tested on three orgs:

| Org | Org-authored components | Candidates above floor | Resolved to an app |
| --- | --- | --- | --- |
| A | 1,170 | 13 | 7 |
| B | 311 | 5 | 2 |
| C | 1,936 | 8 | 4 |

Two failures matter more than the ratio. On org C the single largest prefix, over 500 components,
matched no application at all, so the most product-shaped thing in the org would have gone
unattributed. And infrastructure namespaces (`Log`, `Logger`, `Logging`, `Trigger`, `Site`)
cleared the frequency floor everywhere, with `Log` scoring a spurious match against an
unrelated application. Frequency alone cannot distinguish a product from a utility namespace,
and a naive prefix-to-app match invents products that do not exist.

## 3. Goals and non-goals

**Goals**

- Answer, from metadata alone, what products live in the org, who uses it, what it integrates
  with, and how people get access.
- Record for every integration edge both how it was detected and how it was attributed, as
  separate facts.
- State coverage limits in the artifact and in the report, including what could not be read.
- Deterministic: same org in, same bytes out, so runs are diffable.

**Non-goals**

- No judgement. Identity posture is described, never graded. Whether an SSO configuration is
  acceptable belongs to `sf-audit`.
- No object-level coupling. That is `intel map`; anatomy links to it rather than redrawing it.
- No network egress beyond the authenticated org, including no Lucid API. Phase 4 writes a file
  for manual import.
- No LLM. Attribution is prefix matching and regex over bodies.
- No friendly renaming. API names as they are.

## 4. The artifact

`anatomy.json`, written to `--output`, is the contract. `--html` renders View A on top of it.
Rendering is optional; the JSON is not.

**Versioning.** `version` is bumped when an existing field changes meaning, not only when a field
is added or removed. A renamed field announces itself; a field that keeps its name while the
number behind it changes does not, and that is the case worth a version for. Version 2 exists for
exactly one such change, `capabilities.changeDataCapture`, described below.

```jsonc
{
  "version": 2,
  "provenance": { "generatedAt": "...", "orgId": "...", "toolVersion": "...", "apiVersion": "..." },
  "products": [
    { "key": "ACME", "label": "...", "source": "app" | "package" | "recordType",
      "componentCount": 0, "prefixes": ["ACME"] }
  ],
  "personas": [
    { "profile": "...", "licence": "...", "activeUsers": 0, "landingApp": "..." }
  ],
  "channels": [
    { "type": "site" | "app" | "console" | "api", "name": "...", "status": "..." }
  ],
  "capabilities": {
    "apexClasses": 0, "apexTriggers": 0, "flows": 0, "lwc": 0, "aura": 0,
    "platformEvents": ["Order__e"], "changeDataCapture": ["AccountChangeEvent"],
    "namedCredentials": 0, "externalDataSources": 0, "remoteSites": 0,
    "eventRelayConfigured": false
  },
  "identity": {
    "ssoConfigs": [{ "type": "saml" | "authProvider", "issuer": "...",
                     "identityMapping": "...", "userProvisioning": false }],
    "loginsByType": [{ "application": "...", "loginType": "...", "count": 0 }]
  },
  "edges": [
    {
      "endpoint": "...",
      "from": "ACME" | null,
      "via": [{ "type": "OmniProcess", "name": "..." }, { "type": "ApexClass", "name": "..." }],
      "detection": "namedCredential" | "apexCallout" | "remoteActionChain" | "endpointOnly",
      "attribution": "prefixMatch" | "packageOwner" | "unattributed"
    }
  ],
  "coverage": {
    "apexBodiesScanned": 0, "apexBodiesUnreadable": 0,
    "omniElementsScanned": 0, "omniProceduresWithIntegrationElements": 0,
    "omniElementsSkippedSuperseded": 0,
    "prefixesUnresolved": ["..."],
    "notes": ["..."],
    "unavailable": [
      { "scope": "channels.network", "reason": "deferred" | "failed", "detail": "..." }
    ]
  }
}
```

`coverage.unavailable` is the structured counterpart to `notes`, described in full in section 7:
`notes` stays prose for a human reading the terminal summary, `unavailable` is what a consumer
like View A keys off. `scope` is a stable, dotted key naming the artifact field affected (for
example `channels.network`, `capabilities.apexClasses`), `reason` distinguishes a phase that
never gathers something (`deferred`) from a read that was attempted and refused or errored
(`failed`), and `detail` carries the human explanation, including the underlying error message
where there was one. Both `notes` and `unavailable` are populated at every site that produces
one; neither replaces the other.

### 4.1 Two axes, not one tier

`detection` answers *does this call happen*. `attribution` answers *whose is it*. They are
independent, and collapsing them loses the most common honest state: a call proven by a named
credential whose owning product cannot be established.

| `detection` | Evidence |
| --- | --- |
| `namedCredential` | A `REST Action` element or a `NamedCredential` record names the endpoint |
| `apexCallout` | `callout:<name>` found in an Apex body read through Tooling |
| `remoteActionChain` | A `Remote Action` element names an Apex class in which a callout was found |
| `endpointOnly` | A `RemoteProxy` endpoint exists with no code path found to it, or a scanned element (for example a `REST Action` with no `namedCredential`) confirms an integration point exists with no endpoint determined from it |

| `attribution` | Rule |
| --- | --- |
| `prefixMatch` | A component name in `via` carries a prefix in the registry |
| `packageOwner` | The component belongs to an installed package that maps to a product |
| `unattributed` | Neither resolves. Never replaced by a guess |

`via` records the full chain in order, so a `remoteActionChain` edge shows the Integration
Procedure and the Apex class rather than collapsing to one owner. Both are real, and a reader
deciding who to talk to needs both.

## 5. Collectors

Six modules, each with one purpose, each returning a typed slice plus notes. A failing
collector records a note and returns an empty slice. It never fails the run, and it never
prevents another collector from running.

| Module | Reads |
| --- | --- |
| `collectProducts` | installed packages, `CustomApplication`, `Case`/`Account` RecordType |
| `collectPersonas` | `UserLicense`, `User` grouped by profile, permission set groups |
| `collectChannels` | `Site`, `Network`, `UserAppInfo` joined to `AppDefinition` |
| `collectCapabilities` | counts over Apex, Flow, LWC, Aura; `__e` suffix; `PlatformEventChannelMember`; `EventRelayConfig` |
| `collectIdentity` | metadata list and targeted retrieve for SSO; `LoginHistory` grouped by application and login type |
| `collectIntegrationEdges` | `NamedCredential`, `RemoteProxy`, `ApexClass.Body`, `OmniProcessElement` |

`UserAppInfo` grouped by `AppDefinitionId` gives the landing app people actually use, which is
not the configured default. `EventRelayConfig` being empty is a finding and is recorded as
`eventRelayConfigured: false`, not omitted.

Collectors perform IO. Everything after them is pure:

- `buildPrefixRegistry(components, sources) -> Registry`
- `attributeEdges(edges, registry) -> Edge[]`
- `resolveChains(omniElements, apexIndex) -> Edge[]`

Attribution is the part most likely to be wrong, so it must be unit-testable with no org.

### 5.0 Change Data Capture means enabled, not supported

Version 1 built `capabilities.changeDataCapture` from the global describe, taking every sObject
whose name ended in `ChangeEvent`. That is not a fact about the org. The platform exposes a change
event type for every object that *supports* CDC, so the list grows with the org's object count
and says nothing about whether one change event is being published anywhere. It read **419 on an
org with CDC switched off entirely**, and View A then drew that as the largest, darkest tile in
the Ops band: a capability the org does not use, rendered as its heaviest reading.

The measurement is `PlatformEventChannelMember`, which the Tooling API reference defines as "an
entity selected for Change Data Capture notifications on a standard or custom channel". One query
therefore covers both the Setup *Selected Entities* list, which is the standard `ChangeEvents`
channel, and any custom `MyChannel__chn`:

```sql
SELECT SelectedEntity FROM PlatformEventChannelMember
```

`SelectedEntity` is the change event name, for example `AccountChangeEvent`. Results are
de-duplicated, because one entity can belong to more than one channel, and sorted.

Measured across six real orgs, every one returned zero rows. An empty array is therefore the
expected reading on most orgs and is a genuine measurement, not a gap: it raises no
`coverage.unavailable` entry, and View A draws it as a measured `0`. Only a refused read does
that, under the same absent-versus-refused rule `EventRelayConfig` already follows, since
`INVALID_TYPE` on `PlatformEventChannelMember` means the feature is genuinely absent from the org.

The positive case is unverified against a live org, because none of the six had CDC enabled. It
rests on the documented behaviour of the object rather than on a reading, which is weaker evidence
than everything else in this section and is worth confirming on the first org that has CDC on.

### 5.1 Apex bodies

Read through the Tooling API, not source retrieve. On the probe org `sf project retrieve start
--metadata ApexClass` returns a fraction of classes because the rest live in managed and
unlocked packages, while `ApexClass.Body` via Tooling returns bodies for unlocked-package
classes that retrieve refuses. Keyset-paginate by `Id` and cache under the existing
version-namespaced scheme; `intel map` already memoises Apex and this reuses that.

Bodies dominate runtime: roughly 850 to 1,100 org-authored classes on the orgs measured.
Everything else is seconds. Expect a cold run comparable to `intel map` at about 1:45.

### 5.2 OmniStudio

One filtered query, not a parser:

```sql
SELECT Type, PropertySetConfig, OmniProcess.Id, OmniProcess.Name
FROM OmniProcessElement
WHERE OmniProcess.OmniProcessType = 'Integration Procedure'
  AND OmniProcess.IsActive = true
  AND Type IN ('REST Action', 'Remote Action', 'Integration Procedure Action')
```

**`OmniProcess` rows are versions, not procedures, and only the active version is read.**
Every edit to an Integration Procedure creates a new `OmniProcess` row; the old one is kept and
marked inactive rather than deleted. Reading every row therefore reports integrations that no
longer run, which is worse than a coverage gap: it is a confident, wrong statement about the
present. Measured on a live org, elements matching this query (before the `IsActive` filter
existed) broke down as:

| Elements | Distinct procedure names | Distinct `OmniProcess` ids | Active versions | On an active version | On a superseded version |
| --- | --- | --- | --- | --- | --- |
| 141 | 30 | 92 | 16 | 25 | 116 |

82 per cent of the evidence came from versions nobody runs anymore. `OmniProcess.IsActive =
true` in the query above keeps the scan to what is live; the superseded elements are not
silently narrowed away, they are counted in `coverage.omniElementsSkippedSuperseded` and
summarised in a coverage note, following the same rule as every other exclusion in this
collector. `coverage.omniProceduresWithIntegrationElements` counts distinct procedure *names* among the
active-version elements, not distinct `OmniProcess` ids: counting ids conflates version churn
with procedure count. On the org above, id-counting reported 92 (before the `IsActive` filter)
where the org has 30 procedures; even after restricting to active versions, several elements can
still share one procedure across its 16 active `OmniProcess` rows, so counting ids would still
overstate the number of procedures involved.

That is roughly 150 rows out of 12,566 before the active-version filter. `REST Action` yields
`namedCredential` directly. `Remote Action` yields `remoteClass`, which is looked up in the Apex
index built in 5.1; if a callout is found there the edge becomes `remoteActionChain`, otherwise
the Integration Procedure is recorded with no endpoint and counted in coverage. A `Remote
Action` whose config carries no `remoteClass` is a real element that was examined and found to
carry nothing usable: it is still emitted as an edge with `endpoint: null` and its `via` hop
intact, never dropped, because an element that is scanned and then discarded without a trace is
the one failure this artifact must never commit. A `REST Action` whose config carries no
`namedCredential` gets the same treatment, but not the same `detection` value: labelling it
`namedCredential` asserts a named endpoint was found when none was, which on a live org happened
for three of thirteen `REST Action` elements. It is emitted as `endpointOnly` instead, the value
that already means "one side of an integration relationship is confirmed, the other is not",
generalised from its original RemoteProxy-only case rather than adding a fifth detection value.
`Integration Procedure Action` elements chain one Integration Procedure to another and carry no
endpoint of their own; they are counted in `omniElementsScanned` and summarised in a coverage
note rather than turned into invented edges.

`DataRaptor Post Action` elements carry a `sourceSystem` key and there are 52 of them on the
probe org. Not used in phase 1, and noted here so it is not rediscovered as novel later.

**The stored `Type` value is `Rest Action`, not `REST Action`.** SOQL string comparison is
case-insensitive, so the `IN` filter above matches regardless, but any code branching on the
returned value must compare case-insensitively. Taking the literal from a query rather than
from returned data cost a full round here: all thirteen REST Action elements were silently
routed to the Remote Action branch, dropped for having no `remoteClass`, and still counted in
`omniElementsScanned`. Reporting something as scanned while discarding it is the one failure
this artifact must never commit.

### 5.3 The prefix registry

1. Collect org-authored component names, namespace-free.
2. Derive candidate prefixes: leading token before `_` or a lower-to-upper camel boundary.
3. Merge candidates that are prefixes of one another, so `Log` and `Logger` do not compete.
4. Drop a utility denylist: `log`, `logger`, `logging`, `trigger`, `test`, `util`, `utils`,
   `helper`, `batch`, `sched`, `mock`, `wrapper`, `const`, `base`, `common`, `email`, `data`,
   `site`. Matched case-insensitively and whole-token only.
5. Keep candidates at or above a floor of `max(3, 1% of components)`.
6. **A candidate becomes a product only if it also matches a source**: a `CustomApplication`
   developer name, an installed package name or namespace, or a `Case`/`Account` record type
   developer name. Frequency alone never creates a product.
7. Candidates that clear the floor and match nothing go to `coverage.prefixesUnresolved`.

Step 6 is the rule that keeps the registry honest, and step 7 is what stops a 500-component
prefix from disappearing silently because no application happened to be named after it.

## 6. View A

Seven bands of tiles, rendered as inline SVG in the existing report shell, following
`DESIGN_BRIEF.md`: daylight Bench Instrument, cadmium reserved for selection.

Bands, top to bottom: users, channels, products, platform capabilities, integration methods,
external systems, ops and security.

Layout gets its own small module rather than reusing `computeStrataLayout` from
`src/map/graph/strata.ts`. An earlier draft of this spec claimed View A was a simpler case of
that engine. It is not, and the claim rested on a coincidence: both have seven bands.

They are seven different things. `strata.ts` types its input as `Layer`, meaning
`integration | configuration | business | content | sharing | security | observability`, which
classifies Salesforce objects. View A's bands classify products, personas and external systems.
The two sets share no members.

Beyond the taxonomy, `computeStrataLayout` exists to minimise edge crossings by barycentre
sweeps, and it returns points. View A has no edges between bands to minimise and needs sized
tiles, not points: product tiles scale by component count and licence tiles carry a
used-of-total bar. Reusing it would mean widening `StrataObject.layer` into a union meaning two
unrelated things, and driving a graph engine to lay out a table.

The dedicated module is small: fixed bands, tiles flowed within each band, sized by a supplied
metric. Pure, so it is testable without rendering any markup, which is how every other layout
in this codebase is arranged.

Three rules, carried from the coverage work already shipped in the map report:

- Every number is a measured reading. Licence tiles carry used-of-total as a filled bar,
  product tiles are sized by component count. No floating figures. The one exception is a tile
  whose count could not be measured at all: `capabilities` and `ops` render a fixed set of
  tiles every run (an absent capability is a finding, not an omission), so when the read behind
  one of those counts fails, `Tile.unavailable` is `true` and the tile's `metric` is the
  placeholder `0` it falls back to, not a measured zero. A renderer must show that tile
  differently, for example greyed out or hatched rather than filled, precisely because its `0`
  is a stand-in for "we do not know", the same distinction `not-collected` draws for a whole
  band, drawn here for one tile inside a band that is otherwise populated. Every tile outside
  those two fixed sets always carries `unavailable: false`, because it only exists at all when
  its source record was actually collected.
- Absence renders explicitly. "No Event Relay configured" gets a slot. A band with no contents
  says it is empty rather than collapsing, because a missing band reads as *not checked*.
- Partial collection renders explicitly too, and this is a separate rule because the first pass
  missed it. `emptiness` answers "was this gathered" only for a band with nothing in it, so a
  band that *has* tiles stopped consulting `coverage.unavailable` altogether. On a live org that
  drew ten Site channels as though they were the org's whole channel inventory, while three of
  the four channel types and the Network join had never been attempted, both of them recorded in
  `coverage.unavailable` and both ignored because the band had tiles. A populated band therefore
  carries `BandContent.caveats`, the details of every `coverage.unavailable` entry in its own
  scope list, and renders them on the band as "Partly collected", the same admission as
  "Not collected" scoped smaller. The coverage section stating the same gap above the drawing is
  not sufficient on its own: the band is what a reader looks at, and an uncaveated band is a
  claim of completeness.
- A coverage section sits above the bands, stating Apex bodies scanned against unreadable,
  OmniStudio elements scanned, and unresolved prefixes. With prefix resolution around half,
  this is load-bearing rather than a footnote.

On a small single-product org View A is a short table. That is acceptable. A band silently
vanishing is not.

### 6.1 What the artifact records and what the drawing shows are different jobs

`coverage.unavailable[].detail` is the record, and it keeps the platform's error text verbatim,
including the parts nobody wants to read. The drawing is a presentation of that record, and it
gets one line of a fixed width, so it may shorten what it shows. Neither may change what the
record says.

Two rules follow, both found by putting a real platform error on a band for the first time
(section 9b), and both applied to the drawing only:

- **Flatten.** An SVG `<text>` node has no line breaks. A malformed-query error arrives as
  several lines carrying a fragment of the query and a caret pointing at a column, and every
  newline in it renders as a space, so the caveat came out as a smear of query internals.
- **Lead with the reason.** The platform echoes the query first and says what was wrong with it
  last, after an `ERROR at Row:N:Column:N` marker. Flattened but untrimmed, the line opened with
  a column list and ran out of width before reaching `sObject type 'OmniProcessElement' is not
  supported`, which is the only part that explains the gap. For display, the text between the
  collector's own introduction and that marker is dropped.

The trim may only ever shorten a platform error. A detail carrying no marker is left alone, so a
sentence a collector wrote deliberately is never rewritten, and the full text stays reachable in
the coverage table above the drawing and in the element's `<title>`.

## 7. Error handling

| Condition | Behaviour |
| --- | --- |
| A collector throws | Note recorded, empty slice returned, run continues |
| `OmniProcess` not present (org without OmniStudio) | Note recorded, zero elements scanned, no error |
| Apex body unreadable | Counted in `apexBodiesUnreadable`, class excluded from the index |
| `Remote Action` names a class with no readable body | Edge recorded with no endpoint, counted in coverage |
| SSO metadata retrieve fails | `ssoConfigs: []` with a note; `loginsByType` still collected |
| No prefix resolves | Every edge is `unattributed`. A valid, reportable outcome |

Nothing here escalates to a failed command. An org that yields little should produce a small,
honest artifact.

### 7.1 Unavailability is data, not prose

Every row in the table above ends the same way: a collector pushes a human-readable line onto
`coverage.notes`. That line is necessary, it is what an operator reads in the terminal summary,
but it is not sufficient on its own, because it is the *only* place the "we checked and found
nothing" versus "we could not check" distinction lived through the first pass at View A. The
band layer recovered that distinction by matching fragments of note text against a small table
of regexes, and that broke in two ways once real collectors exercised it:

- **Coverage was incomplete by construction.** Only the `channels` band had a matching rule
  wired up, because it was the only one anyone thought to add. When `collectProducts`'s reads
  failed, the `products` band fell through to `emptiness: 'empty'`, which tells a reader the org
  has no products, while the note explaining the read failure sat unused in `coverage.notes`.
  The same gap existed for `integration` and `external` whenever edge collection failed. Adding
  a rule per band as each gap was noticed does not scale to seven bands and does not survive a
  new collector being added without someone remembering to also add its matching rule.
- **Matching prose is brittle by construction, not by accident.** A rule keyed on "does this
  note contain these words" breaks the moment a note is reworded for clarity, and nothing at
  compile time or in a type signature says so. The two properties this artifact promises,
  determinism and a reader's ability to trust the distinction between absence and non-collection,
  cannot rest on a sentence staying phrased exactly one way indefinitely.

`coverage.unavailable` (section 4) exists to fix both. Every collector that pushes a note for a
failed read or a deliberate deferral also pushes a structured `Unavailable` entry with the same
information: a stable `scope` naming the artifact field affected, a `reason` of `deferred` or
`failed`, and a `detail` carrying the human explanation. View A's band and tile classification
(section 6) reads `coverage.unavailable` exclusively; it never inspects `coverage.notes`. A band
maps to a fixed, known set of scopes (for example `products` to `products.apps`,
`products.packages`, `products.recordTypes`, `products.componentNames`), so a band with no
tiles is `not-collected` whenever a matching entry exists and `empty` otherwise, decided by
exact key membership rather than a guess about phrasing. The one asymmetry worth calling out
explicitly: `personas.landingApp` is an unconditional, field-level deferral (this phase never
gathers a landing app) that must not mark the whole `users` band `not-collected`, because
`activeUsers`, the metric that band actually renders, is collected for real on every run. The
scope key stays a dotted, field-level `personas.landingApp` rather than the category-level
`personas`, and the `users` band's scope list simply never includes it, so the distinction is
carried by the shape of the key rather than by a special case in the classifier.

`notes` and `unavailable` are complementary, not redundant: `notes` is written for a human,
`unavailable` for a program, and deleting either would lose something. `notes` keeps its
existing entries verbatim; nothing here removes a note that was there before.

## 8. Testing

Unit tests with mocked clients, per the repo convention. No test touches an org.

- `buildPrefixRegistry`: the denylist drops utility namespaces; `Log`/`Logger` merge; a
  candidate above the floor with no source match lands in `prefixesUnresolved` and not in
  `products`; frequency alone never produces a product.
- `attributeEdges`: a confirmed detection with no resolvable prefix stays `unattributed`; the
  two axes vary independently.
- `resolveChains`: a `Remote Action` naming a class with a `callout:` becomes
  `remoteActionChain` with both hops in `via`; naming an unreadable class does not.
- `collectIntegrationEdges`: the OmniStudio query is restricted to `OmniProcess.IsActive =
  true`; excluded (superseded-version) elements are counted in
  `omniElementsSkippedSuperseded` and noted, never silently dropped;
  `omniProceduresWithIntegrationElements` counts distinct procedure names among active-version
  elements, not distinct `OmniProcess` ids, so several active versions sharing one name still
  count once; a `REST Action` with no `namedCredential` is emitted as `endpointOnly`, not
  `namedCredential`.
- Report: coverage renders above the bands; an empty band renders as empty; notes are escaped.
- Invariants: `readonly-invariant` and `network-egress` unchanged and passing.

Fixtures are built from the *shapes* observed on the three probe orgs, not their data.

## 9. Acceptance

1. Runs read-only against a **sandbox** and produces `anatomy.json`. Production is not the
   first org a new collector meets.
2. Byte-identical output across two consecutive runs on an unchanged org.
3. Every edge carries both axes, and `unattributed` is never replaced by a plausible owner.
4. Coverage states what was not read: unreadable Apex bodies, unresolved prefixes, OmniStudio
   elements skipped.
5. **Validated against at least two orgs** before the registry heuristic is trusted. The brief
   asked this of `Case.RecordType` only; the probe showed the registry needs it more.
6. Read-only and network-egress invariants pass.

## 9a. Measured on two orgs

Both runs read-only, both deterministic across consecutive runs.

| | Org A | Org B |
| --- | --- | --- |
| Products | 5 (2 app, 3 recordType) | 2 (1 app, 1 package) |
| Personas | 12 | 13 |
| Integration edges | 171 | 18 |
| Unattributed | 64 (37%) | 12 (67%) |
| Apex bodies scanned / unreadable | 855 / 0 | 233 / 0 |
| OmniStudio elements (pre `IsActive` filter) | 141 (25 active / 116 superseded) | 0 |

Org A's OmniStudio figure predates the `OmniProcess.IsActive` filter described in 5.2 and is
kept here as the measurement that motivated it: of the 141 elements, only 25 sat on an active
version, across 16 active `OmniProcess` rows covering 30 distinct procedures. `Integration
edges` above reflects the un-filtered run for the same reason; a re-run against the active-only
query reports fewer edges, not because the org integrates with less but because the artifact no
longer counts versions nobody runs.

Org B has no OmniStudio, which exercised the absent-feature path: zero elements scanned, no
error, no note beyond the honest zero. It also supplied the only `package`-sourced product seen
so far.

The unattributed proportion is the number to watch. At 37 and 67 per cent it is the headline
finding on both orgs, which is the intended behaviour rather than a defect: the tool says what
it established and no more.

`SamlSsoConfig` was not queryable on either org, so `ssoConfigs` was empty both times with a
note saying why. The login-type distribution still populates, so the identity section is not
wholly blind.

### 9b. The absence paths, measured on a third org

Orgs A and B populated all seven bands and neither had a failed capability read, so View A's
absence paths went unexercised by both. They were run against a stock Developer Edition org,
which is thin by construction and is not a client org.

| Path | Reached | What rendered |
| --- | --- | --- |
| Empty band | yes, `products` | "None found. This band was collected and the org has none." |
| Not-collected band | yes, `channels` | "Not collected." plus the deferral detail |
| Partly-collected caveat, from a **failed** read | yes, `integration` and `external` | "Partly collected." plus the platform's reason |
| Hatched not-read tile | **no** | every capability read succeeded |

Tiles reconcile: 4 + 0 + 0 + 8 + 1 + 1 + 3 = 17, matching the drawing. Two consecutive runs are
byte-identical in both `anatomy.json` and the HTML apart from the generated timestamp.

The caveat path had only ever been reached by a *deferral* before this, where the detail is a
sentence this project wrote. Reaching it by a *failure* put a platform error on a band for the
first time and exposed a rendering defect described in section 6.1.

**The hatched not-read tile remains unverified against a live org.** It has unit tests and
fixture renders behind it and nothing else. Reaching it needs an org where a capability count is
refused rather than absent, which none of the three orgs measured so far provides. This is
stated rather than left implied, because a path that has never run against a real refusal is
exactly the kind of thing a reader would otherwise assume was covered by "verified on three
orgs".

## 10. Open questions

- Does `Case.RecordType` map to business process outside the org it was observed on? Untested.
  Phase 1 records record types as a registry source regardless, so nothing depends on the
  answer yet.
- `DataRaptor Post Action.sourceSystem` may name external systems directly. Worth measuring
  before phase 3 assumes the edge set is complete.
- Whether `products[].componentCount` should count flows and Apex equally. Currently equal,
  which over-weights Apex-heavy products.
- Prefix candidates that clear the floor but name infrastructure rather than a product
  (`COMMUNITIES`, `LIGHTNING`, `USER` were all seen) land in `prefixesUnresolved`. Correct, in
  that none became a product, but the list is noisier than a reader would like.

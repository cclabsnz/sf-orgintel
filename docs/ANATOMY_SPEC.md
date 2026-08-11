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

```jsonc
{
  "version": 1,
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
    "platformEvents": ["..."], "changeDataCapture": ["..."],
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
    "prefixesUnresolved": ["..."],
    "notes": ["..."]
  }
}
```

### 4.1 Two axes, not one tier

`detection` answers *does this call happen*. `attribution` answers *whose is it*. They are
independent, and collapsing them loses the most common honest state: a call proven by a named
credential whose owning product cannot be established.

| `detection` | Evidence |
| --- | --- |
| `namedCredential` | A `REST Action` element or a `NamedCredential` record names the endpoint |
| `apexCallout` | `callout:<name>` found in an Apex body read through Tooling |
| `remoteActionChain` | A `Remote Action` element names an Apex class in which a callout was found |
| `endpointOnly` | A `RemoteProxy` endpoint exists with no code path found to it |

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
| `collectCapabilities` | counts over Apex, Flow, LWC, Aura; `__e` and `ChangeEvent` suffixes; `EventRelayConfig` |
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
  AND Type IN ('REST Action', 'Remote Action', 'Integration Procedure Action')
```

That is roughly 150 rows out of 12,566. `REST Action` yields `namedCredential` directly.
`Remote Action` yields `remoteClass`, which is looked up in the Apex index built in 5.1; if a
callout is found there the edge becomes `remoteActionChain`, otherwise the Integration
Procedure is recorded with no endpoint and counted in coverage. A `REST Action` whose config
carries no `namedCredential`, and a `Remote Action` whose config carries no `remoteClass`, are
both real elements that were examined and found to carry nothing usable: each is still emitted
as an edge with `endpoint: null` and its `via` hop intact, never dropped, because an element
that is scanned and then discarded without a trace is the one failure this artifact must never
commit. `Integration Procedure Action` elements chain one Integration Procedure to another and
carry no endpoint of their own; they are counted in `omniElementsScanned` and summarised in a
coverage note rather than turned into invented edges.

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

Layout reuses `computeStrataLayout` from `src/map/graph/strata.ts`. View A is a simpler case of
the band packing already implemented there; a second layout engine is not warranted.

Three rules, carried from the coverage work already shipped in the map report:

- Every number is a measured reading. Licence tiles carry used-of-total as a filled bar,
  product tiles are sized by component count. No floating figures.
- Absence renders explicitly. "No Event Relay configured" gets a slot. A band with no contents
  says it is empty rather than collapsing, because a missing band reads as *not checked*.
- A coverage section sits above the bands, stating Apex bodies scanned against unreadable,
  OmniStudio elements scanned, and unresolved prefixes. With prefix resolution around half,
  this is load-bearing rather than a footnote.

On a small single-product org View A is a short table. That is acceptable. A band silently
vanishing is not.

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

## 8. Testing

Unit tests with mocked clients, per the repo convention. No test touches an org.

- `buildPrefixRegistry`: the denylist drops utility namespaces; `Log`/`Logger` merge; a
  candidate above the floor with no source match lands in `prefixesUnresolved` and not in
  `products`; frequency alone never produces a product.
- `attributeEdges`: a confirmed detection with no resolvable prefix stays `unattributed`; the
  two axes vary independently.
- `resolveChains`: a `Remote Action` naming a class with a `callout:` becomes
  `remoteActionChain` with both hops in `via`; naming an unreadable class does not.
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
| OmniStudio elements | 141 | 0 |

Org B has no OmniStudio, which exercised the absent-feature path: zero elements scanned, no
error, no note beyond the honest zero. It also supplied the only `package`-sourced product seen
so far.

The unattributed proportion is the number to watch. At 37 and 67 per cent it is the headline
finding on both orgs, which is the intended behaviour rather than a defect: the tool says what
it established and no more.

`SamlSsoConfig` was not queryable on either org, so `ssoConfigs` was empty both times with a
note saying why. The login-type distribution still populates, so the identity section is not
wholly blind.

## 10. Open questions

- Does `Case.RecordType` map to business process outside the org it was observed on? Untested.
  Phase 1 records record types as a registry source regardless, so nothing depends on the
  answer yet.
- `DataRaptor Post Action.sourceSystem` may name external systems directly. Worth measuring
  before phase 3 assumes the edge set is complete.
- Whether `products[].componentCount` should count flows and Apex equally. Currently equal,
  which over-weights Apex-heavy products.
- `capabilities.changeDataCapture` counts every `ChangeEvent` sObject the platform exposes,
  419 on one org, not the channels actually enabled. That overstates a capability, and needs a
  decision about what CDC capability should mean before the number is shown to anyone.
- Prefix candidates that clear the floor but name infrastructure rather than a product
  (`COMMUNITIES`, `LIGHTNING`, `USER` were all seen) land in `prefixesUnresolved`. Correct, in
  that none became a product, but the list is noisier than a reader would like.

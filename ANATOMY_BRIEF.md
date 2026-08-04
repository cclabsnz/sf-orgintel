# Feature Brief: Org Anatomy

> Proposed. Not implemented. Written 4 Aug 2026 after hand-building the equivalent output for
> `poph-prod` to answer a live architecture-review session.

## Why

`sf intel map` answers *"which objects are coupled, and by what automation."* That is the right
question for an architect already inside the org. It is the wrong question for the meeting that
actually happens first — a governance forum, a vendor review, a new platform lead's week one —
where the questions are:

- What products live in this org, and how big is each?
- Who uses it, on what licence, and what do they land on?
- What does it integrate with, and which product owns each integration?
- How do people get access, and how do they lose it?

Those were answered for POPH by hand: roughly forty ad-hoc SOQL, Tooling and metadata reads,
then a hand-drawn Lucid diagram. It took an afternoon and it is stale the moment the org
changes. Every one of those reads is deterministic and already within OrgIntel's read-only
envelope. This is a collector-and-renderer problem, not a research problem.

**One level above `map`.** `map` operates on objects and automation. Anatomy operates on
products, personas, capabilities and external systems. Same org, coarser grain, different
audience — and the two should share the graph vocabulary, not duplicate it.

## The two views

### View A — layer map

Seven bands, top to bottom, each a row of tiles. Answers *"what is in this org"* in one screen.

| Band | Contents |
| --- | --- |
| Users | Personas with licence type and active count |
| Channels | Experience Cloud sites, Lightning apps, consoles, API surfaces |
| Products | The solution domains, sized by case/record volume |
| Platform capabilities | Health Cloud, OmniStudio, Flow, Apex, LWC, events, identity, Shield |
| Integration methods | Outbound REST, inbound API, platform events, CDC, bulk, Connect |
| External systems | What the org talks to |
| Ops and security | Logging, monitoring, backup, DevOps |

### View B — integration map

Three columns, read left to right. Answers *"which product reaches out to what."*

- **Left** — systems only one product uses, placed level with their owner. Short lines, no crossings.
- **Middle** — the products, each with a colour identity carried into every line it owns.
- **Right** — shared services, each drawn once and labelled with its consumers.

The left/right split is the point. Drawn as one panel per product, every shared service repeats
six times and the reader cannot see what is common infrastructure versus what is product-specific.
On POPH the split immediately surfaced that *every shared service routes through MuleSoft and
every direct REST callout is product-specific* — a real architectural statement that the
per-product layout hid.

## Where the data comes from

All read-only. All already permitted by the envelope in `PERMISSIONS.md`. Grouped by collector.

**Products and channels**
- `sf package installed list` — installed and unlocked packages
- `CustomApplication` (Tooling) — apps, labels, descriptions; `NamespacePrefix = null` isolates the org's own
- `Site`, `Network` — Experience Cloud sites, status, URL prefix
- `UserAppInfo` grouped by `AppDefinitionId`, joined to `AppDefinition` — the *actual* landing app distribution, not the configured default

**Personas**
- `UserLicense` where `TotalLicenses > 0` — entitlement versus consumption
- `User` grouped by `Profile.Name` where `IsActive = true`
- `PermissionSetGroup`, `PermissionSet` counts

**Products by size**
- `Case` grouped by `RecordType.Name` — on POPH this mapped one-to-one onto business processes
- `Account` grouped by `RecordType.Name` — reveals the person-account shape
- Row counts on the anchor objects `discover` already ranks

**Capabilities**
- Counts over `ApexClass`, `ApexTrigger`, `FlowDefinition`, `LightningComponentBundle`, `AuraDefinitionBundle`, `PermissionSet`, `ConnectedApplication`, `NamedCredential`, `ExternalDataSource`, `RemoteProxy`
- `sf sobject list` filtered to `__e` and `ChangeEvent` suffixes — platform events and CDC
- `EventRelayConfig`, `PlatformEventChannel` — **absence is a finding.** Both empty on POPH, which bounds who can consume the delivery allocation.

**Identity**
- `AuthProvider` and `SamlSsoConfig` are not SOQL-queryable. Use `sf org list metadata` then a
  targeted retrieve. The retrieved XML gives issuer, login URL, `identityMapping` and
  `userProvisioning` — enough to state the SSO posture precisely.
- `LoginHistory` grouped by `Application`/`LoginType` — what people *actually* authenticate with.
  On POPH this contradicted the assumed posture: community username/password logins outnumbered
  community SSO roughly eleven to one.

**Integration edges**
- `NamedCredential` (Tooling) — endpoint plus the name, which carries the product prefix
- `RemoteProxy` (Tooling) — outbound endpoints not behind a named credential; this is where
  Google Places and ArcGIS surfaced
- `ApexClass.Body` via Tooling, regex `callout:([A-Za-z0-9_]+)` — the only *confirmed* edges

## Product attribution — the actual hard part

Everything above is mechanical. Deciding **which product owns an integration** is not, and
getting it wrong in a governance forum is worse than saying "unknown."

The proposal is a three-tier confidence model, reusing the vocabulary already in
`src/map/types.ts` rather than inventing a parallel one.

| Tier | Rule | Rendering |
| --- | --- | --- |
| `confirmed` | An Apex body contains `callout:<credential>` and the class's prefix resolves to a product | Heavier stroke, darker fill, labelled |
| `inferred` | The credential or remote-site *name* carries a product prefix (`APH_Cloudhub_NHI` → APHOS) | Normal stroke |
| `unattributed` | Endpoint is live but no prefix resolves | Grey, dashed, in its own band — **never guessed** |

The prefix registry is derived, not hardcoded: tokenise custom component names, take prefixes
appearing above a frequency floor, and match them against `CustomApplication` developer names
and installed package names. On POPH that yields `AIRNG`, `APH`, `NDMS`, `NIS`, `SPS`, `AIR`
without a config file.

**Two things learned the hard way, both of which will bite the implementation:**

1. **Most integration logic is unreachable as source.** `sf project retrieve start --metadata
   ApexClass` returned 243 of 2,367 classes on POPH — the rest live in managed and unlocked
   packages. But `ApexClass.Body` via the **Tooling API** returns bodies for unlocked-package
   classes that retrieve refuses. The confirmed tier must read bodies through Tooling, in
   keyset-paginated chunks, never via source retrieve.

2. **OmniStudio holds callouts that Apex does not.** Integration Procedures make HTTP calls that
   no Apex regex will ever see. On POPH this is why only two edges reached `confirmed` out of
   sixteen. Either parse `OmniProcess` definitions or state the coverage limit on the report —
   silently reporting two confirmed edges as though that were the whole picture is the failure
   mode to avoid.

## Rendering

Both views obey `DESIGN_BRIEF.md` — Bench Instrument, daylight, calibrated. Specifically:

- Inline SVG in the report shell, same pattern as `src/report/strataViewer.ts`. Reuse
  `src/map/graph/layout.ts` for the band packing; View A is a simpler case of the strata layout
  already implemented in `src/map/graph/strata.ts`.
- **Cadmium is selection only.** Product identity colours on View B must come from the graphite
  ramp plus hue variation that is clearly not `--cad`. Six distinguishable product colours inside
  a Rams palette is the open design problem — resolve it before writing markup, not during.
- Every count on screen is a measured reading: licence tiles carry used-of-total as a filled bar,
  product tiles carry record volume as size. No floating numbers.
- Absence renders explicitly. "No Event Relay configured" is a finding and gets a slot, not silence.
- `test/unit/invariants/network-egress.test.ts` must still pass. No exceptions.

## Lucid export

The POPH diagram was built through Lucid's MCP server. **OrgIntel must not do that.** A network
call to Lucid breaks both the no-egress invariant and the local-first claim printed on the
chassis, and those are the reasons anyone trusts this tool with a production org.

Instead: `--lucid` writes `<org>-anatomy.lucid.json` in Lucid **Standard Import** format to disk.
The operator imports it manually if they want an editable diagram. The plugin never opens a socket
to anything but the authenticated org.

Standard Import is a documented, stable JSON schema — pages, shapes with bounding boxes, lines
with shape endpoints, `rectangleContainer` for bands, `table` for matrices. The hand-built POPH
document is a working reference for the exact shape of that payload.

## Command shape

Proposed as a fourth command rather than a flag on `map`, because the collectors barely overlap
and the audience is different:

```
sf intel anatomy --target-org poph-prod --html --lucid
```

Flags follow the existing convention: `--html`, `--output`, `--branding`, `--prepared-for`,
`--refresh`, `--json`. Cache under the same version-namespaced scheme as `probe` and `map`.

## Non-goals

- **Not a security review.** Guest-user exposure, OWD and sharing stay in `sf-audit`.
- **Not object-level coupling.** That is `map`, and anatomy should link to it rather than redraw it.
- **No LLM.** Attribution is prefix-matching and regex over bodies. Deterministic, same org in,
  same diagram out — which is also what makes the output diffable across runs.
- **No friendly renaming.** `AIRNG_ImmsQualityEvent__e`, not "immunisation quality events."

## Acceptance

1. Runs read-only against `poph-prod` and reproduces the two views without hand-editing.
2. Byte-identical output across two consecutive runs on an unchanged org.
3. Every integration edge carries a confidence tier, and unattributed endpoints appear in their
   own band rather than being assigned a plausible owner.
4. Coverage limits stated on the report — how many Apex bodies were scanned, how many OmniStudio
   definitions were not.
5. `--lucid` output imports into Lucid without manual repair.
6. Network-egress invariant still passes.

## Open questions

- Six product colours inside the Bench Instrument palette without touching cadmium — is that
  achievable, or does View B need a different encoding for product identity (position, texture,
  label rail) instead of hue?
- Does anatomy earn a fourth command, or is it `map --anatomy`? Leaning fourth command; the
  collectors share almost nothing with the coupling pipeline.
- Is `Case.RecordType` → business process a POPH coincidence or a pattern worth generalising?
  Test against a second org before hardcoding the assumption.

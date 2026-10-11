# Roadmap

What this plugin intends to do next, and what it does not intend to do. This is a statement
of current direction, not a set of commitments or dates.

Current published version: **2.0.0**. Everything on `main` is released; see
[CHANGELOG.md](CHANGELOG.md).

## Now

- **Org-wide counts are a census, and stay measurements.** Settled rather than open: `flows`,
  `apexClasses`, `apexTriggers`, `lwc`, `aura`, `externalDataSources` and `remoteSites` are exact
  `COUNT(Id)` aggregates over the whole org, while the graph holds only what was analysed
  (`intel map` parses Active flows only and can lose `ApexClass` access entirely). A graph-derived
  count understates rather than restates. What was missing is the reconciliation: the tool knows
  both numbers and reported one.
- ~~**A refusal can still read as a measurement.**~~ Fixed after 2.0.0, using the refused
  `Organization` read as the signal that the user cannot see setup. Original note: Every View A path is now verified against a
  live org, but the restricted-user run that verified them (`ANATOMY_SPEC.md` 9b) found two gaps.
  `isAbsentSObjectError` takes "sObject type 'X' is not supported" to mean the feature is absent,
  yet the platform says exactly that to a user without View Setup, so Change Data Capture and Event
  Relay can draw a confident `0` that was never measured. And `FlowDefinition` is filtered rather
  than refused for such a user: the count succeeds, returns 0 against an admin's 4, and draws as a
  measured zero. The first needs a signal that separates the two meanings of one message; the
  second needs the collector to know the user's visibility is partial at all.

## Next

- **View B, the integration map.** Blocked on an unresolved design question rather than on
  effort: six distinguishable product colours are needed inside the Bench Instrument palette
  without touching cadmium, which `DESIGN_BRIEF.md` reserves for selection only.
- **Close the remaining artifact overstatements.** `capabilities.changeDataCapture` has been
  corrected to mean enabled rather than supported; the same scrutiny has not yet been applied
  to every other capability count.
- **`endpointOnly` is ambiguous.** It currently covers two distinct evidence shapes — a
  configured endpoint with no caller found, and an element with no resolvable endpoint. They
  are distinguishable via `via[0].type`, but that is undocumented and View A may render both
  under one badge.
- **Branch coverage.** Statements are at 87%, branches nearer 76%, and the gap sits in error
  paths, which is exactly where the absent-versus-refused distinction lives.

## Known issues

- **`crossDomainEdges` (`src/map/view/resolve.ts`) can let input order change L0 coordinates.**
  It deduplicates cross-domain links on a canonical `a < b ? a|b : b|a` key, but pushes
  `{ from: a, to: b }` in whichever direction the edge that won the dedupe arrived in, while the
  final sort orders the result by `from + to`. Two edge lists that agree on the same undirected
  pairs but disagree on which direction each pair first appears in can therefore sort differently,
  moving the L0 landscape's layout. It is not reachable today: `mergeEdges` emits one deterministic
  edge order per org, and nothing in `src/` calls `resolveNavigationView` yet, so no run can
  observe two different orderings of the same org. That is why it was left unfixed here rather
  than changed inside a retirement release that should not also move coordinates. The fix is one
  line — normalise the pushed pair the same way the key already is:
  `out.push(a < b ? { from: a, to: b } : { from: b, to: a })` — and should be made by whoever
  first wires this view into a command, since landing it moves L0 coordinates for any org whose
  edge order was depending on the bug.

## Not planned

Recorded so nobody proposes them as oversights:

- **Any write path to a Salesforce org.** Read-only is enforced by a test that fails the
  build.
- **Network calls to anywhere other than the authenticated org.** No telemetry, no
  analytics, no model APIs. Also enforced by a test.
- **Security grading.** This plugin describes an org; it does not judge it. Whether a
  configuration is acceptable belongs to `@cclabsnz/sf-audit`.
- **Sending anything to a hosted service for analysis.** The local-first property is the
  reason this tool can be pointed at a production org at all.

## How to influence this

Open an issue. A concrete case from a real org carries more weight than a feature request in
the abstract: every serious defect in this codebase was found by running against real data or
by chasing a number that did not reconcile, never by a failing unit test.

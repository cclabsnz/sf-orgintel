# Roadmap

What this plugin intends to do next, and what it does not intend to do. This is a statement
of current direction, not a set of commitments or dates.

Current published version: **0.1.0**. Substantial work has landed on `main` since, listed in
[CHANGELOG.md](CHANGELOG.md) under Unreleased.

## Now

- **Release 0.2.0.** `0.1.0` is the only published version and carries no provenance
  attestation, so every installable copy today is unverifiable. Everything needed is already
  configured; the release simply has to be cut. This is the single highest-value open item.
- **View A hardening on more orgs.** Three of View A's paths are still exercised only by
  fixtures, because neither verification org triggered them: the empty band, the
  not-collected band, and the hatched not-read tile. They need an org that is missing a
  feature before they can be trusted.

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

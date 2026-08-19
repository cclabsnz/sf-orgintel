# Changelog

All notable changes to `@cclabsnz/sf-orgintel` are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) loosely, and the project uses
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

From `0.2.0` onward each entry mirrors the
[GitHub Release](https://github.com/cclabsnz/sf-orgintel/releases) for that tag, which is the
canonical published note and carries the provenance attestation and CycloneDX SBOM for the build.

## [Unreleased]

Merged to `main`, not yet released.

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

[Unreleased]: https://github.com/cclabsnz/sf-orgintel/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/cclabsnz/sf-orgintel/releases/tag/v0.1.0

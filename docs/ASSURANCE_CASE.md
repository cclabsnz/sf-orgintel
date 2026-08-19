# Assurance case

An argument that `@cclabsnz/sf-orgintel` is secure enough for what it does, with the evidence
for each claim and the limitations accepted rather than solved. Every claim names the
mechanism that would fail if the claim stopped being true.

This is the security-relevant design document referred to by [SECURITY.md](../SECURITY.md).

## What this software does, and what could go wrong

This plugin reads a Salesforce org and writes artifacts describing it: `anatomy.json`,
`coupling-graph.json`, and HTML reports that are routinely handed to a client. It holds no
credentials, uses the Salesforce CLI's existing authenticated connection, and exposes no
network service.

The threats that matter are therefore:

1. The tool **modifies** an org it was trusted to only read.
2. The tool **sends org data somewhere** other than the org it authenticated against.
3. Org-controlled data **escapes its context**, most importantly into a report someone else
   opens.
4. The tool **reports something untrue** about an org, so a reader draws a false conclusion.
5. Org-identifying data **leaks into a public repository**.
6. A **supply-chain compromise** substitutes different code for what the source says.

## Claim 1: it cannot modify an org

**Argument.** All org access goes through the four read-only client interfaces provided by
`@cclabsnz/sf-core`: SOQL, Tooling, REST GET and Metadata list/retrieve. No write method
exists to call.

**Evidence.** `test/unit/invariants/readonly-invariant.test.ts` statically scans the source
for org-mutating patterns and fails the build on a match. The check is static, so a mutating
call cannot pass simply by not executing during tests.

## Claim 2: it sends nothing anywhere but the authenticated org

**Argument.** The only network destination is the org the operator authenticated against. No
telemetry, no analytics, no model APIs. Generated reports are self-contained, so opening one
offline requests nothing.

**Evidence.** `test/unit/invariants/network-egress.test.ts` fails the build if any source
file imports a third-party HTTP client or emits markup referencing a remote asset. Fonts are
embedded as data URIs by the shared report shell for this reason.

**Why this is load-bearing.** Reports contain product names, user counts and endpoints. One
remote asset reference would disclose to a third party that a given client's report was
opened, and when. The local-first property is what makes it defensible to point this tool at
a production org.

## Claim 3: org data cannot escape its context

Org-controlled strings reach three sinks, and the rules have each been tested against a real
defect rather than assumed.

**Generated HTML.** Every interpolated value passes through `esc`. Two limits matter and have
both produced real defects in this family of repositories: `esc` escapes `&`, `<`, `>` and
`"`, so it is correct for element text and **double-quoted attributes only**; and it is **not
sufficient inside a `<script>` element**. The strata viewer embeds its payload as JSON in a
`<script type="application/json">`, and `JSON.stringify` escapes neither `<` nor `/`, so a
value containing a closing script tag would have ended the element early and handed the rest
to the HTML parser as markup. `<` is now escaped to its JSON unicode form, with a test that
reproduces the break-out and a second test asserting the value still round-trips.

**SOQL.** Identifiers interpolated into queries are org describe names, constrained by the
platform to `[A-Za-z0-9_]`, and are allowlisted rather than escaped where they are
interpolated at all.

**File paths.** Org-derived values used in paths are reduced to a single safe path segment by
`sf-core` before being joined.

## Claim 4: it does not report something untrue

This is the claim this project cares most about, because the failure mode is silent. A tool
that says "this org has no channels" when it never looked produces confident, wrong
architecture decisions.

**Argument.** The distinction between "collected and found nothing" and "never collected" is
carried as structured data from the collector to the pixel, and rendered explicitly at both
band and tile level.

**Evidence.**

- `coverage.unavailable` records a stable scope key, a reason of `deferred` or `failed`, and
  the human detail, for every deferred or refused read. View A classifies from that data and
  **never** from `coverage.notes` prose, so rewording a sentence cannot change what a picture
  claims.
- A band with no tiles renders "None found" or "Not collected", never a blank row.
- A band *with* tiles still declares what it did not gather, as "Partly collected". This was
  added after a live org drew ten Site channels as though they were a complete channel
  inventory while three of the four channel types had never been attempted.
- A count that could not be read is hatched and labelled "not read" rather than printing the
  placeholder zero it fell back to.
- Detection and attribution are recorded independently, so a confirmed integration with an
  unknown owner is reported as exactly that.

**Limitation, stated plainly.** A green suite is evidence the code does what the tests say,
never that it matches the platform. Every serious defect here was found by running against a
real org or by chasing a number that did not reconcile: `OmniProcessElement.Type` stores
`Rest Action`, not `REST Action`, so thirteen elements were dropped **and still counted as
scanned**; `OmniProcess` rows are versions rather than procedures, so the artifact asserted
integrations removed several edits earlier. Mitigation is procedural and recorded in
[CONTRIBUTING.md](../CONTRIBUTING.md): reconcile at least one number against the org directly
before trusting a collector.

## Claim 5: org-identifying data stays out of the repository

**Argument.** This repository is public, and the tool's own output identifies customers.

**Evidence.** A guard runs both in CI and as a pre-commit hook, rejecting Salesforce org ids,
sandbox hostnames and generated artefacts in the tree and in commit messages. It also scans a
pull request's own **title and body**, which was added after a part-masked org id reached a
public pull request body: masking the middle of an eighteen-character id leaves twelve
characters in place, so it still identifies the org while evading a length-based pattern.

**Limitation.** An org **alias** cannot be recognised structurally — `acme-uat` and
`my-scratch` are the same shape — so the guard cannot catch one. That gap is covered by a
reminder the job prints, and by the instruction in CONTRIBUTING.md, not by a control.

## Claim 6: what is published is what the source says

**Argument.** Releases are built and published by CI from a public commit, with no
long-lived credential.

**Evidence.** Publishing uses npm Trusted Publishing over OIDC with no stored token, and
attaches a SLSA provenance attestation and a CycloneDX SBOM. Dependencies install from a
committed lockfile with integrity hashes under `--frozen-lockfile`. Every GitHub Action is
pinned by commit SHA. CodeQL (security-extended), Semgrep, Socket and OpenSSF Scorecard run
on every change.

**Limitation, and it is the significant one.** `0.1.0` is currently the **only published
version** and carries **no attestation**, because it was hand-published before Trusted
Publishing was configured for this package. Every installable copy today is therefore
unverifiable. This is not mitigated; it is fixed by releasing `0.2.0` through the workflow,
and it is tracked in [ROADMAP.md](../ROADMAP.md) as the highest-value open item.

## Accepted limitations

- **`0.1.0` has no provenance**, as above. The one limitation on this page with a user-visible
  consequence today.
- **One maintainer.** A single point of failure for review, release and security response.
  See [GOVERNANCE.md](../GOVERNANCE.md).
- **No dynamic analysis.** The inputs are Salesforce API responses and there is no network
  service to scan; assertion-heavy tests and strict compilation are the substitute.
- **Static invariants are pattern-based** and could be evaded by sufficiently indirect
  construction. They are a floor, not a proof.
- **Three View A paths are fixture-only** — the empty band, the not-collected band and the
  hatched not-read tile — because neither verification org triggered them.
- **Org aliases are not guarded**, as described under Claim 5.
- **Branch coverage near 76%**, below statement coverage, concentrated in error paths.

## How to falsify this

```bash
pnpm run lint && pnpm run typecheck && pnpm test:unit && pnpm build
npm view @cclabsnz/sf-orgintel --json    # dist.attestations
```

If either invariant test is deleted, weakened, or has its rule list narrowed, the
corresponding claim here is no longer supported and should be removed from this page.

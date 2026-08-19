# Contributing to @cclabsnz/sf-orgintel

Thanks for your interest in improving the org intelligence plugin. This document covers
how to get set up, the conventions the project follows, and what a good contribution
looks like.

## Getting started

This is an [oclif](https://oclif.io/) `sf` plugin written in TypeScript (ESM, NodeNext).

```bash
git clone https://github.com/cclabsnz/sf-orgintel.git
cd sf-orgintel
pnpm install
pnpm build
sf plugins link .
sf intel anatomy --target-org <alias>
```

The four commands are `sf intel discover`, `sf intel probe`, `sf intel map` and
`sf intel anatomy`.

- **Package manager:** the lockfile is `pnpm-lock.yaml`. Use `pnpm`.
- **ESM/NodeNext:** relative imports must end in `.js` even inside `.ts` files.
- **`pnpm prepare` sets `core.hooksPath` to `.githooks`.** If you clone and skip
  `pnpm install`, the pre-commit guard does not run. Run `git config core.hooksPath`
  and confirm it says `.githooks`.
- After editing a command, re-run `pnpm build`. `oclif.pluginType` is `jit` and the
  command directory is `lib/`, so a "missing" command usually means you did not build.

## Non-negotiable rules

This tool reads production orgs and writes files describing them. Three rules are not
matters of taste, and each is enforced by a test that fails the build:

- **Read-only.** Only SOQL / Tooling / REST GET. No DML, no metadata deploy, no record
  modification, ever. `test/unit/invariants/readonly-invariant.test.ts`.
- **No network egress.** The only destination is the org the operator authenticated
  against. Reports are self-contained: fonts inlined as data URIs, no `script src`, no
  stylesheet link, no fetch. `test/unit/invariants/network-egress.test.ts`.
- **No org data in the repository.** Org ids, sandbox hostnames and generated artefacts
  must not reach the tree, a commit message, or a pull request's title or body. The
  guard runs in CI and as a pre-commit hook. Note that it cannot recognise an org
  *alias* structurally, so keep those out by hand.

Generated output (`anatomy.json`, `coupling-graph.json`, the HTML reports) contains real
product names, user counts and endpoints. Treat it as customer data and delete it when
you are done.

## Coding standards

- **Escape everything that came from an org** before it reaches markup. Product keys,
  persona profiles, channel names and endpoints are customer-controlled strings.
- **Deterministic output.** The same artifact in must produce the same bytes out. No
  `Date.now()` or `Math.random()` in a render path, and no iteration over unordered
  structures.
- **Absence renders explicitly.** "We looked and found none" and "we never looked" are
  different findings and must never render the same. See `docs/ANATOMY_SPEC.md` section 6.
- **Lint is a gate, not a suggestion.** `pnpm run lint` runs oxlint over `src` and `test`
  with the correctness category set to error, and CI runs it in the required build-test job.
- **Types are checked separately from tests.** Jest strips types without checking them,
  so a type error will not fail a bare jest run. `pnpm run typecheck` covers `src` and
  `test` together; run it before you push.

## Testing policy

- Unit tests only, with mocked SOQL / Tooling / REST clients. **Never point a test at a
  real org.**
- Use `mockIntelContext` from `test/unit/helpers/mocks.ts` rather than casting a partial
  context with `as any`. The cast suppresses exactly the checking that catches a wrong
  client signature, which is what caused the worst defects in this codebase.
- A green suite is evidence the code does what the tests say, never that it matches the
  platform. Before trusting a new collector, run it against a real org and reconcile at
  least one number against the org directly. Every serious defect here was found that
  way, not by a failing test.

## Specs and plans

Specs are committed (`docs/<NAME>_SPEC.md`) and state what was decided and why.
Implementation plans are **not** committed: they live in `docs/superpowers/`, which is
gitignored, because once the work lands the git history is the record and the plan is
noise that goes stale.

## Before you open a pull request

```bash
pnpm run lint && pnpm run typecheck && pnpm test:unit && pnpm build
```

All four must exit 0. Check the exit code rather than reading the last lines of output:
piping a compiler into `tail` reports the exit status of `tail`.

Then check your pull request text for org ids, sandbox hostnames and org aliases. The
`guard-pr-text` job catches the first two, and nothing catches the third.

## Reporting bugs and requesting features

Open an issue at <https://github.com/cclabsnz/sf-orgintel/issues>. Include the plugin
version (`sf plugins inspect @cclabsnz/sf-orgintel`), what you ran, what you expected and
what happened, **with org identifiers redacted**.

For anything security-relevant, do not open a public issue. Follow
[SECURITY.md](SECURITY.md) instead.

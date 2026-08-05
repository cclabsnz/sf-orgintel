# Releasing `@cclabsnz/sf-orgintel`

Publishing is triggered by cutting a GitHub Release. `.github/workflows/publish.yml` builds,
tests, publishes to npm with build provenance, and attaches a CycloneDX SBOM to the release.

No npm token is stored anywhere. Auth is npm **Trusted Publishing (OIDC)**: the job exchanges
its short-lived GitHub OIDC id-token for an npm credential at publish time. Nothing to rotate,
nothing to leak.

## The first publish is the awkward one

Trusted publishing is configured **per package**, from that package's settings page on
npmjs.com. A package that has never been published has no settings page, so there is nothing to
configure against. Read the ordering below before cutting the first release.

For the first version only, one of:

1. **Check npmjs.com first.** If a trusted publisher can be added for a name you own but have
   not published, do that and use the normal flow below. This is the preferred route: the very
   first tarball then carries provenance like every one after it.
2. **Publish `0.1.0` by hand, then switch to OIDC.** `npm login`, then `npm publish
   --access public` from a clean checkout. Configure the trusted publisher immediately
   afterwards and never publish by hand again. The cost is that `0.1.0` alone has no
   provenance attestation, which is visible on the npm page forever.

Do not add a long-lived npm token to repository secrets as a workaround. A stored token that
can publish this package is a worse trade than one release lacking an attestation, and it tends
to outlive the reason it was added.

## One-time setup

On npmjs.com, go to **`@cclabsnz/sf-orgintel` → Settings → Trusted Publishing** and add a
GitHub Actions publisher:

| Field | Value |
|---|---|
| Organization / user | `cclabsnz` |
| Repository | `sf-orgintel` |
| Workflow filename | `publish.yml` |
| Environment | **leave blank** |

Each field is matched exactly against a claim in the OIDC token. A value that does not match,
including an environment name when the workflow declares none, makes npm decline the exchange.

This is package-level configuration. Adding a trusted publisher to the `@cclabsnz` org does not
cover an individual package.

## Cutting a release

1. Land the work on `main` and make sure CI is green.
2. Bump `version` in `package.json`. Semver against the **exported surface and CLI contract**:
   a new flag or command is a minor; renaming a flag, changing a default, or altering the shape
   of `coupling-graph.json` or `landscape-manifest.json` is a major. Those two files are
   consumed by other tools and are the real public interface, more than any TypeScript export.
3. Verify locally:
   ```sh
   pnpm install --frozen-lockfile
   pnpm run build
   pnpm test
   npm pack --dry-run
   ```
   Read the `npm pack` output. The `files` allowlist in `package.json` is what keeps working
   notes, design docs and generated reports out of the tarball. npm does not read `.gitignore`,
   and it certainly does not read a global one, so a file that never appears in `git status`
   can still ship. This repo generates HTML reports containing real org data; anything outside
   `lib/`, `LICENSE`, `README.md` and `PERMISSIONS.md` in that listing is a bug.
4. Cut the release. The tag convention is `v` plus the exact `package.json` version:
   ```sh
   gh release create v0.1.0 --target main --title "v0.1.0: <summary>" --notes "<notes>"
   ```
5. Watch it:
   ```sh
   gh run list --workflow=publish.yml -L 1
   ```
6. Confirm the registry actually moved. A green workflow is not proof, so check the thing
   itself:
   ```sh
   npm view @cclabsnz/sf-orgintel dist-tags
   ```

## Re-running a failed publish

Nothing needs undoing. The tag, the release and the commit are all still correct. Only the
publish step needs to run again:

```sh
gh run rerun <run-id> --failed
```

Re-run the **release-triggered** run rather than dispatching a fresh one. The SBOM attach step
is gated on `github.event_name == 'release'`, so a `workflow_dispatch` run publishes but skips
the SBOM.

A version that did publish can never be republished. npm forbids reusing a version number even
after an unpublish, so if a bad tarball reaches the registry, deprecate it and ship a patch.

## Troubleshooting

**`npm error code ENEEDAUTH`:** npm found no credential. Confusingly, this is also what a
*rejected* OIDC exchange looks like: npm asks, npm is declined, npm falls back to
unauthenticated and reports it as though it never had a token to begin with. Work through, in
order:

0. **If the trusted publisher was configured in the last few minutes, just re-run.** The npm
   side takes a moment to propagate, and until it does the exchange is refused, producing a
   failure byte-identical to having no configuration at all. This cost two failed runs on
   `sf-core` before anyone thought to simply try again. Rule out the boring cause first.
1. The trusted publisher matches the table above, field for field. Environment blank. Workflow
   filename exactly `publish.yml`.
2. The publisher is on the **package**, not the org.
3. `npm -v` in the job log is at least 11.5.1. The runner's Node 22 ships npm 10.x, which has
   no OIDC support at all, hence the explicit upgrade step.
4. The job grants `id-token: write`. The workflow's top-level `permissions: contents: read` is
   a default; the job-level block overrides it, and the repo's read-only default workflow
   permission does not block an explicit escalation.
5. No `.npmrc` exists in the repo, and `actions/setup-node` is configured **without**
   `registry-url`. That input makes setup-node write an `.npmrc` containing a placeholder
   `_authToken`, and the placeholder takes precedence over the OIDC flow. This is why the
   omission is commented in the workflow.

To see whether npm attempts the exchange at all, add `--loglevel verbose` to the publish
command temporarily. A run that never mentions OIDC is a client-side problem (3 to 5); a run
that attempts it and is refused is a configuration mismatch (1 or 2).

**`E404` on publish:** usually the placeholder-`_authToken` case in (5). On a first publish it
can also mean the scope exists but the package does not and `--access public` was missing.

**`EOTP`:** a 2FA prompt means npm is authenticating the request as a *user* rather than
through trusted publishing. Treat it as the same misconfiguration.

## What ships

The tarball is an allowlist, not an ignore list:

```jsonc
"files": ["/lib", "LICENSE", "README.md", "PERMISSIONS.md", "!/lib/**/*.map"]
```

`docs/`, `DESIGN_BRIEF.md`, `STATUS.md` and every generated report are deliberately absent.
Reports produced by this tool contain real object names, record volumes and org structure, and
must never reach a public registry.

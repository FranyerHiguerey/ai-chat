# Releasing

Every push and pull request runs [CI](../.github/workflows/ci.yml): Prettier, build, typecheck, lint and tests on Node 20 and 22, then it packs the five packages and fails if any of them depends on a sibling (that would break installs from release URLs under pnpm 11).

A release is a tag. [release.yml](../.github/workflows/release.yml) does the rest.

1. Bump `version` in all five `packages/*/package.json` to the same number.
2. Add a `## x.y.z (date)` section at the top of `CHANGELOG.md`. It becomes the release notes.
3. Update the version in the README's status line.
4. Commit, then tag and push:
   ```bash
   git tag v0.2.0 && git push origin main v0.2.0
   ```

The workflow checks that the tag matches every package version, runs the full gate again, creates the GitHub release with the five tarballs and, when the `NPM_TOKEN` secret exists, publishes to npm with [provenance](https://docs.npmjs.com/generating-provenance-statements). Versions already on npm are skipped, so re-running a failed release is safe.

## Publishing from your machine

This needs no GitHub Actions, only an npm account.

1. Once: `pnpm login` (opens the browser; the account must be `franyerhiguerey`, the name of the `@franyerhiguerey` scope). Turn on two-factor authentication on npmjs.com.
2. Bump the versions and the CHANGELOG as above, and commit.
3. Run:
   ```bash
   pnpm release:npm
   ```
   It installs, runs the full gate (Prettier, build, typecheck, lint, tests) and only then publishes the five packages. With two-factor on, npm asks for a code or opens the browser. Versions already on npm are skipped.
4. Tag the commit and push it: `git tag v0.2.0 && git push origin main v0.2.0`.

Packages published this way have no [provenance](https://docs.npmjs.com/generating-provenance-statements) statement: npm only creates it inside CI.

## npm setup for CI (once)

1. Sign in to [npmjs.com](https://www.npmjs.com) as `franyerhiguerey` (the account name is the `@franyerhiguerey` scope) and turn on two-factor authentication.
2. **Access Tokens → Generate New Token → Granular Access Token**: read and write, packages and scopes `@franyerhiguerey`, an expiry you will remember. On the first publish the packages don't exist yet, so give it access to all packages of the scope.
3. In the GitHub repo: **Settings → Secrets and variables → Actions → New repository secret**, name `NPM_TOKEN`.

Once the packages exist you can drop the token for npm's [trusted publishing](https://docs.npmjs.com/trusted-publishers): link each package to this repo and `release.yml`, then delete the secret.

# Lazurio Hosted Fork Release Contract

This contract keeps Lazurio's Team Workspace web application reproducible while preserving the
upstream T3 Code protocol. The Lazurio fork supplies the browser UI and its colocated server. The
official desktop and mobile applications remain unmodified upstream clients of that server.

The supported fork patch budget is deliberately small:

- opt-in browser branding and a visible Workspace label;
- a safer presentation of T3 Code's native device-invitation controls;
- an explicit trusted external origin for a loopback-bound server behind a reverse proxy.

The fork must not introduce a second identity store, a new token format, new desktop or mobile
packages, or Lazurio-specific HTTP/WebSocket protocol variants. `packages/contracts`, native auth
semantics, and existing API and WebSocket routes are compatibility boundaries.

## Hosted runtime configuration

The default build remains T3 Code. Only an explicitly configured Team Workspace browser build may
set the optional display name:

```bash
VITE_HOSTED_APP_NAME="Lazurio T3 Code" \
vp run --filter @t3tools/web build
```

Do not set `VITE_HOSTED_APP_CHANNEL` for a Team Workspace. That upstream variable selects the
static hosted-app `latest`/`nightly` behavior, including its channel switcher; the Workspace is a
server-backed, operator-pinned deployment. Desktop branding injected by the desktop shell has
precedence, and the native mobile package does not consume this web-only setting. Vanilla desktop
and mobile builds therefore continue to identify themselves as T3 Code.

A Team Workspace keeps the server on loopback and declares its separately secured browser origin:

```bash
T3CODE_EXTERNAL_ORIGIN=https://t3code.management.example.test \
T3CODE_ENVIRONMENT_LABEL="Management Workspace" \
t3 serve --host 127.0.0.1
```

`T3CODE_EXTERNAL_ORIGIN` accepts one absolute HTTPS origin with no credentials, path, query, or
fragment. It does not alter the bind address or trust forwarded headers. It only tells the native
T3 authorization layer that this otherwise loopback-bound server is deliberately reachable through
a trusted reverse proxy, so the existing remote access-management UI and stable hosted session
cookie apply. The hosted browser cookie is named `__Host-t3_session`, is `Secure`, `HttpOnly`, and
`SameSite=Lax`, and cookie-authenticated mutations and WebSocket upgrades must match the configured
origin. TLS, network policy, GitHub ingress authentication, and exact HTTP/WebSocket proxying remain
operator responsibilities outside T3 Code.

The external origin does not grant `access:write`. Lazurio's access runbook must first verify the
person's live GitHub Organization Owner/Admin authority and membership in the exact Team, then
bootstrap that browser with a native T3 administrative credential. T3 Code subsequently enforces
its own native scope delegation: an administrative session can create and revoke device invites,
while a standard Builder session cannot mint an administrative credential. The fork does not keep
a Lazurio Admin roster or translate proxy headers into T3 scopes.

## Upstream provenance and sync policy

- Fork: `https://github.com/Lazurio/t3code`
- Upstream: `https://github.com/pingdotgg/t3code`
- DEV-6442 source base: `c196f422ed387a1cc2cdb671b0472782e5610339`
- Latest stable upstream release observed on 2026-08-17: `v0.0.33`, target
  `3b72d17cbca691f0b64e6d4a10c9e349f42873a5`
- The stable target is an ancestor of the fork source base. The source base contains 34
  post-`v0.0.33` commits from the `v0.0.34-nightly.*` development line; it is not a published
  upstream stable snapshot. At the same readback upstream `main` was another 175 commits ahead.

Lazurio tracks upstream stable releases, not every upstream `main` or nightly build. Each stable
update is its own reviewed sync PR. Preserve upstream history, reapply only the bounded fork patch,
and record the upstream stable tag and exact target commit. Never silently replace the recorded
base while building or releasing.

Use this order for every update:

1. Wait for the next upstream stable release, then open an upstream-sync PR from that exact tag.
2. Reconcile the bounded Lazurio patch without changing native protocol contracts.
3. Run fork CI, both web builds, server authorization tests, and physical pairing smoke with the
   current official stable desktop and mobile clients.
4. Review the exact diff and create an immutable fork tag such as `lazurio-v0.0.34-r1` only after
   the source PR is published.
5. Produce release evidence for the exact tag commit and built artifact.
6. Update infrastructure to the exact fork commit and resulting image/artifact digest in a separate
   PR.
7. Roll out Management first, then the other Team Workspaces serially after acceptance.

Team Workspaces never self-update from a branch, tag alias, package channel, or GitHub release.
An update recreates the shared Workspace container and can interrupt T3 Code, Launchpad, running
module previews, terminals, and Agent jobs. Operators must announce/drain the Workspace, preserve
durable volumes, and retain the previous exact pin for rollback.

For a time-sensitive pilot, an explicitly approved pre-stable snapshot may be pinned only by exact
fork commit and artifact digest after all other gates pass. Its tag and evidence must say
`pilot`/`prestable` rather than imply upstream-stable provenance, and the next upstream stable sync
remains mandatory before general rollout.

## Fork-safe automation

Do not enable inherited upstream publication workflows as the Lazurio release mechanism. They also
cover upstream desktop/mobile releases, relays, hosted deployment, schedules, external runners, and
upstream secret custody.

The fork needs only two narrow lanes:

- PR CI with read-only repository permission: formatting/lint, web and server typechecks, focused
  tests, and default plus opt-in web builds;
- a manually dispatched release-evidence job that never publishes desktop/mobile packages, relays,
  or hosted infrastructure and never promotes an infrastructure pin.

Until that fork-safe CI is explicitly enabled and green in `Lazurio/t3code`, local validation is
useful review evidence but not a release gate substitute. GitHub Release creation and infrastructure
promotion remain explicit Principal actions.

## Required release evidence

Before any release or deployment, create one immutable evidence record next to the packaged web
artifact. It must contain:

```json
{
  "schema_version": "t3code.fork-release.v1",
  "source": {
    "repository": "https://github.com/Lazurio/t3code",
    "commit": "<exact 40-character fork commit>",
    "tag": "<immutable lazurio-vX.Y.Z-rN tag>",
    "upstream_repository": "https://github.com/pingdotgg/t3code",
    "upstream_release": "<exact stable upstream tag>",
    "upstream_base": "<exact upstream tag commit>"
  },
  "artifact": {
    "name": "<immutable artifact name>",
    "sha256": "<64-character digest>"
  },
  "configuration": {
    "hosted_app_channel": null,
    "hosted_app_name": "Lazurio T3 Code",
    "external_origin": "injected per Team at runtime"
  },
  "validation": {
    "checks": [
      "fork PR CI",
      "focused server authorization tests",
      "default web build",
      "opt-in hosted web build",
      "vanilla desktop pairing and access-management smoke",
      "vanilla mobile pairing smoke"
    ],
    "fable_5_review": "PASS"
  }
}
```

Generate the source and artifact fields from the final clean release checkout, not from a working
tree or mutable branch name:

```bash
git diff --quiet && git diff --cached --quiet
git rev-parse HEAD
git rev-parse <stable-upstream-tag>^{commit}
git merge-base --is-ancestor <stable-upstream-tag> HEAD
shasum -a 256 <packaged-artifact>
```

The ancestry check must pass. The evidence record and packaged artifact are a pair: changing either
requires a new digest and a new review.

## Pin, rollback, and attribution gates

Hosted infrastructure pins an exact fork commit and immutable artifact/image digest. It must not
pin `main`, a moving hosted channel, or an unqualified image tag. Promotion changes only those
explicit pins. Rollback restores the previous known-good commit and digest, then repeats the same
serial health checks.

The fork remains MIT-licensed. Retain the upstream copyright and license and include a visible
"Based on T3 Code" attribution in an appropriate product/about surface; Lazurio branding must not
imply that the fork is an official T3 Tools distribution.

A release remains blocked unless all listed checks passed against the recorded source commit and
the exact diff was reviewed. Merging source, creating a GitHub Release, publishing an artifact,
changing a hosted pin, or deploying live infrastructure are separate publication actions.

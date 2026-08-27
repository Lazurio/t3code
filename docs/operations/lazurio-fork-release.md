# Lazurio T3 Code compatibility-fork release contract

`Lazurio/t3code` is a compatibility-first distribution fork of upstream T3 Code. Official,
unmodified T3 Code Desktop and Mobile applications are the supported clients for Lazurio Team
Workspaces. The fork does not own a client, protocol, identity model, or product roadmap.

## Exact upstream base

This update is based directly on upstream stable tag `v0.0.34` at
`badae6a5cc8325dcd5a145bea6f7b8ac692818a1` and preserves its complete ancestry. Updates are
rebuilt from an exact upstream stable tag; they do not merge the previous diverged fork history.

The old pilot source remains immutable and auditably retained by tag and release
`lazurio-pilot-prestable-20260823.1`. Replacing the default branch must use an exact
`--force-with-lease` tied to the reviewed old HEAD. Tags, releases, OCI images, and unrelated
branches are never rewritten as part of a stable sync.

## Patch budget

The source overlay is deliberately limited to two generic server capabilities:

- `T3CODE_EXTERNAL_ORIGIN`: one explicit HTTPS browser origin for a web-mode server that remains
  bound to an explicit loopback host behind an operator-managed reverse proxy;
- `T3CODE_ENVIRONMENT_LABEL`: an explicit human-readable environment label.

The rest of the overlay is packaging and automation: fork-safe read-only CI, a non-root OCI
Dockerfile, and a manually dispatched immutable release workflow.

The fork does not change `packages/contracts`, `packages/client-runtime`, `apps/mobile`, or
`apps/desktop`. It does not add Lazurio headers, routes, endpoints, token formats, wire schemas,
client packages, or a second IAM. The canonical web connection route remains
`/settings/connections`; any Lazurio navigation to it belongs in Dashboard or infrastructure.

Upstream `v0.0.34` already owns the Connections UI, one-use pairing credentials, QR presentation,
session/device listing, and revocation. Earlier fork-only invitation presentation and machine-client
work are intentionally absent. The browser distribution keeps vanilla T3 Code branding.

## Hosted origin semantics

A Team Workspace uses:

```bash
T3CODE_EXTERNAL_ORIGIN=https://t3code.management.example.test \
T3CODE_ENVIRONMENT_LABEL="Management Workspace" \
t3 serve --host 127.0.0.1
```

The external origin accepts HTTPS only and rejects credentials, paths, queries, and fragments. It
does not change the bind address and does not trust forwarded authority headers. It classifies the
otherwise-loopback server as intentionally remote-reachable, gives browser sessions the stable
`__Host-t3_session` cookie name, marks that cookie `Secure`, and requires the configured Origin
for cookie-authenticated mutations and WebSocket upgrades. Bearer/DPoP clients and native protocol
routes remain upstream T3 Code behavior.

TLS, ingress authentication, Team authorization, DNS, and exact HTTP/WebSocket proxying remain
infrastructure responsibilities. The fork does not translate proxy identity into T3 scopes.
One-use pairing and scope delegation remain T3 Code's native authorization model.

## Fork-safe automation

Only these workflows are active:

- `lazurio-fork-ci.yml`: read-only CI on GitHub-hosted Ubuntu;
- `lazurio-release.yml`: explicitly dispatched release publication behind the protected
  `lazurio-t3code-release` environment.

Fork CI fetches the exact upstream tag, verifies its SHA and ancestry, rejects any overlay change in
the four client/protocol boundary paths, runs formatting/lint/typechecks and focused server/web
tests, builds the vanilla web distribution, validates the release contract, and builds the OCI
image without publishing it.

The release workflow accepts only an existing immutable Lazurio tag whose exact source is already
on `main`. It verifies the requested upstream tag/SHA, publishes one GHCR tag with SBOM,
provenance and attestation, and creates the matching GitHub Release. It publishes no `latest`,
branch, client package, relay, hosted channel, infrastructure pin, or deployment.

For `v0.0.34`, release packaging runs
`scripts/lazurio-stamp-package-version.mjs 0.0.34` against only the server and web package
manifests before building, so the deployed discovery
descriptor reports `serverVersion: "0.0.34"`, even though source package manifests retain the
upstream development version before release stamping.

## Required vanilla-client gate

An OCI digest is not rollout evidence. Management is promoted first, then current official vanilla
Desktop and Mobile clients must prove, against that exact deployed digest:

1. `/.well-known/t3/environment` discovery;
2. one-use pairing and `/oauth/token` exchange;
3. `/api/auth/websocket-ticket` and `/ws?wsTicket=…`;
4. project and thread loading;
5. starting a turn and receiving its stream;
6. reconnect after a server restart;
7. device/session revocation;
8. Mobile QR pairing.

Any failure stops promotion and triggers either a minimal source correction or rollback to the prior
exact source/digest. Technical and the remaining Team Workspaces are updated serially only after
the Management proof passes.

## Immutable evidence and rollback

The GitHub Release records the exact fork source SHA, upstream tag/SHA, OCI digest, SBOM,
provenance, attestation, build metadata, checksums, and workflow run. Infrastructure separately pins
that exact source and digest. Rollback restores the prior exact pin and repeats the same health
checks.

If an OCI push succeeds but evidence or GitHub Release publication fails, the digest is quarantined
and the tag is not reused or overwritten. A new reviewed source/tag revision is required.

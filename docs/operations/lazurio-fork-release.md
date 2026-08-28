# Lazurio T3 Code compatibility-fork release contract

`Lazurio/t3code` is a compatibility-first distribution fork of upstream T3 Code. Official,
unmodified T3 Code Desktop and Mobile applications are the supported clients for Lazurio Team
Workspaces. The fork does not own a client, protocol, identity model, or product roadmap.

## Exact upstream base

This update is based directly on upstream stable tag `v0.0.35` at
`f925d639421844f02b3166d29281905dbba6d529` and preserves its complete ancestry. Updates are
rebuilt from an exact upstream stable tag; old fork commits are never treated as the implementation
source for a new stable.

The old pilot source remains immutable and auditably retained by tag and release
`lazurio-pilot-prestable-20260823.1`. The v0.0.34 cleanup and v0.0.35 refresh replaced `main` with
exact `--force-with-lease` operations while the old source remained tagged. Those were bounded
history migrations, not a recurring publication mechanism.

Beginning with the next stable refresh, `main` is never force-pushed. A candidate starts at the
exact upstream tag, reconstructs only the reviewed overlay below, and joins the current fork history
with the tree-neutral bridge described in [Stable refresh procedure](#stable-refresh-procedure).
The result is published through a normal pull request and merge commit. Exact
`--force-with-lease` remains valid only for an unmerged pull-request branch after rebase; it is not
valid for `main`, release tags, OCI tags, or deployed digests.

## Patch budget

The hosted-distribution overlay retains two generic server capabilities:

- `T3CODE_EXTERNAL_ORIGIN`: one explicit HTTPS browser origin for a web-mode server that remains
  bound to an explicit loopback host behind an operator-managed reverse proxy;
- `T3CODE_ENVIRONMENT_LABEL`: an explicit human-readable environment label.

The collaboration overlay is additive and deliberately narrow: arbitrary browser files use a new
optional `contextFiles` lane beside the unchanged image-only `ChatAttachment` union, opaque
streamed storage, exact-file signed downloads, and web-only upload/download affordances. Official
vanilla Desktop and Mobile clients continue to use their image-only wire behavior and silently
ignore the optional field. When upstream stable ships equivalent generic-file support, the fork
adopts the upstream contract and removes this patch after persisted-data reconciliation.

The rest of the overlay is browser presentation, packaging, and automation: opt-in hosted product
identity, fork-safe read-only CI, a non-root OCI Dockerfile, and a manually dispatched immutable
release workflow.

The fork does not change `apps/mobile` or `apps/desktop`, publish a Lazurio client, or add Lazurio
headers, routes, endpoints, identity, or a second IAM. Its additive contract and reducer changes are
limited to the generic-file lane and are covered by a decoder frozen to upstream v0.0.35. The
canonical web connection route remains
`/settings/connections`; any Lazurio navigation to it belongs in Dashboard or infrastructure.

Upstream `v0.0.35` already owns the Connections UI, one-use pairing credentials, QR presentation,
session/device listing, and revocation. Earlier fork-only invitation presentation and machine-client
work are intentionally absent. A release image opts the browser shell into the generic
`VITE_HOSTED_APP_NAME` identity `Lazurio T3 Code`; vanilla builds and official desktop/mobile
clients remain T3 Code.

The product identity and Workspace identity have separate owners. The build identifies the hosted
browser distribution. At runtime, the existing `T3CODE_ENVIRONMENT_LABEL` descriptor supplies the
Team Workspace label, so the header and document title can show values such as
`Lazurio T3 Code — Iotor / Management` without an Iotor-specific source patch.

## Canonical overlay inventory

This document is the semantic authority for what the fork is allowed to retain. The implementation
authority is the reviewed diff from the recorded upstream tag to the candidate, and fork CI is the
mechanical proof. Do not create a second file-by-file patch ledger: upstream moves files, while the
capabilities and their removal conditions remain stable.

Every stable refresh classifies each row as `remove`, `retain`, or `migrate`; `remove` is the
default. A row may be retained only with current upstream evidence and the proof named here.

| Overlay capability                         | Natural owner                                                                              | Retain only while                                                                                       | Required proof and removal rule                                                                                                                                 |
| ------------------------------------------ | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Explicit hosted origin and Workspace label | Server configuration, environment descriptor, and existing auth policy                     | Upstream lacks equivalent explicit reverse-proxy origin semantics or a human-readable environment label | Origin/auth/WS tests and vanilla pairing gate; adopt an equivalent upstream capability and delete the fork path                                                 |
| Hosted browser distribution identity       | Web build-time presentation                                                                | The hosted browser needs a distribution label that upstream cannot inject generically                   | Vanilla web build plus branding tests; never alter Desktop/Mobile identity                                                                                      |
| Generic-file collaboration                 | General contracts, server orchestration/storage, client runtime projection, and hosted web | Upstream lacks equivalent arbitrary input files and exact authenticated download                        | Frozen vanilla decoders, migration contract, security tests, browser round trip, and official client gates; upstream owns the contract as soon as parity exists |
| Reproducible hosted OCI packaging          | `Dockerfile.lazurio`, version stamping, and immutable release evidence                     | Lazurio distributes the server-backed browser as its own non-root image                                 | Release-contract test, offline runtime smoke, SBOM, provenance, and immutable tag/digest                                                                        |
| Fork-safe automation boundary              | `.github/FORK-SAFETY.md` and Lazurio-only CI/release workflows                             | This repository remains a distribution fork rather than an upstream release operator                    | Exact workflow inventory review; restored upstream publishing, relay, preview, or mobile/desktop workflows block release                                        |

The following are explicitly outside the fork overlay:

- Dashboard navigation, DNS, Caddy, Team authorization, Headscale, and infrastructure digest pins;
- the Team Workspace Builder image and its independently pinned Codex CLI version;
- Lazurio-specific clients, headers, endpoints, routes, wire variants, IAM, or storage authorities;
- any change to `apps/mobile` or `apps/desktop`.

The release evidence records the upstream T3 tag/SHA, fork source SHA, OCI digest, and deployed
Builder image/Codex CLI version. Codex CLI may be updated in the Workspace runtime lane, but it is
never vendored into or used as a reason to fork T3 protocol behavior.

## Stable refresh procedure

### 1. Freeze the inputs

Record the current remote `main`, the new upstream stable tag and its peeled commit SHA, the prior
immutable Lazurio release/digest, and the live Management migration maximum. Fetch the exact tag
from `pingdotgg/t3code`; release notes, a branch name, or a moving nightly reference are not source
evidence.

Create the candidate directly from the exact upstream commit. Do not merge the old fork into the
candidate and do not cherry-pick the previous overlay wholesale. In the pull-request description,
include one row for every capability in the canonical inventory with upstream evidence, the chosen
`remove`/`retain`/`migrate` action, and the resulting proof.

### 2. Reconstruct the minimum candidate

Review upstream contracts, assets/uploads, orchestration, auth/origin behavior, migrations, web
presentation, packaging, and every restored `.github/workflows` file before applying a patch. A
retained capability is reimplemented against the new upstream seam; a superseded capability is
deleted. Generic-file contracts remain upstream-shaped and optional, and the protected vanilla
client source paths remain untouched.

Update all stable-coupled evidence together: exact tag/SHA checks, package-version stamping,
frozen vanilla decoder fixtures, migration maximum/lease, compatibility tests, documentation, and
OCI build metadata. The candidate diff against the new upstream tag must contain only classified
overlay behavior.

### 3. Prove the candidate before joining history

Run the Linux and Windows fork checks, the release and migration contracts, an OCI build/runtime
smoke, and the hosted-browser file round trip where the generic-file overlay remains. A future
stable that overlaps the migration lease additionally follows the exact stopped/backup/ledger
reconciliation below. Any unknown migration, restored publishing workflow, protected-client diff,
or unclassified capability stops the refresh.

### 4. Add a tree-neutral history bridge

Only after the candidate tree is approved, fetch the current remote `main` again. If it moved,
restart this step with the new exact SHA. When current `main` is not already an ancestor, join it as
the second parent with Git's `ours` merge strategy while checked out on the candidate:

```bash
old_main=<exact-current-origin-main-sha>
git merge -s ours --no-ff "$old_main" \
  -m "chore(fork): bridge previous Lazurio stable history"

test "$(git rev-parse HEAD^2)" = "$old_main"
git diff --exit-code HEAD^1 HEAD
git merge-base --is-ancestor "$old_main" HEAD
git merge-base --is-ancestor <exact-upstream-tag-sha> HEAD
```

Use `-s ours`, not the conflict preference `-X ours`. The bridge must change no files: its first
parent is the approved candidate tree and its second parent is the exact previous `main`. This makes
the update a normal descendant of `main` without importing stale overlay content.

### 5. Publish through protected `main`

Open a pull request from the bridged candidate to `main`. The branch must be current, the exact-head
checks must pass again after the bridge, and the overlay classification must still match the diff.
Publish with a merge commit; squash or rebase publication would discard the reviewed candidate
ancestry. Direct pushes and force-pushes to `main` are forbidden.

Before source publication, live GitHub policy must require a pull request, block force-push and
deletion for administrators as well as other writers, require the `Server and web compatibility`,
`Windows generic-file compatibility`, and `Greptile Review` checks, and require the head to contain
the current base. Merge commits must remain allowed; a linear-history rule is incompatible with the
reviewed bridge. Repository prose is not proof of provider configuration, so each publication reads
the live rule back from GitHub.

### 6. Release and promote separately

Tag the merged source with the next immutable `lazurio-vX.Y.Z-rN` revision and dispatch the protected
release workflow with exact source and upstream SHAs. A source merge does not publish OCI, change an
infrastructure pin, or deploy a Workspace. Promote the resulting digest to Management only, execute
the hosted-browser and official Desktop/Mobile gates below, and then update the remaining Team
Workspaces serially.

If source, evidence, release publication, migration reconciliation, or a client gate fails, stop.
Keep the failed artifact immutable and either correct the candidate under a new reviewed source/tag
or restore the prior exact digest. Never repair a failed stable refresh by rewriting `main`.

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
tests, builds the vanilla web distribution, validates the release contract, and builds the branded
OCI image without publishing it.

The release workflow accepts only an existing immutable Lazurio tag whose exact source is already
on `main`. It verifies the requested upstream tag/SHA, publishes one GHCR tag with SBOM,
provenance and attestation, and creates the matching GitHub Release. It publishes no `latest`,
branch, client package, relay, hosted channel, infrastructure pin, or deployment.

For `v0.0.35`, release packaging runs
`scripts/lazurio-stamp-package-version.mjs 0.0.35` against only the server and web package
manifests before building, so the deployed discovery
descriptor reports `serverVersion: "0.0.35"`, even though source package manifests retain the
upstream development version before release stamping.

## Context-file migration lease

The v0.0.35 overlay temporarily leases migration id `44` under the deliberately fork-identifiable
row name `LazurioProjectionThreadMessagesContextFiles`. Fork CI requires it to remain the unique
last migration. This lease must never be carried blindly across an upstream stable bump: upstream's
next migration may also use id 44, and the monotonic migrator would otherwise skip it.

Before adopting the first upstream stable whose manifest owns id 44 or greater:

1. stop the Management candidate and take a verified database backup together with the persistent
   builder home;
2. build the candidate from the exact new upstream stable, retain all upstream migrations, and move
   or remove the context-file overlay according to upstream parity;
3. verify that the live ledger has no applied migration above 44 and that id 44 has exactly the fork
   name above;
4. in one reviewed transaction, run the guarded reconciliation below and require exactly one row to
   change:

   ```sql
   DELETE FROM effect_sql_migrations
   WHERE migration_id = 44
     AND name = 'LazurioProjectionThreadMessagesContextFiles';
   ```

5. start the candidate so upstream id 44 and any renumbered idempotent overlay migration run in
   canonical order; verify both the migration ledger and resulting schema;
6. require the pinned vanilla decoder fixtures, source CI, Management browser file E2E, and official
   vanilla Desktop/Mobile acceptance before any further rollout.

If any precondition or affected-row assertion differs, restore the database backup and stop. Never
delete a migration row by id alone, and never run this procedure after a higher migration has
already been applied.

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

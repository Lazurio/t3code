# Lazurio T3 Code compatibility-fork release contract

`Lazurio/t3code` is a compatibility-first distribution fork of upstream T3 Code. Official,
unmodified T3 Code Desktop and Mobile applications remain supported clients for Lazurio Team
Workspaces. The fork does not own a client, protocol, identity model, or product roadmap.

## Exact upstream base

This candidate is based directly on upstream stable tag `v0.0.38` at
`c0995d2eaf8ec787b3318ed1169ae266ed1529f8`. Every stable refresh starts from an exact upstream
tag and reconstructs only the reviewed overlay. The old fork is history evidence, never the
implementation source for a new stable.

`main` is the readable snapshot of the currently published Lazurio distribution: the exact
immutable upstream stable commit followed only by the current semantic Lazurio overlay commits.
Historical and rollback authority belongs to protected immutable `lazurio-*` release tags, not to
the moving `main` ref.

An Organization Admin may replace `main` only for this repository's reviewed stable refresh, only
from an exact green candidate, and only with an exact expected-old
`--force-with-lease`. The previous `main` must already equal an existing protected immutable
release tag. Release tags, OCI tags, deployed digests, and every other repository or branch remain
non-rewritable. Release creation and deployment are separate explicit gates after source
publication.

## Canonical overlay inventory

Every refresh classifies each capability as `remove`, `retain`, or `migrate`; `remove` is the
default. This table is the semantic authority. The candidate diff against the recorded upstream
tag is the implementation evidence.

| Capability                                        | Action for v0.0.38 | Natural owner                                                         | Required proof or removal rule                                                                                                                                                          |
| ------------------------------------------------- | ------------------ | --------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Explicit hosted origin and Workspace label        | retain             | Server configuration, environment descriptor, existing auth policy    | Origin/auth/WebSocket tests and vanilla pairing gate; remove when upstream provides equivalent explicit reverse-proxy origin and label semantics                                        |
| Configurable pairing and client-session lifetimes | retain             | Server configuration and auth stores                                  | Config parsing, expiry tests, and immutable OCI environment evidence; remove when upstream exposes equivalent deploy-time controls                                                      |
| Hosted browser distribution identity              | retain             | Web build-time presentation                                           | Vanilla web build and branding tests; never changes Desktop or Mobile identity                                                                                                          |
| Arbitrary file attachments                        | migrate            | Upstream contracts, storage, orchestration, web, and official clients | v0.0.38 source and tests own upload, pending-upload lifecycle, authenticated download, browser composer, and Mobile support; the former Lazurio `contextFiles` implementation is absent |
| Reproducible hosted OCI packaging                 | retain             | `Dockerfile.lazurio`, version stamping, release evidence              | Offline runtime smoke, non-root user, SBOM, provenance, attestation, immutable tag and digest                                                                                           |
| Fork-safe automation boundary                     | retain             | `.github/FORK-SAFETY.md` and Lazurio workflows                        | Exactly the read-only fork CI and manually authorized release workflow remain active                                                                                                    |

The fork does not change `apps/mobile`, `apps/desktop`, shared protocol packages, upstream
attachment storage, or upstream migrations. It does not add Lazurio clients, endpoints, wire
variants, IAM, DNS, proxy configuration, or Team authorization. The Builder image and its Codex
CLI version are owned by Machines, not this repository.

The release image injects the generic browser name `Lazurio T3 Code`. The existing
`T3CODE_ENVIRONMENT_LABEL` supplies the Organization/Team label at runtime, so a header can read
`Lazurio T3 Code — Spectoda / Matěj` without a Spectoda-specific source patch.

## Stable refresh procedure

### 1. Freeze inputs

Record current `origin/main`, the new upstream stable tag and peeled SHA, the prior immutable
Lazurio release/digest, and the live canary migration ledger. Fetch the tag from
`pingdotgg/t3code`; a release note, branch, or moving nightly reference is not source evidence.

Create the candidate at the exact upstream commit. Do not merge the old fork into it and do not
cherry-pick the old overlay wholesale. Classify every overlay capability in the PR description.

### 2. Reconstruct the minimum overlay

Review the current upstream seams before implementing retained capabilities. Delete capabilities
that upstream now owns. Update the exact tag/SHA checks, package stamping, CI, documentation, and
OCI build metadata together. The diff against the upstream tag must contain only classified
overlay behavior.

For v0.0.38, arbitrary file attachments are wholly upstream-owned. The Lazurio `contextFiles`
wire field, web implementation, compatibility fixture, migration 44 source, and migration-contract
test must not be restored.

### 3. Prove the candidate

Run formatting, lint, server/web/shared typechecks, focused hosted-origin and lifetime tests, the
upstream file-attachment tests on Linux and Windows, the vanilla web build, release-contract tests,
and an OCI build/runtime smoke. Any unknown migration, restored publishing workflow, protected
client change, or unclassified capability stops the refresh.

### 4. Prove the exact publication join

After the candidate tree is approved, fetch current `origin/main` and the protected `lazurio-*`
tags again. The exact current `main` must equal one existing protected immutable release tag. The
open Ready PR must have an approval from an authorized Principal on the exact candidate HEAD, no
unresolved conversation, and green deterministic checks. A changed candidate HEAD invalidates the
approval and check evidence.

Record all four immutable inputs before publication:

```bash
expected_old_main=<exact-fetched-origin-main-sha>
protected_previous_release_tag=<existing-protected-lazurio-tag>
upstream_sha=c0995d2eaf8ec787b3318ed1169ae266ed1529f8
candidate_head=<exact-green-approved-candidate-sha>

test "$(git rev-parse "$protected_previous_release_tag^{commit}")" = "$expected_old_main"
test "$(git merge-base "$upstream_sha" "$candidate_head")" = "$upstream_sha"
test "$(git rev-list --merges "$upstream_sha..$candidate_head" --count)" = 0
```

The candidate must start at the exact stable upstream SHA and contain only the reviewed semantic
overlay commits. It must not contain a history bridge, the previous `main`, or a wholesale replay
of the previous overlay.

### 5. Publish the rolling distribution snapshot

Immediately before publication, fetch `origin/main` again. A changed value, candidate HEAD,
approval, check result, conversation state, tag protection, or ruleset stops the cutover and
requires a fresh readback. After the Organization Admin gives an explicit publication instruction
bound to the displayed old and new SHAs, update the ref only with:

```bash
git push \
  --force-with-lease="refs/heads/main:$expected_old_main" \
  origin "$candidate_head:refs/heads/main"
```

A failed lease is concurrent publication and must never be retried automatically. Plain `--force`,
delete/recreate, a symbolic local branch refspec, or an unverified expected SHA is forbidden.
Read back `refs/heads/main` and require it to equal `candidate_head` exactly.

Live GitHub policy must require a PR for ordinary changes, block deletion, and require
`Server and web compatibility` plus `Windows generic-file compatibility`. Only Organization Admins
may bypass for the rolling stable cutover; writers and automation may not. Greptile is advisory and
must not block an otherwise deterministic stable refresh. Read provider policy back before
publication; prose is not evidence of live configuration.

### 6. Release and deploy separately

After source publication, create the next immutable `lazurio-vX.Y.Z-rN` tag and dispatch the
protected release workflow with exact source and upstream SHAs. Source merge does not publish OCI,
change an infrastructure pin, or deploy a Workspace. Promote the resulting digest to the selected
Spectoda canary first, prove it, and only then expand serially.

A failed artifact remains immutable. Correct it through a new reviewed candidate and new release
tag or restore the prior exact digest; never reuse a tag or mutate an existing artifact.

## Hosted origin semantics

A Team Workspace uses an explicit HTTPS browser origin while the server stays loopback-bound behind
the operator-managed proxy:

```bash
T3CODE_EXTERNAL_ORIGIN=https://t3code.matej.spectoda.lazurio.io
T3CODE_ENVIRONMENT_LABEL="Spectoda / Matěj"
t3 serve --host 127.0.0.1
```

The external origin rejects credentials, paths, queries, fragments, and non-HTTPS values. It does
not trust forwarded authority headers. Cookie-authenticated mutations and WebSocket upgrades must
match the configured origin. Bearer/DPoP clients, one-use pairing, scope delegation, TLS, ingress
authentication, DNS, and Team authorization keep their existing owners.

## Fork-safe automation

Only two workflows are active:

- `lazurio-fork-ci.yml`: read-only CI for exact upstream ancestry, protected boundaries,
  compatibility tests, web build, release contract, and non-publishing OCI smoke;
- `lazurio-release.yml`: manually dispatched immutable GHCR and GitHub Release publication behind
  the `lazurio-t3code-release` environment.

The release workflow accepts only an existing immutable Lazurio tag whose exact source is already
on `main`. It publishes one GHCR tag with SBOM, provenance, attestation, checksums, and release
evidence. It publishes no `latest`, branch, client package, relay, infrastructure pin, or live
deployment.
Absence checks are fail-closed: publication continues only after GitHub returns an unambiguous
release not-found response and the authenticated GitHub Packages API successfully enumerates every
GHCR package version without finding the requested tag. Authentication, network, registry, query,
and rate-limit failures stop the release.

For v0.0.38, package stamping changes only server and web manifests to `0.0.38` during the image
build, so discovery reports the release version while source package manifests remain upstream.

## Legacy migration 44 reconciliation

The old Lazurio v0.0.35 file lane recorded migration id `44` as
`LazurioProjectionThreadMessagesContextFiles`. Upstream v0.0.38 ends at migration 43 and no longer
needs that source migration, but a live database may still contain the historical ledger row and
extra nullable column. The candidate must never delete or rewrite them automatically.

Before canary promotion, stop the selected Workspace, take and verify a database backup, and read
the ledger. If and only if id 44 has the exact historical name and no higher migration exists, an
explicitly authorized operator may remove that one ledger row in a reviewed transaction:

```sql
DELETE FROM effect_sql_migrations
WHERE migration_id = 44
  AND name = 'LazurioProjectionThreadMessagesContextFiles';
```

Require exactly one affected row. Keep the now-unused nullable column; dropping it provides no
runtime benefit and increases recovery risk. Start v0.0.38, verify the ledger maximum is 43, then
exercise old and new threads plus file upload/download. If any precondition or affected-row count
differs, roll back and investigate. Never delete by id alone.

This reconciliation prevents a future upstream migration 44 from being skipped. It is an
operational data migration and therefore requires a separate destructive-action authorization; it
is not hidden inside source publication or image startup.

## Canary acceptance and rollback

Against the exact deployed digest, prove:

1. environment discovery, one-use pairing, token exchange, and WebSocket connection;
2. project and thread loading, an old thread, a new turn, and reconnect after restart;
3. browser upload/download of a non-image file using the upstream v0.0.38 implementation;
4. official Desktop reconnect, session revocation, and Mobile pairing/file upload;
5. stable Workspace volumes, sessions, projects, and files before and after restart.

Any failure stops rollout. Rollback restores the prior immutable digest over the same persistent
volumes and repeats health checks; it never replaces volumes with empty ones.

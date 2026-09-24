# Lazurio T3 Code distribution

`Lazurio/t3code` distributes the vanilla upstream T3 Code server and web client for Lazurio
Workspaces. T3 is always served at the root of its own hostname
(`https://t3code.<vm>.<org>.lazurio.io/`) behind a TLS reverse proxy. Official desktop and
mobile apps connect as unmodified upstream clients.

## Overlay

`main` is the exact upstream stable tag followed only by these commits:

| Commit                                                   | Why Lazurio needs it                                                                                                                                                                                                         |
| -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `hosted: configurable client session TTL`                | `T3CODE_CLIENT_SESSION_TTL` (Machines sets `365d` and refuses a release whose `dist` does not contain that name).                                                                                                            |
| `hosted: serve behind an explicit HTTPS external origin` | `T3CODE_EXTERNAL_ORIGIN`: a loopback-bound server behind the proxy is remote-reachable, uses the Secure `__Host-t3_session` cookie, and accepts cookie-authenticated mutations and WebSocket upgrades only from that origin. |
| `hosted: explicit environment label`                     | `T3CODE_ENVIRONMENT_LABEL` names a containerized Workspace (for example `Iotor / Management`).                                                                                                                               |
| `release: Lazurio distribution`                          | This document, `Dockerfile.lazurio`, `.dockerignore`, version stamping, the contract test, and the two Lazurio workflows.                                                                                                    |

Unset variables keep upstream behavior. Remove a commit as soon as upstream offers an
equivalent. Nothing in the overlay touches clients, shared packages, or wire contracts; CI
rejects such changes.

## Artifacts

- **Native release (VM lane).** Machines builds it from an exact fork revision with
  `workloads/workspace-vm/build-t3-native.sh`, which runs
  `scripts/lazurio-stamp-package-version.mjs <upstream version>` and writes
  `lazurio-native-release.json` (`lazurio.t3-native-release.v1`, `base_path: "/"`).
- **OCI image (Docker lane).** `lazurio-release.yml` publishes `ghcr.io/lazurio/t3code:<tag>`
  with SBOM, provenance, attestation and a GitHub Release. The image sets
  `T3CODE_CLIENT_SESSION_TTL=365d`; the origin and label are set per Workspace at runtime.

Package stamping sets only the server and web manifest versions, because upstream stamps
versions at publish time and its source manifests lag behind the tag.

## Stable refresh

1. Create the candidate branch at the exact upstream stable tag. Do not merge or replay the old
   `main`; port each kept capability by intent onto the new upstream code.
2. Update `UPSTREAM_TAG`/`UPSTREAM_SHA` in `lazurio-fork-ci.yml` and the pinned SHA in the
   contract test. Keep the diff against the tag to the overlay above.
3. Prove it: `Lazurio Fork CI` green (focused server tests, typecheck, contract test, image build
   with terminal self-check).
4. Publish the source. Before the cutover, protect the current `main` with an immutable
   `lazurio-*` release or `lazurio-archive-*` tag. With an approved, green candidate and the
   Organization Admin's explicit instruction bound to both SHAs:

   ```bash
   git push --force-with-lease="refs/heads/main:$expected_old_main" \
     origin "$candidate_head:refs/heads/main"
   ```

   A failed lease is a concurrent change; never retry it automatically.

5. Release separately: tag `lazurio-vX.Y.Z-rN` on the new `main` and dispatch
   `lazurio-release.yml` with the exact source and upstream SHAs. Releasing never changes an
   infrastructure pin; Machines rolls it out through its own reviewed pins.

## Automation boundary

Upstream workflow files stay in the tree so refreshes stay diff-free, but they are **disabled in
this repository's Actions settings** (Actions → select workflow → Disable). They need Blacksmith
runners and upstream secrets, so they cannot publish from this repository; left enabled they
only queue or fail, and `pr-vouch`/`pr-size` would label our pull requests. After a refresh that
adds a new upstream workflow, disable it too:

```bash
gh workflow list --repo Lazurio/t3code --all --json id,path,state \
  | jq -r '.[] | select(.path | test("lazurio-") | not) | select(.state == "active") | .id' \
  | xargs -n1 gh workflow disable --repo Lazurio/t3code
```

Only `lazurio-fork-ci.yml` (read-only, required check `Server and web compatibility`) and the
manually dispatched `lazurio-release.yml` stay active.

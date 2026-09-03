# Lazurio fork automation boundary

`Lazurio/t3code` distributes only the server-backed browser application used in Lazurio Team
Workspaces. It does not publish upstream desktop or mobile applications, deploy upstream relay or
hosted services, manage upstream labels, or run upstream release schedules.

The product capabilities for arbitrary file attachments are upstream-owned as of T3 Code v0.0.38.
The former Lazurio `contextFiles` implementation and its migration are not part of this fork. CI
keeps the upstream contract, server storage, web composer, and official client sources outside the
fork overlay and runs the upstream file-attachment tests on both Linux and Windows.

The remaining product overlay is limited to generic hosted-server configuration and browser
presentation: an explicit external origin, a Workspace label, configurable authentication
lifetimes, and an opt-in hosted application name. These settings do not create a second protocol,
identity system, or authorization source. Their upstream defaults remain unchanged; Lazurio-only
defaults belong to the immutable OCI image.

The only active workflows in this fork are read-only `lazurio-fork-ci.yml` and the separately
authorized, manually dispatched `lazurio-release.yml`. A stable refresh starts from the exact
upstream tag and reconstructs only the reviewed overlay as small semantic commits. Upstream
workflows are removed before publication.

`main` is the readable current distribution snapshot, not historical authority. An Organization
Admin may replace it only through the reviewed rolling stable-refresh contract, with the previous
state already protected by an immutable `lazurio-*` release tag and an exact expected-old
`--force-with-lease`. Release tags, OCI tags, deployed digests, and all other refs remain
non-rewritable.

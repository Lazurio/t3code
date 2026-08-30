# Lazurio fork automation boundary

`Lazurio/t3code` distributes only the server-backed browser application used in Lazurio Team
Workspaces. It does not publish upstream desktop or mobile applications, deploy the upstream relay
or hosted web application, manage upstream labels, or run upstream release schedules.

The sole product-level overlay is additive generic-file collaboration for the hosted browser. It
keeps the image attachment union and official client sources unchanged, and CI restricts contract
and client-runtime edits to an explicit file allowlist plus a decoder frozen to the exact upstream
stable. Equivalent future upstream support supersedes this overlay after migration reconciliation.

Generic server configuration seams may support the hosted distribution without changing vanilla
protocol behavior. They retain upstream defaults in source; Lazurio-only defaults such as pairing
and client-session lifetimes belong to the immutable OCI image and its release evidence, never to
Desktop, Mobile, per-Organization client forks, or a second authentication system.

The only active workflows in this fork are read-only `lazurio-fork-ci.yml` and the separately
protected, manually dispatched `lazurio-release.yml`. CI receives no Lazurio runtime or deployment
secrets, uses GitHub-hosted Ubuntu, and tests only the server/web compatibility and OCI packaging
surface maintained by the fork. Release publication is gated by the protected
`lazurio-t3code-release` environment.

Every upstream sync must treat new or restored files under `.github/workflows/` as a release-blocking
review item. Do not merge a sync that reintroduces an upstream workflow alongside the fork CI.
Publication of a fork tag, artifact, infrastructure pin, or live rollout remains a separate explicit
operator action; CI never performs promotion.

Stable refreshes follow the canonical
[compatibility-fork release contract](../docs/operations/lazurio-fork-release.md#stable-refresh-procedure).
The candidate starts from the exact upstream stable, classifies every semantic overlay as
`remove`, `retain`, or `migrate`, and joins current fork history only through a tree-neutral bridge.
`main` is published by a checked merge-commit pull request and must not be force-pushed or deleted.
The historical v0.0.34 and v0.0.35 controlled resets are not precedent for future updates.

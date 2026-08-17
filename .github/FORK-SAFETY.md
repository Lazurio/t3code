# Lazurio fork automation boundary

`Lazurio/t3code` distributes only the server-backed browser application used in Lazurio Team
Workspaces. It does not publish upstream desktop or mobile applications, deploy the upstream relay
or hosted web application, manage upstream labels, or run upstream release schedules.

The only active workflow in this fork is `lazurio-fork-ci.yml`. It has read-only repository
permission, receives no Lazurio runtime or deployment secrets, uses GitHub-hosted Ubuntu, and tests
only the server/web compatibility surface maintained by the fork.

Every upstream sync must treat new or restored files under `.github/workflows/` as a release-blocking
review item. Do not merge a sync that reintroduces an upstream workflow alongside the fork CI.
Publication of a fork tag, artifact, infrastructure pin, or live rollout remains a separate explicit
operator action; CI never performs promotion.

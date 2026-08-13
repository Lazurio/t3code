# Lazurio Hosted Fork Release Contract

This contract keeps Lazurio's hosted web variant reproducible without changing T3 Code's desktop,
mobile, authentication, or wire contracts. A release is an explicit reviewed snapshot of the fork;
hosted infrastructure must never follow a mutable branch or tag automatically.

## Opt-in hosted web build

The default build remains T3 Code. Only a hosted-channel web build may set the optional display
name:

```bash
VITE_HOSTED_APP_CHANNEL=latest \
VITE_HOSTED_APP_NAME="Lazurio T3 Code" \
vp run --filter @t3tools/web build
```

`VITE_HOSTED_APP_NAME` is ignored unless `VITE_HOSTED_APP_CHANNEL` is `latest` or `nightly`.
Desktop branding injected by the desktop shell has precedence, and the native mobile package does
not consume this hosted web setting. Vanilla desktop and mobile builds therefore continue to
identify themselves as T3 Code.

## DEV-6442 upstream provenance

- Fork: `https://github.com/Lazurio/t3code`
- Upstream: `https://github.com/pingdotgg/t3code`
- Fork `main` and DEV-6442 source base: `c196f422ed387a1cc2cdb671b0472782e5610339`
- Upstream `main` observed on 2026-08-13: `9e201941aaa9cfece3e0ffaa4cc24bbe880d1be4`
- GitHub comparison at implementation start: the source base was an upstream commit and upstream
  was 32 commits ahead.

An upstream sync is a separate reviewed change. Do not silently replace the recorded base while
building or releasing DEV-6442.

## Required release evidence

Before any release or deployment, create one immutable evidence record next to the packaged web
artifact. It must contain:

```json
{
  "schema_version": "t3code.fork-release.v1",
  "source": {
    "repository": "https://github.com/Lazurio/t3code",
    "commit": "<exact 40-character fork commit>",
    "upstream_repository": "https://github.com/pingdotgg/t3code",
    "upstream_base": "c196f422ed387a1cc2cdb671b0472782e5610339"
  },
  "artifact": {
    "name": "<immutable artifact name>",
    "sha256": "<64-character digest>"
  },
  "configuration": {
    "hosted_app_channel": "latest",
    "hosted_app_name": "Lazurio T3 Code"
  },
  "validation": {
    "checks": [
      "focused web tests",
      "focused server authorization tests",
      "default web build",
      "opt-in hosted web build",
      "vanilla desktop pairing smoke",
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
git merge-base HEAD c196f422ed387a1cc2cdb671b0472782e5610339
shasum -a 256 <packaged-artifact>
```

The merge-base command must return the recorded upstream base. The evidence record and packaged
artifact are a pair: changing either requires a new digest and a new review.

## Pin and publication gates

Hosted infrastructure must pin the immutable artifact digest and record the exact evidence object;
it must not pin `main`, a moving hosted channel, or an unqualified image tag. Promotion and rollback
change only that explicit pin.

A release remains blocked unless all listed checks passed against the recorded source commit and
Fable 5 reviewed the exact plan and diff. Creating a GitHub Release, publishing an artifact,
changing a hosted pin, or deploying live infrastructure requires a separate explicit instruction.

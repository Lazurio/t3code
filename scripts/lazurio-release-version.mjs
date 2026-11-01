// Refuses a release version that is not the highest on its channel, deriving channels exactly as
// upstream's cliReleaseChannelOf does. VERSION and CHANNEL come from the environment:
//   node scripts/lazurio-release-version.mjs <slurped `gh api --paginate` releases.json>
import * as NodeFS from "node:fs";

import { compareExactServiceVersions } from "../apps/server/src/cloud/serviceProtocol.ts";
import { cliReleaseChannelOf } from "../packages/shared/src/cliRelease.ts";

const version = process.env.VERSION;
const channel = cliReleaseChannelOf(version);
if (channel !== process.env.CHANNEL) {
  throw new Error(`${version} is on the ${channel} channel, not ${process.env.CHANNEL}.`);
}
const releases = JSON.parse(NodeFS.readFileSync(process.argv[2], "utf8")).flat();
if (releases.some((release) => release.tag_name === `v${version}`)) {
  throw new Error(`A GitHub Release for v${version} already exists.`);
}
for (const release of releases) {
  if (release.draft) continue;
  const published = /^v(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)$/.exec(release.tag_name)?.[1];
  if (published === undefined || cliReleaseChannelOf(published) !== channel) continue;
  if (compareExactServiceVersions(version, published) <= 0) {
    throw new Error(`${version} is not newer than the published ${published} on ${channel}.`);
  }
}
console.log(`${version} is the highest version on the ${channel} channel.`);

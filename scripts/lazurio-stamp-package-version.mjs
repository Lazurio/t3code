import * as NodeFSP from "node:fs/promises";

const version = process.argv[2];
if (!version || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) {
  throw new Error("Expected one exact T3 Code package version.");
}

const packageFiles = [
  ["apps/server/package.json", "t3"],
  ["apps/web/package.json", "@t3tools/web"],
];

for (const [filePath, expectedName] of packageFiles) {
  const packageJson = JSON.parse(await NodeFSP.readFile(filePath, "utf8"));
  if (packageJson.name !== expectedName) {
    throw new Error("Unexpected package at " + filePath + ": " + String(packageJson.name));
  }
  await NodeFSP.writeFile(
    filePath,
    JSON.stringify({ ...packageJson, version }, null, 2) + "\n",
    "utf8",
  );
}

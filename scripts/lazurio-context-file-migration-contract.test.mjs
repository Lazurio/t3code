import * as NodeAssert from "node:assert/strict";
import * as NodeFSP from "node:fs/promises";
import * as NodeTest from "node:test";

const migrations = await NodeFSP.readFile("apps/server/src/persistence/Migrations.ts", "utf8");
const migration = await NodeFSP.readFile(
  "apps/server/src/persistence/Migrations/044_ProjectionThreadMessagesContextFiles.ts",
  "utf8",
);
const forkCi = await NodeFSP.readFile(".github/workflows/lazurio-fork-ci.yml", "utf8");
const runbook = await NodeFSP.readFile("docs/operations/lazurio-fork-release.md", "utf8");

const migrationEntries = [...migrations.matchAll(/^\s*\[(\d+),\s*"([^"]+)"/gm)].map((match) => ({
  id: Number(match[1]),
  name: match[2],
}));

NodeTest.test("the fork migration owns one explicit, last migration lease", () => {
  const leased = migrationEntries.filter(
    (entry) => entry.name === "LazurioProjectionThreadMessagesContextFiles",
  );
  NodeAssert.deepEqual(leased, [{ id: 44, name: "LazurioProjectionThreadMessagesContextFiles" }]);
  NodeAssert.equal(Math.max(...migrationEntries.map((entry) => entry.id)), 44);
  NodeAssert.deepEqual(migrationEntries.at(-1), leased[0]);
  NodeAssert.match(migration, /PRAGMA table_info\(projection_thread_messages\)/);
  NodeAssert.match(migration, /context_files_json/);
});

NodeTest.test("CI keeps the stable decoder and migration reconciliation gates live", () => {
  NodeAssert.match(forkCi, /vanilla-v0\.0\.35-compat\.test\.ts/);
  NodeAssert.match(
    forkCi,
    /node --test scripts\/lazurio-context-file-migration-contract\.test\.mjs/,
  );
});

NodeTest.test("the rollout runbook makes migration lease reconciliation explicit", () => {
  NodeAssert.match(runbook, /LazurioProjectionThreadMessagesContextFiles/);
  NodeAssert.match(runbook, /DELETE FROM effect_sql_migrations/);
  NodeAssert.match(runbook, /migration_id = 44/);
  NodeAssert.match(runbook, /database backup/i);
  NodeAssert.match(runbook, /pinned vanilla/i);
});

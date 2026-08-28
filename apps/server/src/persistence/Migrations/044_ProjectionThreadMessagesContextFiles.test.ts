import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { runMigrations } from "../Migrations.ts";
import * as NodeSqliteClient from "../NodeSqliteClient.ts";

const addColumnLayer = it.layer(Layer.mergeAll(NodeSqliteClient.layerMemory()));

addColumnLayer("044_ProjectionThreadMessagesContextFiles add", (it) => {
  it.effect("adds the context-files projection column", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;

      yield* runMigrations({ toMigrationInclusive: 43 });
      yield* runMigrations({ toMigrationInclusive: 44 });

      const columns = yield* sql<{ readonly name: string }>`
        PRAGMA table_info(projection_thread_messages)
      `;
      assert.equal(columns.filter((column) => column.name === "context_files_json").length, 1);
    }),
  );
});

const preexistingColumnLayer = it.layer(Layer.mergeAll(NodeSqliteClient.layerMemory()));

preexistingColumnLayer("044_ProjectionThreadMessagesContextFiles reconcile", (it) => {
  it.effect("accepts a downstream database that already materialized the column", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;

      yield* runMigrations({ toMigrationInclusive: 43 });
      yield* sql`
        ALTER TABLE projection_thread_messages
        ADD COLUMN context_files_json TEXT
      `;
      yield* runMigrations({ toMigrationInclusive: 44 });

      const columns = yield* sql<{ readonly name: string }>`
        PRAGMA table_info(projection_thread_messages)
      `;
      assert.equal(columns.filter((column) => column.name === "context_files_json").length, 1);
    }),
  );
});

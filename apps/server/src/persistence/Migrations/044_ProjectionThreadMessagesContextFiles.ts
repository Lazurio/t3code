import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

/**
 * Keep arbitrary context files on the same ordered message projection that
 * owns image attachments. The existence check makes the migration safe when
 * a downstream distribution has already materialized the column under a
 * renumbered migration during an upstream stable reconciliation.
 */
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const columns = yield* sql<{ readonly name: string }>`
    PRAGMA table_info(projection_thread_messages)
  `;

  if (!columns.some((column) => column.name === "context_files_json")) {
    yield* sql`
      ALTER TABLE projection_thread_messages
      ADD COLUMN context_files_json TEXT
    `;
  }
});

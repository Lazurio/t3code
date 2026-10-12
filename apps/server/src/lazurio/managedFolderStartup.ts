import { CommandId, ProjectId } from "@t3tools/contracts";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as ServerConfig from "../config.ts";
import * as OrchestrationEngine from "../orchestration/Services/OrchestrationEngine.ts";
import * as ProjectionSnapshotQuery from "../orchestration/Services/ProjectionSnapshotQuery.ts";

// The server is the only writer. Machines declares the Folder in its unit;
// this uses native commands, never the CLI's offline fallback or a DB edit.
export const ensureManagedFolderProject = Effect.gen(function* () {
  const { lazurioFolder } = yield* ServerConfig.ServerConfig;
  if (lazurioFolder === undefined) return {};
  const query = yield* ProjectionSnapshotQuery.ProjectionSnapshotQuery;
  const engine = yield* OrchestrationEngine.OrchestrationEngineService;
  const crypto = yield* Crypto.Crypto;
  const existing = yield* query.getActiveProjectByWorkspaceRoot(lazurioFolder);
  const projectId = Option.isSome(existing)
    ? existing.value.id
    : ProjectId.make(yield* crypto.randomUUIDv4);
  if (Option.isNone(existing)) {
    yield* engine.dispatch({
      type: "project.create",
      commandId: CommandId.make(yield* crypto.randomUUIDv4),
      projectId,
      title: "Lazurio",
      workspaceRoot: lazurioFolder,
      createdAt: DateTime.formatIso(yield* DateTime.now),
    });
  } else if (existing.value.title !== "Lazurio") {
    yield* engine.dispatch({
      type: "project.meta.update",
      commandId: CommandId.make(yield* crypto.randomUUIDv4),
      projectId,
      title: "Lazurio",
    });
  }
  return { bootstrapProjectId: projectId, bootstrapProjectCreated: Option.isNone(existing) };
});

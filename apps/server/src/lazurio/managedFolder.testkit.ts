// @effect-diagnostics nodeBuiltinImport:off - the Folder and the database are real files.
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import type * as SqlClient from "effect/sql/SqlClient";

import * as ServerConfig from "../config.ts";
import * as RuntimeLayer from "../orchestration-v2/runtimeLayer.ts";
import * as ProjectEnrichmentService from "../project/ProjectEnrichmentService.ts";
import * as ProjectFaviconResolver from "../project/ProjectFaviconResolver.ts";
import * as RepositoryIdentityResolver from "../project/RepositoryIdentityResolver.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as WorkspacePaths from "../workspace/WorkspacePaths.ts";

/**
 * A managed Environment on disk: its Folder, a repository inside it, one beside it (an earlier
 * project), a symlink to the Folder, and where its database goes.
 */
export const makeFolderDirectories = () => {
  const parent = NodeFS.realpathSync(
    NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3-lazurio-folder-")),
  );
  const folder = NodePath.join(parent, "Lazurio");
  const inside = NodePath.join(folder, "organizations", "example");
  const repository = NodePath.join(parent, "repository");
  const link = NodePath.join(parent, "link-to-Lazurio");
  NodeFS.mkdirSync(inside, { recursive: true });
  NodeFS.mkdirSync(repository);
  NodeFS.symlinkSync(folder, link);
  return { parent, folder, inside, repository, link, database: NodePath.join(parent, "db.sqlite") };
};

/** The test server config, with `lazurioFolder` as `T3CODE_LAZURIO_FOLDER` would set it. */
export const layerManagedConfig = (lazurioFolder?: string) =>
  Layer.effect(
    ServerConfig.ServerConfig,
    Effect.map(ServerConfig.ServerConfig, (config) => ({
      ...config,
      ...(lazurioFolder === undefined ? {} : { lazurioFolder }),
    })),
  ).pipe(Layer.provide(ServerConfig.layerTest(process.cwd(), { prefix: "t3-lazurio-folder-" })));

const layerWorkspacePaths = Layer.succeed(WorkspacePaths.WorkspacePaths, {
  normalizeWorkspaceRoot: (workspaceRoot) => Effect.succeed(workspaceRoot.replace(/\/$/, "")),
  resolveRelativePathWithinRoot: ({ workspaceRoot, relativePath }) =>
    Effect.succeed({ absolutePath: `${workspaceRoot}/${relativePath}`, relativePath }),
});

const layerMetadata = Layer.merge(
  Layer.succeed(RepositoryIdentityResolver.RepositoryIdentityResolver, {
    resolve: () => Effect.succeed(null),
  }),
  Layer.succeed(ProjectFaviconResolver.ProjectFaviconResolver, {
    resolvePath: () => Effect.succeed(null),
  }),
);

/** The server's project service as `runtimeLayer.ts` builds it, over `persistence`. */
export const layerProjects = <E, R>(input: {
  readonly persistence: Layer.Layer<SqlClient.SqlClient, E, R>;
  readonly lazurioFolder?: string;
}) =>
  RuntimeLayer.layerProjectService.pipe(
    Layer.provideMerge(ProjectEnrichmentService.layer),
    Layer.provideMerge(layerWorkspacePaths),
    Layer.provideMerge(layerMetadata),
    Layer.provideMerge(input.persistence),
    Layer.provideMerge(ServerSettings.layerTest()),
    Layer.provideMerge(layerManagedConfig(input.lazurioFolder)),
    Layer.provideMerge(NodeServices.layer),
  );

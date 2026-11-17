/**
 * Lazurio overlay (LazurioPlatform F51): decorators over the services `runtimeLayer.ts` builds, so
 * every transport (WebSocket, HTTP, MCP, CLI, scheduled tasks, the effect worker) keeps a managed
 * Environment's projects, commands and agent sessions in its Lazurio Folder and offers no Scratch.
 * Without `T3CODE_LAZURIO_FOLDER` each returns upstream's service as it is.
 */
import {
  type OrchestrationV2ServerCommand,
  type ProjectId,
  ServerPrepareTriageError,
  type ThreadId,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";

import * as ServerConfig from "../config.ts";
import * as Orchestrator from "../orchestration-v2/Orchestrator.ts";
import * as ProjectStore from "../orchestration-v2/ProjectStore.ts";
import * as ProviderSessionManager from "../orchestration-v2/ProviderSessionManager.ts";
import * as ManagedProjectFolders from "../project/ManagedProjectFolders.ts";
import * as ProjectService from "../project/ProjectService.ts";
import * as TriageService from "../triage/TriageService.ts";
import { BUDDY_PROJECT_TITLE, makeFolderGuard } from "./managedFolder.ts";

const projectElsewhere = "In this Environment, the Lazurio project is the Lazurio Folder itself.";
const projectMoved =
  "In this Environment a project cannot point to another folder. Use the Lazurio project.";
const projectRenamed = "This project keeps the name Lazurio.";
const projectRemoved = "The Lazurio project belongs to this Environment and cannot be removed.";
const triageUnavailable = "This Environment does not triage issues against upstream T3 Code.";
const projectArchived = "The Lazurio project belongs to this Environment and cannot be archived.";
const buddyProjectChanged =
  "Buddy's project belongs to this Environment: it keeps its name and cannot be archived or removed.";

const threadElsewhere =
  "Start a new chat in the Lazurio project. Agents in this Environment work in its Lazurio Folder; your earlier chats stay here as history.";
const threadInWorktree =
  "Chats in this Environment start in the Lazurio Folder, without a separate worktree.";

/**
 * Upstream's project service from `live`, which in a managed Environment creates a project only for
 * the Folder, keeps it named Lazurio, in place and not archived, and moves no project. Buddy's project
 * comes only from the startup's `bootstrap`, which no client, agent or CLI reaches, and stays as made.
 */
export const guardProjects = <E, R>(live: Layer.Layer<ProjectService.ProjectService, E, R>) =>
  Layer.effect(
    ProjectService.ProjectService,
    Effect.gen(function* () {
      const projects = yield* ProjectService.ProjectService;
      const guard = yield* makeFolderGuard;
      const { folder, buddyFolder } = guard;
      if (folder === undefined) return projects;
      const path = yield* Path.Path;
      const refuse = (projectId: ProjectId, refusal: string) =>
        Effect.fail(
          new ProjectService.ProjectOperationError({
            operation: "dispatch-project-command",
            projectId,
            cause: refusal,
          }),
        );
      const rootOf = (projectId: ProjectId) =>
        projects
          .getById(projectId)
          .pipe(Effect.map((project) => Option.getOrUndefined(project)?.workspaceRoot));
      // The Folder's project always has the Folder's canonical path as its root.
      const inFolder = <
        A extends { readonly projectId: ProjectId; readonly workspaceRoot: string },
      >(
        input: A,
      ) =>
        Effect.flatMap(guard.isFolder(input.workspaceRoot), (isFolder) =>
          isFolder
            ? Effect.succeed({ ...input, workspaceRoot: folder })
            : refuse(input.projectId, projectElsewhere),
        );
      // Buddy's project, likewise, has the Buddy folder's canonical path.
      const inFolderOrBuddy = <
        A extends { readonly projectId: ProjectId; readonly workspaceRoot: string },
      >(
        input: A,
      ) =>
        buddyFolder === undefined
          ? inFolder(input)
          : Effect.flatMap(guard.isBuddyFolder(input.workspaceRoot), (isBuddy) =>
              isBuddy ? Effect.succeed({ ...input, workspaceRoot: buddyFolder }) : inFolder(input),
            );
      return ProjectService.ProjectService.of({
        ...projects,
        create: Effect.fn("LazurioManagedFolder.createProject")((input) =>
          Effect.flatMap(inFolder(input), projects.create),
        ),
        bootstrap: Effect.fn("LazurioManagedFolder.bootstrapProject")((input) =>
          Effect.flatMap(inFolderOrBuddy(input), projects.bootstrap),
        ),
        update: Effect.fn("LazurioManagedFolder.updateProject")(function* (input) {
          if (input.workspaceRoot !== undefined) {
            const current = yield* projects.getById(input.projectId);
            if (
              Option.isSome(current) &&
              path.resolve(input.workspaceRoot.trim()) !== current.value.workspaceRoot
            )
              return yield* refuse(input.projectId, projectMoved);
          }
          if (input.title === undefined && input.archived !== true)
            return yield* projects.update(input);
          const root = yield* rootOf(input.projectId);
          if (root === folder) {
            if (input.title !== undefined && input.title !== "Lazurio")
              return yield* refuse(input.projectId, projectRenamed);
            // Archived, it would leave a new chat only "Add project", which this Environment refuses.
            if (input.archived === true) return yield* refuse(input.projectId, projectArchived);
          }
          if (buddyFolder !== undefined && root === buddyFolder) {
            if (input.title !== undefined && input.title !== BUDDY_PROJECT_TITLE)
              return yield* refuse(input.projectId, buddyProjectChanged);
            if (input.archived === true) return yield* refuse(input.projectId, buddyProjectChanged);
          }
          return yield* projects.update(input);
        }),
        delete: Effect.fn("LazurioManagedFolder.deleteProject")(function* (input) {
          const root = yield* rootOf(input.projectId);
          if (root === folder) return yield* refuse(input.projectId, projectRemoved);
          if (buddyFolder !== undefined && root === buddyFolder)
            return yield* refuse(input.projectId, buddyProjectChanged);
          return yield* projects.delete(input);
        }),
      });
    }),
  ).pipe(Layer.provide(live));

/**
 * Why a managed Environment refuses an orchestration command, or null: new threads, messages and
 * forks belong to the root of the Folder's or the Buddy folder's project, and no thread moves into
 * a worktree. A command whose thread is gone is left to upstream, which answers for it.
 */
const commandRefusal = (
  command: OrchestrationV2ServerCommand,
  state: {
    readonly isFolderProject: (projectId: ProjectId) => Effect.Effect<boolean>;
    readonly isInFolderRoot: (threadId: ThreadId) => Effect.Effect<boolean>;
  },
): Effect.Effect<string | null> => {
  const unless = (allowed: Effect.Effect<boolean>, refusal: string) =>
    Effect.map(allowed, (isAllowed) => (isAllowed ? null : refusal));
  switch (command.type) {
    case "thread.create":
      return command.worktreePath === null
        ? unless(state.isFolderProject(command.projectId), threadElsewhere)
        : Effect.succeed(threadElsewhere);
    case "thread.metadata.update":
      return Effect.succeed(command.worktreePath == null ? null : threadInWorktree);
    case "message.dispatch": {
      const strategy =
        command.dispatchMode.type === "defer_start"
          ? command.dispatchMode.workspaceStrategy
          : undefined;
      return strategy === undefined || strategy.type === "root"
        ? unless(state.isInFolderRoot(command.threadId), threadElsewhere)
        : Effect.succeed(threadInWorktree);
    }
    case "thread.fork":
      return unless(state.isInFolderRoot(command.sourceThreadId), threadElsewhere);
    case "delegated_task.request":
      return Effect.succeed(
        command.workspaceStrategy === undefined || command.workspaceStrategy.type === "root"
          ? null
          : threadInWorktree,
      );
    default:
      return Effect.succeed(null);
  }
};

/**
 * Upstream's orchestrator from `live`, which in a managed Environment rejects a command that would
 * start a thread, a message or a fork outside the Folder's or the Buddy folder's project root, or
 * move a thread into a worktree, before it is decided. Every command passes `dispatch`, so this holds for clients,
 * agents, scheduled tasks and the server's own launches alike.
 */
export const guardCommands = <E, R>(live: Layer.Layer<Orchestrator.OrchestratorV2, E, R>) =>
  Layer.effect(
    Orchestrator.OrchestratorV2,
    Effect.gen(function* () {
      const orchestrator = yield* Orchestrator.OrchestratorV2;
      const { lazurioFolder: folder, lazurioBuddyFolder } = yield* ServerConfig.ServerConfig;
      if (folder === undefined) return orchestrator;
      const buddyFolder = typeof lazurioBuddyFolder === "string" ? lazurioBuddyFolder : undefined;
      const projects = yield* ProjectStore.ProjectStoreV2;
      // A lookup that fails refuses: the guard fails closed. Buddy's project counts as the Folder's.
      const isFolderProject = (projectId: ProjectId) =>
        projects.get(projectId).pipe(
          Effect.map(
            Option.exists(
              (project) =>
                project.workspaceRoot === folder ||
                (buddyFolder !== undefined && project.workspaceRoot === buddyFolder),
            ),
          ),
          Effect.orElseSucceed(() => false),
        );
      const isInFolderRoot = (threadId: ThreadId) =>
        orchestrator.getThreadShell(threadId).pipe(
          Effect.flatMap((thread) =>
            thread === null
              ? Effect.succeed(true)
              : thread.worktreePath === null
                ? isFolderProject(thread.projectId)
                : Effect.succeed(false),
          ),
          Effect.orElseSucceed(() => false),
        );
      return Orchestrator.OrchestratorV2.of({
        ...orchestrator,
        dispatch: Effect.fn("LazurioManagedFolder.dispatch")((command) =>
          Effect.flatMap(commandRefusal(command, { isFolderProject, isInFolderRoot }), (refusal) =>
            refusal === null
              ? orchestrator.dispatch(command)
              : Effect.fail(
                  new Orchestrator.OrchestratorCommandRejectedError({
                    commandId: command.commandId,
                    commandType: command.type,
                    cause: refusal,
                  }),
                ),
          ),
        ),
      });
    }),
  ).pipe(Layer.provide(live));

/**
 * Upstream's provider session manager from `live`, which in a managed Environment opens a session
 * only where the run's workspace resolves to the Folder or the Buddy folder itself. A turn elsewhere,
 * or in a Folder path that now leads somewhere else, fails as a session that did not open, with the reason, and
 * the provider is never started; upstream then settles the run as failed.
 */
export const guardTurns = <E, R>(
  live: Layer.Layer<ProviderSessionManager.ProviderSessionManagerV2, E, R>,
) =>
  Layer.effect(
    ProviderSessionManager.ProviderSessionManagerV2,
    Effect.gen(function* () {
      const sessions = yield* ProviderSessionManager.ProviderSessionManagerV2;
      const guard = yield* makeFolderGuard;
      if (guard.folder === undefined) return sessions;
      return ProviderSessionManager.ProviderSessionManagerV2.of({
        ...sessions,
        open: Effect.fn("LazurioManagedFolder.openSession")((input) =>
          Effect.flatMap(guard.turnRefusal(input.runtimePolicy.cwd), (refusal) =>
            refusal === null
              ? sessions.open(input)
              : Effect.fail(
                  new ProviderSessionManager.ProviderSessionOpenError({
                    instanceId: input.modelSelection.instanceId,
                    providerSessionId: input.providerSessionId,
                    cause: refusal,
                  }),
                ),
          ),
        ),
      });
    }),
  ).pipe(Layer.provide(live));

/**
 * A managed Environment offers no Scratch folder (to any client, and no earlier Scratch project
 * counts as one) and no project started from just a name, refused before any folder or repository
 * is made: the Folder is the only project there.
 */
export const guardScratch = <E, R>(
  live: Layer.Layer<ManagedProjectFolders.ManagedProjectFolders, E, R>,
) =>
  Layer.effect(
    ManagedProjectFolders.ManagedProjectFolders,
    Effect.gen(function* () {
      const folders = yield* ManagedProjectFolders.ManagedProjectFolders;
      const { baseDir, lazurioFolder } = yield* ServerConfig.ServerConfig;
      if (lazurioFolder === undefined) return folders;
      return ManagedProjectFolders.ManagedProjectFolders.of({
        ...folders,
        scratchRoot: Effect.succeedNone,
        ensureScratchProject: Effect.fail(
          new ManagedProjectFolders.ScratchUnavailableError({ baseDir }),
        ),
        isScratchProject: Effect.fn("LazurioManagedFolder.isScratchProject")(() =>
          Effect.succeed(false),
        ),
        folderForThread: Effect.fn("LazurioManagedFolder.folderForThread")(
          () => Effect.succeedNone,
        ),
        createNamedProject: Effect.fn("LazurioManagedFolder.createNamedProject")(() =>
          Effect.fail(
            new ManagedProjectFolders.NamedProjectCreateError({
              workspaceRoot: folders.namedProjectsRoot,
              cause: projectElsewhere,
            }),
          ),
        ),
      });
    }),
  ).pipe(Layer.provide(live));

/**
 * Upstream's triage service from `live`, which in a managed Environment starts no triage: it
 * compares against upstream's source without the overlay and drafts an issue there (Lazurio/t3code#147).
 * The descriptor does not offer it there either (`ServerEnvironment.ts`).
 */
export const guardTriage = <E, R>(live: Layer.Layer<TriageService.TriageService, E, R>) =>
  Layer.effect(
    TriageService.TriageService,
    Effect.gen(function* () {
      const triage = yield* TriageService.TriageService;
      const { lazurioFolder } = yield* ServerConfig.ServerConfig;
      if (lazurioFolder === undefined) return triage;
      return TriageService.TriageService.of({
        prepare: Effect.fn("LazurioManagedFolder.prepareTriage")(() =>
          Effect.fail(new ServerPrepareTriageError({ cause: triageUnavailable })),
        ),
      });
    }),
  ).pipe(Layer.provide(live));

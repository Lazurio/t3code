// @effect-diagnostics nodeBuiltinImport:off - the Folder is a real directory, moved in one case.
import * as NodeFS from "node:fs";

import * as NodeServices from "@effect/platform-node/NodeServices";
import {
  CommandId,
  type ModelSelection,
  type OrchestrationV2ThreadShell,
  MessageId,
  NodeId,
  type OrchestrationV2ServerCommand,
  type OrchestrationV2ThreadLaunchWorkspaceStrategy,
  ProjectId,
  ProviderInstanceId,
  ProviderSessionId,
  RunId,
  ThreadId,
} from "@t3tools/contracts";
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import * as Orchestrator from "../orchestration-v2/Orchestrator.ts";
import * as ProjectStore from "../orchestration-v2/ProjectStore.ts";
import * as ProviderSessionManager from "../orchestration-v2/ProviderSessionManager.ts";
import * as ThreadManagementService from "../orchestration-v2/ThreadManagementService.ts";
import * as SqlitePersistence from "../persistence/Sqlite.ts";
import * as ManagedProjectFolders from "../project/ManagedProjectFolders.ts";
import * as ProjectService from "../project/ProjectService.ts";
import * as ScratchThreadPromotion from "../project/ScratchThreadPromotion.ts";
import * as ScheduledTaskService from "../scheduledTasks/ScheduledTaskService.ts";
import * as LazurioManagedFolder from "./managedFolderGuards.ts";
import {
  layerManagedConfig,
  layerProjects,
  makeFolderDirectories,
} from "./managedFolder.testkit.ts";

const threadElsewhere =
  "Start a new chat in the Lazurio project. Agents in this Environment work in its Lazurio Folder; your earlier chats stay here as history.";
const threadInWorktree =
  "Chats in this Environment start in the Lazurio Folder, without a separate worktree.";
const turnOutsideFolder =
  "Agents in this Environment work in its Lazurio Folder. Start a new chat in the Lazurio project.";

/** The cause a refused project operation carries, or the operation's own failure tag. */
const projectRefusal = <A, R>(operation: Effect.Effect<A, ProjectService.ProjectServiceError, R>) =>
  operation.pipe(
    Effect.flip,
    Effect.map((error) => (error._tag === "ProjectOperationError" ? error.cause : error._tag)),
  );

describe("projects in a managed Environment", () => {
  it.effect("stay the Folder's one, named Lazurio and in place; earlier ones stay history", () => {
    const { folder, inside, repository, link, database, parent } = makeFolderDirectories();
    const persistence = SqlitePersistence.layerFromPath(database);
    const history = ProjectId.make("history");
    return Effect.gen(function* () {
      // An earlier project, from before the Environment was managed.
      yield* Effect.flatMap(ProjectService.ProjectService, (projects) =>
        projects.create({
          commandId: CommandId.make("create-history"),
          projectId: history,
          title: "History",
          workspaceRoot: repository,
        }),
      ).pipe(Effect.provide(layerProjects({ persistence })));

      yield* Effect.gen(function* () {
        const projects = yield* ProjectService.ProjectService;
        const create = (id: string, workspaceRoot: string) =>
          projects.create({
            commandId: CommandId.make(`create-${id}`),
            projectId: ProjectId.make(id),
            title: id,
            workspaceRoot,
          });
        for (const elsewhere of [parent, inside, repository]) {
          assert.strictEqual(
            yield* projectRefusal(create("elsewhere", elsewhere)),
            "In this Environment, the Lazurio project is the Lazurio Folder itself.",
            elsewhere,
          );
        }
        // A path that resolves to the Folder names it; its project has the Folder's own path.
        const { project: lazurio } = yield* projects.bootstrap({
          commandId: CommandId.make("bootstrap-lazurio"),
          projectId: ProjectId.make("lazurio"),
          title: "Lazurio",
          workspaceRoot: link,
        });
        assert.strictEqual(lazurio.workspaceRoot, folder);
        assert.strictEqual(
          yield* projectRefusal(create("second", `${folder}/`)),
          "ProjectConflictError",
        );

        let updates = 0;
        const update = (projectId: ProjectId, change: { title?: string; workspaceRoot?: string }) =>
          projects.update({
            commandId: CommandId.make(`update-${++updates}`),
            projectId,
            ...change,
          });
        assert.strictEqual(
          yield* projectRefusal(update(lazurio.id, { title: "Other" })),
          "This project keeps the name Lazurio.",
        );
        assert.strictEqual(
          yield* projectRefusal(update(history, { workspaceRoot: folder })),
          "In this Environment a project cannot point to another folder. Use the Lazurio project.",
        );
        assert.strictEqual(
          yield* projectRefusal(update(lazurio.id, { workspaceRoot: repository })),
          "In this Environment a project cannot point to another folder. Use the Lazurio project.",
        );
        assert.strictEqual(
          yield* projectRefusal(
            projects.delete({ commandId: CommandId.make("delete-lazurio"), projectId: lazurio.id }),
          ),
          "The Lazurio project belongs to this Environment and cannot be removed.",
        );
        // What keeps the entry context is allowed: the same name and root, and earlier projects.
        yield* update(lazurio.id, { title: "Lazurio", workspaceRoot: `${folder}/` });
        yield* update(history, { title: "Renamed history" });
        yield* projects.delete({ commandId: CommandId.make("delete-history"), projectId: history });
        assert.isTrue(Option.isNone(yield* projects.getById(history)));
        const kept = Option.getOrThrow(yield* projects.getById(lazurio.id));
        assert.deepStrictEqual([kept.title, kept.workspaceRoot], ["Lazurio", folder]);
      }).pipe(Effect.provide(layerProjects({ persistence, lazurioFolder: folder })));
    });
  });

  it.effect("are upstream's without T3CODE_LAZURIO_FOLDER", () => {
    const { parent, repository } = makeFolderDirectories();
    return Effect.gen(function* () {
      const projects = yield* ProjectService.ProjectService;
      const created = yield* projects.create({
        commandId: CommandId.make("create-anywhere"),
        projectId: ProjectId.make("anywhere"),
        title: "Anywhere",
        workspaceRoot: parent,
      });
      yield* projects.update({
        commandId: CommandId.make("move-anywhere"),
        projectId: created.id,
        title: "Moved",
        workspaceRoot: repository,
      });
      yield* projects.delete({
        commandId: CommandId.make("delete-anywhere"),
        projectId: created.id,
      });
    }).pipe(Effect.provide(layerProjects({ persistence: SqlitePersistence.layerMemory })));
  });
});

describe("orchestration commands in a managed Environment", () => {
  const { folder } = makeFolderDirectories();
  const folderProject = ProjectId.make("project-lazurio");
  const historyProject = ProjectId.make("project-history");
  const folderThread = ThreadId.make("thread-lazurio");
  const historyThread = ThreadId.make("thread-history");
  const worktreeThread = ThreadId.make("thread-worktree");
  const threads = new Map([
    [folderThread, { projectId: folderProject, worktreePath: null }],
    [historyThread, { projectId: historyProject, worktreePath: null }],
    [worktreeThread, { projectId: folderProject, worktreePath: `${folder}-worktree` }],
  ]);
  const roots = new Map([
    [folderProject, folder],
    [historyProject, "/home/person/older-repository"],
  ]);
  const modelSelection = { instanceId: ProviderInstanceId.make("codex"), model: "gpt-6.1-sol" };
  const creation = { createdBy: "user", creationSource: "web" } as const;

  /** The decorated orchestrator over a stand-in that records what reached it. */
  const withOrchestrator = (lazurioFolder: string | undefined) => {
    const reached: Array<string> = [];
    const layer = LazurioManagedFolder.guardCommands(
      Layer.mock(Orchestrator.OrchestratorV2)({
        dispatch: (command) =>
          Effect.sync(() => {
            reached.push(command.commandId);
            return { sequence: reached.length, storedEvents: [] };
          }),
        getThreadShell: (threadId) => Effect.succeed((threads.get(threadId) ?? null) as never),
      }),
    ).pipe(
      Layer.provide(
        Layer.mock(ProjectStore.ProjectStoreV2)({
          get: (projectId) =>
            Effect.succeed(
              Option.map(Option.fromUndefinedOr(roots.get(projectId)), (workspaceRoot) => ({
                workspaceRoot,
              })) as never,
            ),
        }),
      ),
      Layer.provide(layerManagedConfig(lazurioFolder)),
      Layer.provide(NodeServices.layer),
    );
    return { reached, layer };
  };
  const refusalOf = (command: OrchestrationV2ServerCommand) =>
    Effect.flatMap(Orchestrator.OrchestratorV2, (orchestrator) =>
      orchestrator.dispatch(command).pipe(
        Effect.as(null),
        Effect.catch((error) =>
          Effect.succeed(
            error._tag === "OrchestratorCommandRejectedError" ? error.cause : error._tag,
          ),
        ),
      ),
    );

  const createThread = (id: string, projectId: ProjectId, worktreePath: string | null) =>
    ({
      type: "thread.create",
      ...creation,
      commandId: CommandId.make(id),
      threadId: ThreadId.make(id),
      projectId,
      title: "New thread",
      modelSelection,
      runtimeMode: "full-access",
      interactionMode: "default",
      branch: null,
      worktreePath,
    }) satisfies OrchestrationV2ServerCommand;
  const message = (
    id: string,
    threadId: ThreadId,
    workspaceStrategy?: OrchestrationV2ThreadLaunchWorkspaceStrategy,
  ) =>
    ({
      type: "message.dispatch",
      ...creation,
      commandId: CommandId.make(id),
      threadId,
      messageId: MessageId.make(id),
      text: "Hello",
      attachments: [],
      dispatchMode:
        workspaceStrategy === undefined
          ? { type: "start_immediately" }
          : { type: "defer_start", workspaceStrategy },
    }) satisfies OrchestrationV2ServerCommand;
  const fork = (id: string, sourceThreadId: ThreadId) =>
    ({
      type: "thread.fork",
      ...creation,
      commandId: CommandId.make(id),
      sourceThreadId,
      targetThreadId: ThreadId.make(`${id}-target`),
      sourcePoint: { type: "latest_stable" },
    }) satisfies OrchestrationV2ServerCommand;
  const delegate = (id: string, workspaceStrategy?: OrchestrationV2ThreadLaunchWorkspaceStrategy) =>
    ({
      type: "delegated_task.request",
      ...creation,
      commandId: CommandId.make(id),
      parentThreadId: folderThread,
      parentRunId: RunId.make("run-parent"),
      parentNodeId: NodeId.make("node-parent"),
      task: "Look around",
      modelSelection,
      runtimeMode: "full-access",
      interactionMode: "default",
      ...(workspaceStrategy === undefined ? {} : { workspaceStrategy }),
    }) satisfies OrchestrationV2ServerCommand;
  const moveThread = (id: string, worktreePath: string | null) =>
    ({
      type: "thread.metadata.update",
      commandId: CommandId.make(id),
      threadId: folderThread,
      worktreePath,
    }) satisfies OrchestrationV2ServerCommand;

  it.effect("keep new threads, messages and forks in the Folder project's root", () => {
    const { reached, layer } = withOrchestrator(folder);
    return Effect.gen(function* () {
      const root = { type: "root" } as const;
      const worktree = { type: "worktree", baseRef: "main" } as const;
      const existing = { type: "existing_worktree", worktreePath: `${folder}-worktree` } as const;
      const refusals = {
        "create in the Folder": yield* refusalOf(
          createThread("create-folder", folderProject, null),
        ),
        "create elsewhere": yield* refusalOf(createThread("create-history", historyProject, null)),
        "create in a worktree": yield* refusalOf(
          createThread("create-worktree", folderProject, `${folder}-worktree`),
        ),
        "message in the Folder": yield* refusalOf(message("message-folder", folderThread)),
        "launch in the Folder": yield* refusalOf(message("launch-folder", folderThread, root)),
        "launch into a new worktree": yield* refusalOf(
          message("launch-worktree", folderThread, worktree),
        ),
        "launch into a worktree": yield* refusalOf(
          message("launch-existing", folderThread, existing),
        ),
        "message to history": yield* refusalOf(message("message-history", historyThread)),
        "message in a worktree": yield* refusalOf(message("message-worktree", worktreeThread)),
        "fork in the Folder": yield* refusalOf(fork("fork-folder", folderThread)),
        "fork of history": yield* refusalOf(fork("fork-history", historyThread)),
        "delegate in the Folder": yield* refusalOf(delegate("delegate-folder")),
        "delegate at the root": yield* refusalOf(delegate("delegate-root", root)),
        "delegate into a worktree": yield* refusalOf(delegate("delegate-existing", existing)),
        "move into a worktree": yield* refusalOf(moveThread("move-worktree", `${folder}-worktree`)),
        "move back to the root": yield* refusalOf(moveThread("move-root", null)),
      };
      assert.deepStrictEqual(refusals, {
        "create in the Folder": null,
        "create elsewhere": threadElsewhere,
        "create in a worktree": threadElsewhere,
        "message in the Folder": null,
        "launch in the Folder": null,
        "launch into a new worktree": threadInWorktree,
        "launch into a worktree": threadInWorktree,
        "message to history": threadElsewhere,
        "message in a worktree": threadElsewhere,
        "fork in the Folder": null,
        "fork of history": threadElsewhere,
        "delegate in the Folder": null,
        "delegate at the root": null,
        "delegate into a worktree": threadInWorktree,
        "move into a worktree": threadInWorktree,
        "move back to the root": null,
      });
      // A refused command never reaches upstream's orchestrator.
      assert.deepStrictEqual(reached, [
        "create-folder",
        "message-folder",
        "launch-folder",
        "fork-folder",
        "delegate-folder",
        "delegate-root",
        "move-root",
      ]);
    }).pipe(Effect.provide(layer));
  });

  it.effect("are upstream's without T3CODE_LAZURIO_FOLDER", () => {
    const { reached, layer } = withOrchestrator(undefined);
    return Effect.gen(function* () {
      const commands = [
        createThread("create-history", historyProject, null),
        createThread("create-worktree", folderProject, "/tmp/worktree"),
        message("message-history", historyThread, { type: "worktree", baseRef: "main" }),
        fork("fork-history", historyThread),
        delegate("delegate-existing", { type: "existing_worktree", worktreePath: "/tmp/w" }),
        moveThread("move-worktree", "/tmp/worktree"),
      ];
      for (const command of commands) assert.isNull(yield* refusalOf(command));
      assert.lengthOf(reached, commands.length);
    }).pipe(Effect.provide(layer));
  });
});

describe("agent sessions in a managed Environment", () => {
  const codex = { instanceId: ProviderInstanceId.make("codex"), model: "gpt-6.1-sol" };
  const claude = { instanceId: ProviderInstanceId.make("claudeAgent"), model: "claude-model" };

  /** The decorated session manager over a stand-in provider that records each session it opens. */
  const withSessions = (lazurioFolder: string | undefined) => {
    const opened: Array<string | null> = [];
    const layer = LazurioManagedFolder.guardTurns(
      Layer.mock(ProviderSessionManager.ProviderSessionManagerV2)({
        open: (input) =>
          Effect.sync(() => {
            opened.push(input.runtimePolicy.cwd);
            return {} as never;
          }),
      }),
    ).pipe(Layer.provide(layerManagedConfig(lazurioFolder)), Layer.provide(NodeServices.layer));
    return { opened, layer };
  };
  const open = (modelSelection: ModelSelection, cwd: string | null) =>
    Effect.flatMap(ProviderSessionManager.ProviderSessionManagerV2, (sessions) =>
      sessions
        .open({
          threadId: ThreadId.make("thread-lazurio"),
          providerSessionId: ProviderSessionId.make("session-lazurio"),
          modelSelection,
          runtimePolicy: { runtimeMode: "full-access", interactionMode: "default", cwd },
        })
        .pipe(
          Effect.as(null),
          Effect.catch((error) =>
            Effect.succeed(
              error._tag === "ProviderSessionOpenError"
                ? { instanceId: error.instanceId, cause: error.cause }
                : error._tag,
            ),
          ),
        ),
    );

  const providers = [
    { provider: "Codex", selection: codex },
    { provider: "Claude", selection: claude },
  ];

  it.effect.each(providers)("open for $provider only in the Folder itself", ({ selection }) => {
    const { folder, link, inside, repository } = makeFolderDirectories();
    const { opened, layer } = withSessions(folder);
    return Effect.gen(function* () {
      assert.isNull(yield* open(selection, folder));
      assert.isNull(yield* open(selection, link));
      for (const elsewhere of [inside, repository, `${folder}-missing`, null]) {
        assert.deepStrictEqual(yield* open(selection, elsewhere), {
          instanceId: selection.instanceId,
          cause: turnOutsideFolder,
        });
      }
      // The provider was asked only for the sessions in the Folder.
      assert.deepStrictEqual(opened, [folder, link]);
    }).pipe(Effect.provide(layer));
  });

  it.effect.each(providers)(
    "refuse $provider in a Folder path that now leads elsewhere",
    ({ selection }) => {
      const { folder } = makeFolderDirectories();
      const { opened, layer } = withSessions(folder);
      return Effect.gen(function* () {
        // The project still names the Folder, but on disk that path now leads somewhere else.
        NodeFS.renameSync(folder, `${folder}-moved`);
        NodeFS.symlinkSync(`${folder}-moved`, folder);
        assert.deepStrictEqual(yield* open(selection, folder), {
          instanceId: selection.instanceId,
          cause: turnOutsideFolder,
        });
        assert.lengthOf(opened, 0);
      }).pipe(Effect.provide(layer));
    },
  );

  it.effect("open anywhere without T3CODE_LAZURIO_FOLDER", () => {
    const { repository } = makeFolderDirectories();
    const { opened, layer } = withSessions(undefined);
    return Effect.gen(function* () {
      assert.isNull(yield* open(codex, repository));
      assert.isNull(yield* open(claude, null));
      assert.deepStrictEqual(opened, [repository, null]);
    }).pipe(Effect.provide(layer));
  });
});

describe("T3's own project folders in a managed Environment", () => {
  const withFolders = (lazurioFolder: string | undefined) => {
    let named = 0;
    const layer = LazurioManagedFolder.guardScratch(
      Layer.mock(ManagedProjectFolders.ManagedProjectFolders)({
        scratchRoot: Effect.succeedSome("/home/person/.t3/scratch"),
        ensureScratchProject: Effect.succeed({ projectId: ProjectId.make("scratch") }),
        isScratchProject: () => Effect.succeed(true),
        folderForThread: () => Effect.succeedSome("/home/person/.t3/scratch/thread"),
        namedProjectsRoot: "/home/person/.t3/projects",
        createNamedProject: () =>
          Effect.sync(() => {
            named += 1;
            return {
              projectId: ProjectId.make("named"),
              workspaceRoot: "/home/person/.t3/projects/named",
            };
          }),
      }),
    ).pipe(Layer.provide(layerManagedConfig(lazurioFolder)), Layer.provide(NodeServices.layer));
    return { layer, named: () => named };
  };
  const folderInput = {
    projectId: ProjectId.make("project-lazurio"),
    threadId: ThreadId.make("thread-lazurio"),
    text: "Hello",
  };

  it.effect("offer no Scratch and no project started from a name", () => {
    const { folder } = makeFolderDirectories();
    const { layer, named } = withFolders(folder);
    return Effect.gen(function* () {
      const folders = yield* ManagedProjectFolders.ManagedProjectFolders;
      // Without a Scratch root the server advertises none to any client.
      assert.isTrue(Option.isNone(yield* folders.scratchRoot));
      assert.strictEqual(
        (yield* Effect.flip(folders.ensureScratchProject))._tag,
        "ScratchUnavailableError",
      );
      assert.isFalse(yield* folders.isScratchProject(ProjectId.make("scratch")));
      assert.isTrue(Option.isNone(yield* folders.folderForThread(folderInput)));
      const refused = yield* Effect.flip(folders.createNamedProject({ name: "Elsewhere" }));
      assert.strictEqual(refused._tag, "NamedProjectCreateError");
      assert.strictEqual(named(), 0);
    }).pipe(Effect.provide(layer));
  });

  it.effect("turn no No project thread into a project", () => {
    const { folder } = makeFolderDirectories();
    const { layer } = withFolders(folder);
    const changed: Array<string> = [];
    const promotion = ScratchThreadPromotion.layer.pipe(
      Layer.provide(layer),
      Layer.provide(
        Layer.mock(ThreadManagementService.ThreadManagementService)({
          // A thread from before the Environment was managed, in its own Scratch folder.
          getThreadShell: (threadId) =>
            Effect.succeed({
              id: threadId,
              projectId: ProjectId.make("scratch"),
              title: "Earlier",
              worktreePath: "/home/person/.t3/scratch/2026-01-01-earlier",
            } as OrchestrationV2ThreadShell),
          dispatch: () => Effect.die(changed.push("thread")),
        }),
      ),
      Layer.provide(
        Layer.mock(ProjectService.ProjectService)({
          getById: () => Effect.succeedNone,
          bootstrap: () => Effect.die(changed.push("project")),
        }),
      ),
      Layer.provide(Layer.mock(ScheduledTaskService.ScheduledTaskService)({})),
      Layer.provide(NodeServices.layer),
    );
    return Effect.gen(function* () {
      const promotions = yield* ScratchThreadPromotion.ScratchThreadPromotion;
      const refused = yield* Effect.flip(
        promotions.promote({ threadId: ThreadId.make("thread-earlier") }),
      );
      assert.strictEqual(
        refused.message,
        "Only a No project thread with its own folder can become a project.",
      );
      assert.deepStrictEqual(changed, []);
    }).pipe(Effect.provide(promotion));
  });

  it.effect("are upstream's without T3CODE_LAZURIO_FOLDER", () => {
    const { layer, named } = withFolders(undefined);
    return Effect.gen(function* () {
      const folders = yield* ManagedProjectFolders.ManagedProjectFolders;
      assert.deepStrictEqual(yield* folders.scratchRoot, Option.some("/home/person/.t3/scratch"));
      assert.deepStrictEqual(yield* folders.ensureScratchProject, {
        projectId: ProjectId.make("scratch"),
      });
      assert.isTrue(yield* folders.isScratchProject(ProjectId.make("scratch")));
      assert.isTrue(Option.isSome(yield* folders.folderForThread(folderInput)));
      yield* folders.createNamedProject({ name: "Named" });
      assert.strictEqual(named(), 1);
    }).pipe(Effect.provide(layer));
  });
});

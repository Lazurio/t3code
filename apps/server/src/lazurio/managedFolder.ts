import type { OrchestrationCommand, OrchestrationReadModel } from "@t3tools/contracts";

// This is an entry-context contract, not a filesystem sandbox. Agents start
// at the Folder and can then work in its repositories with their normal tools.
export function managedFolderRefusal(
  folder: string | undefined,
  command: OrchestrationCommand,
  state: Pick<OrchestrationReadModel, "projects" | "threads">,
): string | null {
  if (folder === undefined) return null;
  const message =
    "Start a new chat in the Lazurio project. This Environment starts agents in its Lazurio Folder; existing conversations remain available as history.";
  const project = (id: string) => state.projects.find((item) => item.id === id);
  const allowedProject = (id: string) => project(id)?.workspaceRoot === folder;
  switch (command.type) {
    case "project.create":
      return command.workspaceRoot === folder
        ? null
        : "This Environment provides the Lazurio project at its Folder root.";
    case "project.meta.update":
      if (
        allowedProject(command.projectId) &&
        command.title !== undefined &&
        command.title !== "Lazurio"
      )
        return "The managed project is named Lazurio.";
      return command.workspaceRoot !== undefined &&
        command.workspaceRoot !== project(command.projectId)?.workspaceRoot
        ? "A managed Environment does not retarget projects. Use the Lazurio project."
        : null;
    case "project.delete":
      return allowedProject(command.projectId)
        ? "The Lazurio project is provided by this Environment and cannot be removed."
        : null;
    case "thread.create":
      return allowedProject(command.projectId) && command.worktreePath === null ? null : message;
    case "thread.meta.update":
      return command.worktreePath != null
        ? "Chats in this Environment start at the Lazurio Folder root, without a T3 worktree."
        : null;
    case "thread.turn.start": {
      const thread = state.threads.find((item) => item.id === command.threadId);
      const target = command.bootstrap?.createThread ?? thread;
      return target !== undefined &&
        allowedProject(target.projectId) &&
        target.worktreePath === null &&
        command.bootstrap?.prepareWorktree === undefined
        ? null
        : message;
    }
    default:
      return null;
  }
}

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
    "Start a new chat in the Lazurio project. Agents in this Environment work in its Lazurio Folder; your earlier chats stay here as history.";
  const project = (id: string) => state.projects.find((item) => item.id === id);
  const allowedProject = (id: string) => project(id)?.workspaceRoot === folder;
  switch (command.type) {
    case "project.create":
      return command.workspaceRoot === folder
        ? null
        : "In this Environment, the Lazurio project is the Lazurio Folder itself.";
    case "project.meta.update":
      if (
        allowedProject(command.projectId) &&
        command.title !== undefined &&
        command.title !== "Lazurio"
      )
        return "This project keeps the name Lazurio.";
      return command.workspaceRoot !== undefined &&
        command.workspaceRoot !== project(command.projectId)?.workspaceRoot
        ? "In this Environment a project cannot point to another folder. Use the Lazurio project."
        : null;
    case "project.delete":
      return allowedProject(command.projectId)
        ? "The Lazurio project belongs to this Environment and cannot be removed."
        : null;
    case "thread.create":
      return allowedProject(command.projectId) && command.worktreePath === null ? null : message;
    case "thread.meta.update":
      return command.worktreePath != null
        ? "Chats in this Environment start in the Lazurio Folder, without a separate worktree."
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

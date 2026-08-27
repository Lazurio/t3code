import type { AssetResource, ContextFile, OrchestrationMessage } from "@t3tools/contracts";

type ContextFileResource = Extract<AssetResource, { readonly _tag: "context-file" }>;

/** Resolve only metadata owned by the exact projected message named by the request. */
export function findProjectedContextFile(
  messages: ReadonlyArray<Pick<OrchestrationMessage, "id" | "contextFiles">>,
  resource: ContextFileResource,
): ContextFile | undefined {
  return messages
    .find((message) => message.id === resource.messageId)
    ?.contextFiles?.find((file) => file.id === resource.attachmentId);
}

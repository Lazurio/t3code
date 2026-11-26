/**
 * Lazurio overlay (plan LZD-0051, C1): `control_plane_publish`, Buddy's tool for his thread's
 * Control Plane. Registered beside upstream's tools by the overlay's MCP layer, so no upstream
 * toolkit changes and the context budget of `McpHttpServer.layerTools` stays as it is.
 */

import { OrchestratorMcpFailure } from "@t3tools/contracts";
import { HTML_RENDER_MAX_TITLE_LENGTH } from "@t3tools/shared/htmlRender";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { McpSchema, Tool, Toolkit } from "effect/ai";

import * as McpInvocationContext from "../mcp/McpInvocationContext.ts";
import * as ThreadManagementService from "../orchestration-v2/ThreadManagementService.ts";
import * as McpToolAccess from "../mcp/McpToolAccess.ts";
import * as ControlPlane from "./controlPlane.ts";

const CONTROL_PLANE_TOOL_NAME = "control_plane_publish";

const ControlPlanePublishTool = Tool.make(CONTROL_PLANE_TOOL_NAME, {
  description:
    "Replace the Control Plane of Buddy's thread: one self-contained HTML page in the right panel, overwritten in place on every call and reloaded live. Only Buddy's thread has one. Inline <style> and <script>; nothing in the page can send or approve anything.",
  parameters: Schema.Struct({
    html: Schema.String.check(
      Schema.isMinLength(1),
      Schema.isMaxLength(ControlPlane.CONTROL_PLANE_MAX_HTML_BYTES),
    ).annotate({ description: "The whole page." }),
    title: Schema.String.check(
      Schema.isMinLength(1),
      Schema.isMaxLength(HTML_RENDER_MAX_TITLE_LENGTH),
    ),
  }),
  success: Schema.Struct({
    attachmentId: Schema.String,
    revision: Schema.String,
    publishedAt: Schema.String,
  }),
  failure: OrchestratorMcpFailure,
  failureMode: "return",
  dependencies: [
    McpInvocationContext.McpInvocationContext,
    ThreadManagementService.ThreadManagementService,
    ControlPlane.ControlPlane,
  ],
})
  .annotate(Tool.Title, "Publish Control Plane")
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true)
  .annotate(Tool.OpenWorld, false)
  .annotate(McpSchema.EnabledWhen, McpInvocationContext.hiddenFromOutsideClients);

export const ControlPlaneToolkit = Toolkit.make(ControlPlanePublishTool);

const CODE: Record<ControlPlane.ControlPlaneError["reason"], OrchestratorMcpFailure["code"]> = {
  "not-buddys-thread": "capability_denied",
  "invalid-page": "invalid_request",
  "invalid-thread": "invalid_request",
  "store-failed": "orchestration_error",
};

export const handlersLayer = McpToolAccess.toLayer(ControlPlaneToolkit, {
  control_plane_publish: McpToolAccess.actsAsCaller((input) =>
    Effect.gen(function* () {
      const scope = yield* McpInvocationContext.McpInvocationContext;
      const { thread } = yield* McpInvocationContext.requireThreadScope(
        scope,
        CONTROL_PLANE_TOOL_NAME,
      );
      const snapshot = yield* (yield* ControlPlane.ControlPlane)
        .publish({ threadId: thread.threadId, html: input.html, title: input.title })
        .pipe(
          Effect.mapError(
            (error) =>
              new OrchestratorMcpFailure({ code: CODE[error.reason], message: error.message }),
          ),
        );
      return {
        attachmentId: snapshot.attachmentId,
        revision: snapshot.revision,
        publishedAt: snapshot.publishedAt,
      };
    }),
  ),
});

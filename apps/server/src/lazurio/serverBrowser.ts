/**
 * Lazurio overlay (root decision 0191, plan DEV-6646): on a Lazurio Environment the Environment
 * browser is the only browser of web T3, so upstream's server browser is never built there.
 *
 * Upstream's ServerBrowser registers with the preview broker as the preferred host when its layer
 * is built, sweeps idle agent tabs, and downloads and launches chrome-headless-shell on first use.
 * On a Lazurio Environment `gate` provides a disabled service instead and never runs upstream's
 * layer: no broker registration (the Environment browser host takes that client id), no sweep, no
 * desktop channel and no Chromium for browsing. The descriptor does not advertise `serverBrowser`
 * there (ServerEnvironment.ts), so clients open no server tabs; a client that asks anyway finds
 * none. HTML previews keep upstream's headless browser (PreviewBrowser.ts): they load no website.
 * Elsewhere `gate` is upstream's layer, unchanged.
 */

import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as ServerBrowser from "../preview/ServerBrowser.ts";
import { isLazurioEnvironment } from "./lazurioEnvironment.ts";

/** A server browser with no tabs, which neither registers nor starts a browser. */
const disabled = ServerBrowser.ServerBrowser.of({
  attachViewer: ({ threadId, tabId }) =>
    Effect.fail(new ServerBrowser.ServerBrowserTabNotFoundError({ threadId, tabId })),
  answerFileChooser: () => Effect.succeed(false),
  openDownload: () => Effect.succeedNone,
  clearProfile: () => Effect.void,
  reportProfiles: () => Effect.void,
});

/** Upstream's server browser, or on a Lazurio Environment the disabled one. */
export const gate = <E, R>(upstream: Layer.Layer<ServerBrowser.ServerBrowser, E, R>) =>
  Layer.unwrap(
    Effect.map(isLazurioEnvironment, (lazurio) =>
      lazurio ? Layer.succeed(ServerBrowser.ServerBrowser, disabled) : upstream,
    ),
  );

/**
 * Lazurio overlay (root decision 0191): on a Lazurio Environment upstream's server browser is never
 * built, so it neither registers with the preview broker (the Environment browser host takes that
 * client id), sweeps tabs nor downloads Chromium. HTML previews keep upstream's headless browser.
 */

import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as ServerBrowser from "../preview/ServerBrowser.ts";
import { isLazurioEnvironment } from "./lazurioEnvironment.ts";

/** A server browser with no tabs, which neither registers nor starts a browser. */
const disabled = ServerBrowser.ServerBrowser.of({
  attachViewer: Effect.fn("LazurioServerBrowser.attachViewer")(function ({ threadId, tabId }) {
    return Effect.fail(new ServerBrowser.ServerBrowserTabNotFoundError({ threadId, tabId }));
  }),
  answerFileChooser: Effect.fn("LazurioServerBrowser.answerFileChooser")(function () {
    return Effect.succeed(false);
  }),
  openDownload: Effect.fn("LazurioServerBrowser.openDownload")(function () {
    return Effect.succeedNone;
  }),
  clearProfile: Effect.fn("LazurioServerBrowser.clearProfile")(function () {
    return Effect.void;
  }),
  reportProfiles: Effect.fn("LazurioServerBrowser.reportProfiles")(function () {
    return Effect.void;
  }),
});

/** Upstream's server browser, or on a Lazurio Environment the disabled one. */
export const gate = <E, R>(upstream: Layer.Layer<ServerBrowser.ServerBrowser, E, R>) =>
  Layer.unwrap(
    Effect.map(isLazurioEnvironment, (lazurio) =>
      lazurio ? Layer.succeed(ServerBrowser.ServerBrowser, disabled) : upstream,
    ),
  );

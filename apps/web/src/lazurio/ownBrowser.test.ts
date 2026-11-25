import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import {
  DEFAULT_CLIENT_SETTINGS,
  type LocalApi,
  type PreviewSessionSnapshot,
  type ScopedThreadRef,
} from "@t3tools/contracts";
import { AsyncResult } from "effect/reactivity";
import { describe, expect, it, vi } from "vite-plus/test";

import { openUrlInPreview } from "~/browser/openFileInPreview";
import { __setClientSettingsForTests } from "~/hooks/useSettings";
import * as localApi from "~/localApi";
import { resetPreviewStateForTests } from "~/previewStateStore";
import { useRightPanelStore } from "~/rightPanelStore";

import { useThreadTabsStore } from "./threadTabs";

const threadRef = {
  environmentId: "vm-01" as ScopedThreadRef["environmentId"],
  threadId: "thread-1" as ScopedThreadRef["threadId"],
};
const viewOrigin = "https://browser.vm-01.acme.lazurio.io";
const previewSnapshot: PreviewSessionSnapshot = {
  threadId: threadRef.threadId,
  tabId: "tab-1",
  navStatus: { _tag: "Loading", url: "https://forecast.vm-01.acme.lazurio.io/", title: "" },
  canGoBack: false,
  canGoForward: false,
  updatedAt: "2026-11-25T22:00:00.000Z",
};

function setup(withBrowser: boolean) {
  resetPreviewStateForTests();
  useRightPanelStore.setState({ byThreadKey: {}, threadPanelVisibilityByThreadKey: {} });
  __setClientSettingsForTests(DEFAULT_CLIENT_SETTINGS);
  useThreadTabsStore.setState({
    snapshots: withBrowser
      ? {
          [scopedThreadKey(threadRef)]: {
            available: true,
            epoch: "epoch-1",
            revision: 1,
            threadId: threadRef.threadId,
            strip: `t3-${threadRef.threadId}`,
            viewOrigin,
            tabs: [],
          },
        }
      : {},
  });
  const openExternal = vi.fn(async (_url: string) => {});
  const api = vi
    .spyOn(localApi, "readLocalApi")
    .mockReturnValue({ shell: { openExternal } } as unknown as LocalApi);
  const openPreview = vi.fn(async () => AsyncResult.success(previewSnapshot));
  return { openExternal, openPreview, [Symbol.dispose]: () => api.mockRestore() };
}

describe("LazurioPlatform C20 in the panel's one door", () => {
  it("opens a page of the person's Lazurio account in their own browser, never in the panel", async () => {
    using env = setup(true);
    for (const url of [
      "https://launchpad.vm-01.acme.lazurio.io/integrations/app/neon",
      "https://user:secret@Dashboard.lazurio.ai/x",
      "https://vm-01.acme.lazurio.io/oauth2/sign_in",
      "https://launchpad.vm-02.acme.lazurio.io/",
    ]) {
      await expect(
        openUrlInPreview({ openPreview: env.openPreview, threadRef, url }),
      ).resolves.toMatchObject({ _tag: "Success" });
    }
    expect(env.openExternal.mock.calls).toEqual([
      ["https://launchpad.vm-01.acme.lazurio.io/integrations/app/neon"],
      ["https://dashboard.lazurio.ai/x"],
      ["https://vm-01.acme.lazurio.io/oauth2/sign_in"],
      ["https://launchpad.vm-02.acme.lazurio.io/"],
    ]);
    expect(env.openPreview).not.toHaveBeenCalled();
  });

  it("keeps the Environment's own module and other webs in the panel", async () => {
    using env = setup(true);
    for (const url of ["https://forecast.vm-01.acme.lazurio.io/", "https://example.test/"]) {
      await openUrlInPreview({ openPreview: env.openPreview, threadRef, url });
    }
    expect(env.openExternal).not.toHaveBeenCalled();
    expect(env.openPreview).toHaveBeenCalledTimes(2);
  });

  it("changes nothing where the thread's Environment has no Lazurio browser", async () => {
    using env = setup(false);
    await openUrlInPreview({
      openPreview: env.openPreview,
      threadRef,
      url: "https://dashboard.lazurio.ai/",
    });
    expect(env.openExternal).not.toHaveBeenCalled();
    expect(env.openPreview).toHaveBeenCalledTimes(1);
  });
});

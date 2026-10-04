import { describe, expect, it, vi } from "vite-plus/test";

import {
  capturePromptLink,
  fetchPrompt,
  openPromptDraft,
  type PromptDraftDependencies,
  readPromptLink,
  stripPromptLink,
} from "./promptDraft";

const origin = "https://t3code.vm-01.example.lazurio.io";
const link = { id: "new-module", organization: "Example-Org" } as const;
const document = {
  schema: "lazurio.prompt.v1",
  id: "new-module",
  text: "I want to found a new module.\n\nAsk me first.",
  cwd: "/home/operator/Lazurio/organizations/example_GEN3",
};

function answer(body: unknown, init: ResponseInit & { url?: string } = {}): Response {
  const response = new Response(typeof body === "string" ? body : JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json; charset=utf-8" },
    ...init,
  });
  Object.defineProperty(response, "url", {
    value: init.url ?? `${origin}/.lazurio/prompts/new-module?org=Example-Org`,
  });
  return response;
}

describe("the link", () => {
  it("carries only a prompt id and an Organization login, in the fragment", () => {
    expect(
      readPromptLink(
        new URL(`${origin}/pair#token=abc&lazurio-prompt=new-module&lazurio-org=Example-Org`),
      ),
    ).toEqual(link);
    expect(
      readPromptLink(new URL(`${origin}/#lazurio-prompt=new-module&lazurio-org=Example-Org`)),
    ).toEqual(link);
  });

  it("refuses text, a query, a missing or repeated part and anything outside the grammar", () => {
    for (const href of [
      `${origin}/#lazurio-prompt=new-module`,
      `${origin}/#lazurio-org=Example-Org`,
      `${origin}/?lazurio-prompt=new-module&lazurio-org=Example-Org`,
      `${origin}/#lazurio-prompt=new-module&lazurio-org=Example-Org&lazurio-prompt=other`,
      `${origin}/#lazurio-prompt=Do%20this%20now&lazurio-org=Example-Org`,
      `${origin}/#lazurio-prompt=new-module&lazurio-org=a%2Fb`,
      `${origin}/#lazurio-prompt=new-module&lazurio-org=-x`,
      `${origin}/#lazurio-prompt=${"a".repeat(65)}&lazurio-org=Example-Org`,
      `${origin}/#lazurio-text=hello&lazurio-org=Example-Org`,
      `${origin}/pair#token=abc`,
    ]) {
      expect([href, readPromptLink(new URL(href))]).toEqual([href, null]);
    }
  });

  it("is stripped from the address, leaving everything else as it was", () => {
    expect(
      stripPromptLink(
        new URL(`${origin}/pair#token=abc&lazurio-prompt=new-module&lazurio-org=Example-Org`),
      ).href,
    ).toBe(`${origin}/pair#token=abc`);
    expect(
      stripPromptLink(new URL(`${origin}/#lazurio-prompt=new-module&lazurio-org=Example-Org`)).href,
    ).toBe(`${origin}/`);
    expect(stripPromptLink(new URL(`${origin}/pair#token=abc`)).href).toBe(
      `${origin}/pair#token=abc`,
    );
  });

  it("is taken once at boot, before the router reads the address", () => {
    const replace = vi.fn();
    const location = {
      href: `${origin}/pair#token=abc&lazurio-prompt=new-module&lazurio-org=Example-Org`,
    };
    const take = capturePromptLink(location, replace);
    expect(replace).toHaveBeenCalledWith(`${origin}/pair#token=abc`);
    expect(take()).toEqual(link);
    expect(take()).toBeNull();
    const untouched = vi.fn();
    expect(capturePromptLink({ href: `${origin}/pair#token=abc` }, untouched)()).toBeNull();
    expect(untouched).not.toHaveBeenCalled();
  });
});

describe("the text", () => {
  it("comes only from this origin's /.lazurio/prompts/<id>, without credentials elsewhere", async () => {
    const fetcher = vi.fn(async () => answer(document));
    await expect(fetchPrompt(link, origin, fetcher)).resolves.toEqual({
      text: document.text,
      cwd: document.cwd,
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`${origin}/.lazurio/prompts/new-module?org=Example-Org`);
    expect(init).toMatchObject({
      credentials: "same-origin",
      redirect: "error",
      cache: "no-store",
    });
  });

  it("is nothing for an unknown id, a failed fetch, a non-JSON or wrong answer, or another origin", async () => {
    const cases: Array<[string, () => Promise<Response>]> = [
      ["404", async () => answer({ error: "not-found" }, { status: 404 })],
      [
        "network",
        async () => {
          throw new TypeError("Failed to fetch");
        },
      ],
      ["html", async () => answer("<html></html>", { headers: { "content-type": "text/html" } })],
      ["not json", async () => answer("{", { headers: { "content-type": "application/json" } })],
      ["schema", async () => answer({ ...document, schema: "lazurio.prompt.v2" })],
      ["id", async () => answer({ ...document, id: "other" })],
      ["empty text", async () => answer({ ...document, text: "  " })],
      ["long text", async () => answer({ ...document, text: "x".repeat(16 * 1024 + 1) })],
      ["text type", async () => answer({ ...document, text: 42 })],
      ["relative cwd", async () => answer({ ...document, cwd: "organizations/example" })],
      ["no cwd", async () => answer({ ...document, cwd: undefined })],
      [
        "other origin",
        async () => answer(document, { url: "https://evil.example/.lazurio/prompts/new-module" }),
      ],
      ["array", async () => answer([document])],
    ];
    for (const [name, fetcher] of cases) {
      await expect([name, await fetchPrompt(link, origin, fetcher)]).toEqual([name, null]);
    }
  });
});

function dependencies(overrides: Partial<PromptDraftDependencies> = {}) {
  const calls: string[] = [];
  const projectRef = { environmentId: "primary", projectId: "project-1" } as never;
  const base: PromptDraftDependencies = {
    origin,
    fetch: async () => answer(document),
    findProject: (cwd) => {
      calls.push(`find ${cwd}`);
      return projectRef;
    },
    addProject: async (cwd) => {
      calls.push(`add ${cwd}`);
      return projectRef;
    },
    openThread: async () => {
      calls.push("open");
      return { draftId: "draft-1" as never };
    },
    setPrompt: (draftId, text) => {
      calls.push(`prompt ${String(draftId)} ${text}`);
    },
  };
  return { calls, dependencies: { ...base, ...overrides } };
}

describe("the draft", () => {
  it("opens a new thread in the project rooted at cwd and leaves the text in its composer", async () => {
    const { calls, dependencies: deps } = dependencies();
    await expect(openPromptDraft(link, deps)).resolves.toBe("opened");
    expect(calls).toEqual([`find ${document.cwd}`, "open", `prompt draft-1 ${document.text}`]);
  });

  it("adds the Organization's folder as a project when there is none", async () => {
    const { calls, dependencies: deps } = dependencies({
      findProject: (cwd) => {
        calls.push(`find ${cwd}`);
        return null;
      },
    });
    await expect(openPromptDraft(link, deps)).resolves.toBe("opened");
    expect(calls).toEqual([
      `find ${document.cwd}`,
      `add ${document.cwd}`,
      "open",
      `prompt draft-1 ${document.text}`,
    ]);
  });

  it("asks again when another navigation overtook the new thread", async () => {
    let attempts = 0;
    const { calls, dependencies: deps } = dependencies({
      openThread: async () => {
        attempts += 1;
        calls.push("open");
        return attempts === 1 ? null : { draftId: "draft-2" as never };
      },
    });
    await expect(openPromptDraft(link, deps)).resolves.toBe("opened");
    expect(calls.slice(1)).toEqual(["open", "open", `prompt draft-2 ${document.text}`]);
  });

  it("inserts nothing when the text, the project or the thread is not there", async () => {
    for (const overrides of [
      { fetch: async () => answer({ error: "not-found" }, { status: 404 }) },
      { findProject: () => null, addProject: async () => null },
      { openThread: async () => null },
      {
        openThread: async () => {
          throw new Error("navigation failed");
        },
      },
    ] satisfies Array<Partial<PromptDraftDependencies>>) {
      const { calls, dependencies: deps } = dependencies(overrides);
      await expect(openPromptDraft(link, deps)).resolves.toBe("failed");
      expect(calls.some((call) => call.startsWith("prompt"))).toBe(false);
    }
  });
});

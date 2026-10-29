// @effect-diagnostics nodeBuiltinImport:off - compiles the real ChatView source on disk.
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";
import { transform } from "oxc-transform-react";
import { expect, it } from "vite-plus/test";

const chatViewPath = NodePath.join(
  NodePath.dirname(NodeURL.fileURLToPath(import.meta.url)),
  "../components/ChatView.tsx",
);

// usePanelPresence sets state during render whenever its value changes identity, so the value
// ChatView hands it must keep its identity between renders. ChatView builds it as an object literal
// and relies on the React Compiler to memoize it; when the compiler cannot (Lazurio/t3code#135, a
// seam read through a plain function), every render makes a new object and opening the panel, or
// loading a thread whose panel is saved open, loops until React fails with error #301.
// oxlint-disable-next-line t3code/no-test-timeout-or-unreasoned-skip -- CPU-bound compile of a huge file, not a hidden wait (as reactCompilerCoverage.test.ts).
it("keeps every panel presence value ChatView builds memoized by the React Compiler", async () => {
  const { code, errors } = await transform(
    chatViewPath,
    NodeFS.readFileSync(chatViewPath, "utf8"),
    {
      jsx: { runtime: "automatic", development: false, refresh: false },
      reactCompiler: { reportDiagnostics: true },
    },
  );
  expect(errors).toEqual([]);
  const values = [...code.matchAll(/usePanelPresence\([^,]+,\s*([A-Za-z_$][\w$]*)\s*,/g)].map(
    (match) => match[1]!,
  );
  expect(values).not.toEqual([]);
  for (const value of values) {
    const binding = new RegExp(`const ${value.replace(/\$/g, "\\$")} = ([^;]*);`).exec(code)?.[1];
    // The compiled binding is a memo slot's temporary, never an object built on every render.
    expect(binding, `${value} is built on every render`).not.toMatch(/^\s*\{/);
  }
}, 60_000);

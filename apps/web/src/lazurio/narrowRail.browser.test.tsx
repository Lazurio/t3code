import { page, userEvent } from "vite-plus/test/browser";
import { describe, expect, it } from "vite-plus/test";

import indexHtml from "../../index.html?raw";
import { render } from "../../test/render";
import { Sidebar, SidebarProvider, SidebarTrigger } from "../components/ui/sidebar";

// The rail in a narrow window (index.html, the Lazurio shell slot): hidden beside the
// conversation, inside T3's open left panel, and shown wherever it stands while a dialog of its
// own is open. The style and the script are index.html's own; the rail is a stand-in with the
// shape the shell's `<lazurio-rail>` has: an open shadow root, a control and a dialog.

const narrowStyle = (() => {
  const match = indexHtml.match(/\n(\s*\/\* A narrow window[\s\S]*?)\n\s*<\/style>/);
  if (!match?.[1]) throw new Error("Could not find the narrow rail style in index.html");
  return match[1];
})();
const moverScript = (() => {
  const match = indexHtml.match(/<script>\s*(\/\/ The rail in a narrow window[\s\S]*?)<\/script>/);
  if (!match?.[1]) throw new Error("Could not find the rail mover in index.html");
  return match[1];
})();

class StandInRail extends HTMLElement {
  readonly dialog: HTMLDialogElement;
  constructor() {
    super();
    const root = this.attachShadow({ mode: "open" });
    root.innerHTML =
      '<style>:host { position: fixed; inset: 0 auto 0 0; z-index: 40; display: block; width: 64px; }</style><nav aria-label="Organizations"><button type="button">Go to an Environment</button></nav><dialog><input aria-label="Environment or Organization" /></dialog>';
    this.dialog = root.querySelector("dialog")!;
  }
  connectedCallback() {
    document.documentElement.style.setProperty("--lazurio-rail-width", "64px");
  }
  /** As the shell's jump: opens its dialog and puts the focus into its search at once. */
  openJump() {
    this.dialog.showModal();
    this.dialog.querySelector("input")!.focus();
  }
}

// The shell answers ⌘⇧E / Ctrl+Shift+E on the document, unless the app took the key.
document.addEventListener("keydown", (event) => {
  const rail = document.querySelector<StandInRail>("lazurio-rail");
  if (
    rail &&
    !event.defaultPrevented &&
    event.shiftKey &&
    (event.metaKey || event.ctrlKey) &&
    event.key.toLowerCase() === "e"
  )
    rail.openJump();
});

if (!customElements.get("lazurio-rail")) customElements.define("lazurio-rail", StandInRail);

const panel = () => document.querySelector('[data-mobile="true"][data-sidebar="sidebar"]');

/** index.html's narrow style and rail mover on this page, with a rail before #root as the slot
 * has it; disposing removes them all, the mover's observers included. */
function narrowShell() {
  const style = document.createElement("style");
  style.textContent = narrowStyle;
  document.head.append(style);
  const root = document.createElement("div");
  root.id = "root";
  const rail = document.createElement("lazurio-rail") as StandInRail;
  document.body.prepend(rail, root);
  const observers: MutationObserver[] = [];
  class TrackedObserver extends MutationObserver {
    constructor(callback: MutationCallback) {
      super(callback);
      observers.push(this);
    }
  }
  const events = new EventTarget();
  const scopedDocument = new Proxy(document, {
    get: (target, key) => {
      if (key === "addEventListener") return events.addEventListener.bind(events);
      const value: unknown = Reflect.get(target, key, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  new Function("document", "MutationObserver", moverScript)(scopedDocument, TrackedObserver);
  events.dispatchEvent(new Event("DOMContentLoaded"));
  return {
    rail,
    [Symbol.dispose]() {
      for (const observer of observers) observer.disconnect();
      rail.remove();
      root.remove();
      style.remove();
    },
  };
}

const layout = () => (
  <SidebarProvider storageKey="narrow_rail_test">
    <Sidebar aria-label="Threads">
      <a href="#thread">A thread</a>
    </Sidebar>
    <SidebarTrigger />
  </SidebarProvider>
);

describe("the Lazurio rail in a narrow window", () => {
  it("is hidden beside the conversation and part of the open panel's dialog", async () => {
    await page.viewport(390, 844);
    using shell = narrowShell();
    const { rail } = shell;
    await using screen = await render(layout(), { router: false /* no routes involved */ });
    await expect.poll(() => rail.checkVisibility()).toBe(false);
    expect(rail.parentElement).toBe(document.body);

    await userEvent.click(screen.getByRole("button", { name: "Toggle Sidebar" }));
    await expect.poll(() => rail.parentElement === panel() && panel() !== null).toBe(true);
    expect(panel()!.firstElementChild).toBe(rail);
    expect(rail.checkVisibility()).toBe(true);
    expect(rail.getBoundingClientRect().left).toBe(0);
    // The modal panel hides the page outside it from screen readers; the rail is not outside.
    await expect.poll(() => rail.closest('[aria-hidden="true"], [inert]')).toBe(null);
    const control = rail.shadowRoot!.querySelector("button")!;
    control.focus();
    expect(rail.shadowRoot!.activeElement).toBe(control);

    await userEvent.keyboard("{Escape}");
    await expect.poll(() => rail.parentElement).toBe(document.body);
    expect(rail.checkVisibility()).toBe(false);
  });

  it("opens the jump visible and ready to type with the panel closed", async () => {
    await page.viewport(390, 844);
    using shell = narrowShell();
    const { rail } = shell;
    await using _screen = await render(layout(), { router: false /* no routes involved */ });
    await expect.poll(() => rail.checkVisibility()).toBe(false);
    expect(rail.parentElement).toBe(document.body);

    await userEvent.keyboard("{Control>}{Shift>}E{/Shift}{/Control}");
    expect(rail.dialog.open).toBe(true);
    expect(rail.dialog.checkVisibility()).toBe(true);
    expect(rail.dialog.getBoundingClientRect().width).toBeGreaterThan(0);
    const search = rail.dialog.querySelector("input")!;
    expect(rail.shadowRoot!.activeElement).toBe(search);
    await userEvent.keyboard("Server");
    expect(search.value).toBe("Server");

    rail.dialog.close();
    await expect.poll(() => rail.checkVisibility()).toBe(false);
  });

  it("stays hidden when the app takes the jump's keys", async () => {
    await page.viewport(390, 844);
    using shell = narrowShell();
    const { rail } = shell;
    await using _screen = await render(layout(), { router: false /* no routes involved */ });
    await expect.poll(() => rail.checkVisibility()).toBe(false);
    const take = (event: KeyboardEvent) => event.preventDefault();
    window.addEventListener("keydown", take, true);
    try {
      await userEvent.keyboard("{Control>}{Shift>}E{/Shift}{/Control}");
    } finally {
      window.removeEventListener("keydown", take, true);
    }
    expect(rail.dialog.open).toBe(false);
    expect(rail.checkVisibility()).toBe(false);
  });

  it("leaves the rail beside the app in a wide window", async () => {
    await page.viewport(1280, 800);
    using shell = narrowShell();
    const { rail } = shell;
    await using _screen = await render(layout(), { router: false /* no routes involved */ });
    await expect.poll(() => rail.checkVisibility()).toBe(true);
    expect(rail.parentElement).toBe(document.body);
  });
});

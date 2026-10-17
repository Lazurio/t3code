import symbol from "./brand/symbol-color.svg";
import symbolDark from "./brand/symbol-color-dark.svg";

/**
 * Lazurio overlay (root decision 0200): the "Lazurio" label beside T3 Code's wordmark, with the
 * approved Lazurio symbol before the word (the approved design of the left column, 2026-10-17).
 * The symbol is the design system's whole asset, never redrawn, at its 16 px minimum (logo.md),
 * so the label is taller than T3's small badge; on a dark look it is the dark rendition, as
 * blue-500 vanishes on dark ground. The colours and the type are T3's secondary badge.
 */
export function LazurioBadge() {
  return (
    <span
      data-environment-identification="pill"
      className="inline-flex h-5 shrink-0 items-center gap-1 rounded-sm bg-secondary px-0.75 font-medium text-3xs text-secondary-foreground leading-none"
    >
      <img alt="" className="size-4 dark:hidden" height={16} src={symbol} width={16} />
      <img alt="" className="hidden size-4 dark:block" height={16} src={symbolDark} width={16} />
      Lazurio
    </span>
  );
}
